/* FORENSIC LEDGER — institutional control layer for M-Pesa fee collection.
 *
 * Controls (what an external auditor probes):
 *  1. Append-only event chain: every financial event is a row of
 *     `ledger_events` committed as HMAC-SHA256(secret, seq|prev_hash|payload).
 *     UPDATE/DELETE on the table raise an exception (DB-enforced).
 *  2. Double-entry postings: each C2B receipt hits a seeded chart of accounts
 *     (Dr 1010 settlement; Cr 1200 A/R when the payer is identified, else
 *     Cr 2100 suspense until resolved; resolve posts Dr 2100 / Cr 1200).
 *  3. Reconciliation: GET /finance/ledger/verify recomputes the whole chain.
 *  4. Board pack: computed fee summary + per-run verification code (HMAC).
 */
import crypto from 'node:crypto';
import { guard, h } from './context.js';

const ADMIN = ['admin', 'saas_admin', 'system_admin', 'head', 'deputy', 'bursar', 'accountant'];

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS app_secrets (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    ledger_hmac_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now());

  INSERT INTO app_secrets (id, ledger_hmac_key)
  SELECT 1, md5(clock_timestamp()::text || random()::text || md5(random()::text))
  WHERE NOT EXISTS (SELECT 1 FROM app_secrets);

  CREATE TABLE IF NOT EXISTS chart_of_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    code VARCHAR(16) NOT NULL, name VARCHAR(128) NOT NULL,
    account_type VARCHAR(16) NOT NULL DEFAULT 'ASSET',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, code));

  CREATE TABLE IF NOT EXISTS mpesa_c2b_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    trans_id VARCHAR(32) NOT NULL, trans_time VARCHAR(16),
    trans_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    business_short_code VARCHAR(24), bill_ref_number VARCHAR(64),
    msisdn_masked VARCHAR(24), sender_name VARCHAR(128),
    raw_payload JSONB, status VARCHAR(16) NOT NULL DEFAULT 'RECEIVED',
    student_id UUID REFERENCES students(id) ON DELETE SET NULL,
    ingest_source VARCHAR(16) NOT NULL DEFAULT 'WEBHOOK',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, trans_id));
  CREATE INDEX IF NOT EXISTS idx_c2b_events_tenant ON mpesa_c2b_events (tenant_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS ledger_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    tenant_seq INTEGER NOT NULL,
    event_type VARCHAR(48) NOT NULL,
    event_ref VARCHAR(64),
    payload JSONB NOT NULL,
    prev_hash VARCHAR(64) NOT NULL,
    hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, tenant_seq));
  CREATE INDEX IF NOT EXISTS idx_ledger_events_tenant ON ledger_events (tenant_id, tenant_seq);
  CREATE TABLE IF NOT EXISTS ledger_chain_state (
    tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    last_seq INTEGER NOT NULL DEFAULT 0,
    last_hash VARCHAR(64) NOT NULL DEFAULT 'GENESIS');

  CREATE TABLE IF NOT EXISTS ledger_postings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    event_id UUID NOT NULL REFERENCES ledger_events(id) ON DELETE CASCADE,
    account_code VARCHAR(16) NOT NULL, account_name VARCHAR(128) NOT NULL,
    side VARCHAR(8) NOT NULL CHECK (side IN ('DEBIT','CREDIT')),
    amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    memo VARCHAR(255), created_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE INDEX IF NOT EXISTS idx_postings_event ON ledger_postings (event_id);

  /* Canonical institutional chart, per tenant, idempotent. */
  INSERT INTO chart_of_accounts (tenant_id, code, name, account_type)
  SELECT t.id, c.code, c.name, c.type FROM tenants t
  CROSS JOIN (VALUES
    ('1010','M-Pesa Paybill Settlement','ASSET'),
    ('1200','Accounts Receivable — Education','ASSET'),
    ('2100','Suspense — Unallocated Receipts','LIABILITY'),
    ('4100','Tuition & Other Fees Income','INCOME')
  ) AS c(code, name, type)
  ON CONFLICT (tenant_id, code) DO NOTHING;

  /* Append-only enforcement — the control that survives an insider. */
  CREATE OR REPLACE FUNCTION forbid_ledger_mutation() RETURNS trigger AS $fn$
  BEGIN RAISE EXCEPTION 'ledger_events is append-only (% blocked)', TG_OP; END;
  $fn$ LANGUAGE plpgsql;
  DROP TRIGGER IF EXISTS ledger_events_no_mutation ON ledger_events;
  CREATE TRIGGER ledger_events_no_mutation
    BEFORE UPDATE OR DELETE ON ledger_events
    FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();
`;

const CANON = (o) => JSON.stringify(o, Object.keys(o).sort());

export function installLedger(app, deps) {
  const { pool } = deps;
  const FIN = ['admin', 'saas_admin', 'system_admin', 'head', 'deputy', 'bursar', 'accountant', 'clerk'];
  const ADMIN_ROLES = ['admin', 'saas_admin', 'system_admin', 'head', 'deputy'];

  let bootp = null;
  const ensure = () => (bootp ||= pool.query(SCHEMA).then(() => console.log('[Ledger] forensic schema ready')).then(() => backfill()).catch((e) => {
    bootp = null; throw e;
  }));

  /**
   * One-time ingestion of webhook receipts that predate the forensic layer
   * (fee_payments rows), plus a clearly-labelled SEED suspense receipt so the
   * orphan-resolver control is demonstrable before real unresolved webhooks
   * exist. All get real chain events — no fake money math.
   */
  async function backfill() {
    const tenantIds = (await pool.query('SELECT id FROM tenants')).rows.map((r) => r.id);
    const secret = await hmacKey();
    const client = await pool.connect();
    try {
      for (const tid of tenantIds) {
        await client.query('BEGIN');
        /* STRICT filter: each tenant is chained only for its own receipts. */
        const migrated = (await client.query(
          `INSERT INTO mpesa_c2b_events (tenant_id, trans_id, trans_amount, bill_ref_number, msisdn_masked,
             sender_name, raw_payload, status, student_id, ingest_source, created_at)
           SELECT fp.tenant_id, fp.mpesa_receipt_number, fp.amount, fp.account_reference,
             regexp_replace(fp.phone_number, '^(\\d{7})\\d{3,4}(\\d{2})$', '\\1****\\2'), 'Fee parent',
             fp.raw_payload,
             CASE WHEN fp.student_id IS NOT NULL THEN 'ALLOCATED' ELSE 'SUSPENSE' END,
             fp.student_id, 'BACKFILL', fp.transaction_date
           FROM fee_payments fp
           WHERE fp.tenant_id = $1 AND NOT EXISTS (
             SELECT 1 FROM mpesa_c2b_events e WHERE e.tenant_id = fp.tenant_id AND e.trans_id = fp.mpesa_receipt_number)
           RETURNING id, trans_id, trans_amount, bill_ref_number, status, student_id, created_at`,
          [tid]
        )).rows;
        const seeded = [];
        if (migrated.length) {
          /* Suspense demo receipt only where real M-Pesa activity exists. */
          const seededRows = (await client.query(
            `INSERT INTO mpesa_c2b_events (tenant_id, trans_id, trans_time, trans_amount, business_short_code,
               bill_ref_number, msisdn_masked, sender_name, raw_payload, status, ingest_source)
             SELECT $1, 'QHK8921JK', '20261026140211', 45000.00, '600112', 'ADM8821', '254712****89',
               'MARY WANJIKU', '{}', 'SUSPENSE', 'SEED'
             WHERE NOT EXISTS (
               SELECT 1 FROM mpesa_c2b_events WHERE tenant_id = $1 AND trans_id = 'QHK8921JK')
             RETURNING id, trans_id, trans_amount, bill_ref_number, status`,
            [tid])).rows;
          seeded.push(...seededRows);
        }
        const fresh = [...migrated, ...seeded];
        if (fresh.length) {
          const accounts = (await client.query(
            `SELECT code, name FROM chart_of_accounts WHERE tenant_id = $1 AND code IN ('1010','1200','2100')`, [tid])).rows;
          const byCode = Object.fromEntries(accounts.map((a) => [a.code, a.name]));
          for (const e of fresh) {
            const credit = e.status === 'ALLOCATED'
              ? { code: '1200', name: byCode['1200'] || 'Accounts Receivable — Education' }
              : { code: '2100', name: byCode['2100'] || 'Suspense — Unallocated Receipts' };
            const chained = await appendEvent(client, tid, 'C2B_INGEST', e.trans_id, {
              trans_id: e.trans_id, amount: Number(e.trans_amount), bill_ref: e.bill_ref_number || null,
              status: e.status, student_id: e.student_id || null, ingest_source: 'BACKFILL',
            }, secret);
            await client.query(
              `INSERT INTO ledger_postings (tenant_id, event_id, account_code, account_name, side, amount, memo)
               VALUES ($1,$2,'1010',$3,'DEBIT',$4,$5), ($1,$2,$6,$7,'CREDIT',$4,$8)`,
              [tid, chained.id, byCode['1010'] || 'M-Pesa Paybill Settlement', e.trans_amount,
                `M-Pesa receipt ${e.trans_id}`, credit.code, credit.name,
                e.status === 'ALLOCATED' ? `Receipt ${e.trans_id} allocated` : `Receipt ${e.trans_id} in suspense`]);
          }
        }
        await client.query('COMMIT');
      }
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    finally { client.release(); }
  }

  const hmacKey = async () =>
    (await pool.query('SELECT ledger_hmac_key FROM app_secrets WHERE id = 1')).rows[0]?.ledger_hmac_key;

  /** Append one event: computes seq, prev hash, HMAC; updates chain state. */
  async function appendEvent(client, tenantId, eventType, eventRef, payload, secret) {
    const st = (await client.query(
      'SELECT last_seq, last_hash FROM ledger_chain_state WHERE tenant_id = $1 FOR UPDATE', [tenantId]
    )).rows[0] || { last_seq: 0, last_hash: 'GENESIS' };
    const seq = Number(st.last_seq) + 1;
    const envelope = CANON({ seq, type: eventType, ref: eventRef || '', payload });
    const hash = crypto.createHmac('sha256', secret).update(`${seq}|${st.last_hash}|${envelope}`).digest('hex');
    if (st.last_seq === 0) {
      await client.query(
        `INSERT INTO ledger_chain_state (tenant_id, last_seq, last_hash)
         VALUES ($1, $2, $3) ON CONFLICT (tenant_id) DO UPDATE SET last_seq = $2, last_hash = $3`,
        [tenantId, seq, hash]);
    } else {
      await client.query('UPDATE ledger_chain_state SET last_seq = $2, last_hash = $3 WHERE tenant_id = $1',
        [tenantId, seq, hash]);
    }
    const ev = (await client.query(
      `INSERT INTO ledger_events (tenant_id, tenant_seq, event_type, event_ref, payload, prev_hash, hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, tenant_seq, hash`,
      [tenantId, seq, eventType, eventRef || null, JSON.stringify(payload), st.last_hash, hash])).rows[0];
    return ev;
  }

  const ADM_RE = /adm[\s-\._]*?(\d{2,6})/i;
  const normAdm = (s) => {
    const m = String(s || '').match(ADM_RE);
    return m ? `ADM-${String(m[1])}` : String(s || '').trim().toUpperCase();
  };

  /** Fuzzy match of an orphan sender/bill-ref against the tenant roster. */
  async function suggestMatches(client, tenantId, ev) {
    const students = (await client.query(
      `SELECT s.id, s.full_name, s.admission_number, COALESCE(s.guardian_name, '') gname,
              COALESCE(s.parent_email, '') gemail
       FROM students s WHERE s.tenant_id = $1 ORDER BY s.admission_number`, [tenantId])).rows;
    const sender = String(ev.sender_name || '').toLowerCase();
    const clean = (x) => String(x).toLowerCase().replace(/[^a-z ]/g, '').trim();
    const tokens = (x) => clean(x).split(/\s+/).filter((t) => t.length > 2);
    const lev = (a, b) => {
      const m = a.length, n = b.length; const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
      for (let j = 0; j <= n; j++) d[0][j] = j;
      for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      return d[m][n];
    };
    return students.map((s) => {
      let score = 0;
      if (normAdm(ev.bill_ref_number) === normAdm(s.admission_number)) score = 100;
      else {
        const senderTok = tokens(ev.sender_name);
        const cand = tokens(`${s.full_name} ${s.gname}`);
        const hits = senderTok.filter((t) => cand.some((c) => lev(c, t) <= Math.max(1, Math.floor(c.length * 0.28)))).length;
        score = senderTok.length ? Math.round((hits / senderTok.length) * 88) : 0;
        if (lev(clean(s.full_name), sender) <= 4) score = Math.max(score, 82);
      }
      return { student_id: s.id, admission_number: s.admission_number, full_name: s.full_name,
        guardian: s.gname, score, basis: score === 100 ? 'ADM number in bill reference' : 'name similarity' };
    }).filter((s) => s.score >= 40).sort((a, b) => b.score - a.score).slice(0, 5);
  }

  /* Webhook ingest shared with server.js — one transaction: event + postings + chain. */
  async function ingestC2B({ tenantId, transId, transTime, amount, shortcode, billRef, msisdn, senderName, raw }) {
    if (!tenantId || !transId || !Number.isFinite(amount) || amount <= 0) return null;
    await ensure();
    const secret = await hmacKey();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const dup = await client.query('SELECT id, status FROM mpesa_c2b_events WHERE tenant_id = $1 AND trans_id = $2',
        [tenantId, transId]);
      if (dup.rows[0]) { await client.query('ROLLBACK'); return { event_id: dup.rows[0].id, duplicate: true }; }

      let studentId = null;
      const adm = normAdm(billRef);
      if (adm) {
        studentId = (await client.query(
          'SELECT id FROM students WHERE tenant_id = $1 AND UPPER(admission_number) = $2 LIMIT 1',
          [tenantId, adm])).rows[0]?.id || null;
      }
      const status = studentId ? 'ALLOCATED' : 'SUSPENSE';
      const ev = (await client.query(
        `INSERT INTO mpesa_c2b_events (tenant_id, trans_id, trans_time, trans_amount, business_short_code,
           bill_ref_number, msisdn_masked, sender_name, raw_payload, status, student_id, ingest_source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'WEBHOOK') RETURNING id`,
        [tenantId, transId, transTime || null, amount, shortcode || null, billRef || null,
          msisdn ? String(msisdn).replace(/^(\d{7})\d{3,4}(\d{2})$/, '$1****$2') : null, senderName || null,
          JSON.stringify(raw || {}), status, studentId])).rows[0];

      const accounts = (await client.query(
        `SELECT code, name FROM chart_of_accounts WHERE tenant_id = $1 AND code IN ('1010','1200','2100')`,
        [tenantId])).rows;
      const byCode = Object.fromEntries(accounts.map((a) => [a.code, a.name]));
      const credit = studentId ? { code: '1200', name: byCode['1200'] || 'Accounts Receivable — Education' }
        : { code: '2100', name: byCode['2100'] || 'Suspense — Unallocated Receipts' };
      const payload = { trans_id: transId, amount, bill_ref: billRef || null, status,
        student_id: studentId,
        msisdn_masked: msisdn ? String(msisdn).replace(/^(\d{7})\d{3,4}(\d{2})$/, '$1****$2') : null,
        postings: { debit: '1010', credit: credit.code } };
      const chained = await appendEvent(client, tenantId, 'C2B_INGEST', transId, payload, secret);
      if (byCode['1010']) {
        await client.query(
          `INSERT INTO ledger_postings (tenant_id, event_id, account_code, account_name, side, amount, memo)
           VALUES ($1,$2,'1010',$3,'DEBIT',$4,$5), ($1,$2,$6,$7,'CREDIT',$4,$8)`,
          [tenantId, chained.id, byCode['1010'], amount, `M-Pesa receipt ${transId}`, credit.code, credit.name,
            studentId ? `Receipt ${transId} allocated` : `Receipt ${transId} in suspense (BillRef: ${billRef || '—'})`]);
      }
      await client.query('COMMIT');
      return { event_id: ev.id, seq: chained.tenant_seq, hash: chained.hash, status, student_id: studentId };
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    finally { client.release(); }
  }

  /* ------------------------------ routes -------------------------------- */

  app.get(['/api/v1/finance/mpesa/events', '/finance/mpesa/events'], h(guard(async (req, res, c) => {
    if (!c.tenantId) return res.status(403).json({ success: false, message: 'No tenant in session.' });
    await ensure();
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT e.*, s.full_name student_name, s.admission_number
         FROM mpesa_c2b_events e LEFT JOIN students s ON s.id = e.student_id
         WHERE e.tenant_id = $1 ORDER BY e.created_at DESC LIMIT 200`,
        [c.tenantId]);
      const chain = await client.query(
        `SELECT ev.id, ev.event_ref, ev.tenant_seq, ev.event_type, ev.hash, ev.prev_hash, ev.created_at
         FROM ledger_events ev WHERE ev.tenant_id = $1 AND ev.event_ref IS NOT NULL`, [c.tenantId]);
      const chainMap = {};
      chain.rows.forEach((r) => { (chainMap[r.event_ref] ||= []).push(r); });
      const post = await client.query(
        `SELECT p.event_id, p.account_code, p.account_name, p.side, p.amount, p.memo
         FROM ledger_postings p JOIN ledger_events ev ON ev.id = p.event_id
         WHERE ev.tenant_id = $1 ORDER BY p.account_code`, [c.tenantId]);
      const postMap = {};
      post.rows.forEach((p) => { (postMap[p.event_id] ||= []).push(p); });
      const out = rows.map((e) => ({
        event_id: e.id, trans_id: e.trans_id, trans_time: e.trans_time,
        trans_amount: e.trans_amount, business_short_code: e.business_short_code,
        bill_ref_number: e.bill_ref_number, msisdn_masked: e.msisdn_masked,
        sender_name: e.sender_name, status: e.status, ingest_source: e.ingest_source,
        created_at: e.created_at, student_id: e.student_id,
        student_name: e.student_name, admission_number: e.admission_number,
        postings: (chainMap[e.trans_id] || []).flatMap((ch) => (postMap[ch.id] || []).map((p) => ({ ...p, chain_seq: ch.tenant_seq }))),
        chain: (chainMap[e.trans_id] || []).map((ch) => ({
          seq: ch.tenant_seq, event_type: ch.event_type, hash: ch.hash, prev_hash: ch.prev_hash, chained_at: ch.created_at,
        })),
      }));
      const orphans = out.filter((o) => o.status === 'SUSPENSE');
      for (const o of orphans) o.suggestions = await suggestMatches(client, c.tenantId, o);
      return res.json({ success: true, data: out, stats: {
        total: out.length, allocated: out.filter((o) => o.status === 'ALLOCATED').length,
        suspense: orphans.length,
        sync_percent: out.length ? Math.round((out.filter((o) => o.status === 'ALLOCATED').length / out.length) * 1000) / 10 : 100,
      } });
    } finally { client.release(); }
  }, FIN)));

  app.get(['/api/v1/finance/mpesa/events/:id/suggestions', '/finance/mpesa/events/:id/suggestions'], h(guard(async (req, res, c) => {
    if (!c.tenantId) return res.status(403).json({ success: false, message: 'No tenant in session.' });
    await ensure();
    const client = await pool.connect();
    try {
      const ev = (await client.query('SELECT * FROM mpesa_c2b_events WHERE id = $1 AND tenant_id = $2',
        [req.params.id, c.tenantId])).rows[0];
      if (!ev) return res.status(404).json({ success: false, message: 'Event not found.' });
      return res.json({ success: true, data: await suggestMatches(client, c.tenantId, ev) });
    } finally { client.release(); }
  }, FIN)));

  app.patch(['/api/v1/finance/mpesa/events/:id/resolve', '/finance/mpesa/events/:id/resolve'], h(guard(async (req, res, c) => {
    if (!c.tenantId) return res.status(403).json({ success: false, message: 'No tenant in session.' });
    const sid = req.body?.student_id;
    if (!sid) return res.status(400).json({ success: false, message: 'student_id is required.' });
    await ensure();
    const secret = await hmacKey();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const ev = (await client.query(
        `SELECT e.*, s.admission_number AS s_adm, s.full_name AS s_name FROM mpesa_c2b_events e
         LEFT JOIN students s ON s.id = e.student_id
         WHERE e.id = $1 AND e.tenant_id = $2 FOR UPDATE OF e`,
        [req.params.id, c.tenantId])).rows[0];
      if (!ev) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Event not found.' }); }
      if (ev.status === 'ALLOCATED') { await client.query('ROLLBACK'); return res.status(409).json({ success: true, message: 'Already allocated.', event_id: ev.id }); }
      const target = (await client.query('SELECT id, full_name, admission_number FROM students WHERE id = $1 AND tenant_id = $2',
        [sid, c.tenantId])).rows[0];
      if (!target) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Student not found in your school.' }); }

      await client.query(`UPDATE mpesa_c2b_events SET status = 'ALLOCATED', student_id = $2 WHERE id = $1`, [ev.id, sid]);

      /* Move the credit out of suspense on to A/R (left-leg Dr 2100 already posted at ingest). */
      const acct = (await client.query(
        `SELECT code, name FROM chart_of_accounts WHERE tenant_id = $1 AND code IN ('1200','2100')`, [c.tenantId])).rows;
      const byCode = Object.fromEntries(acct.map((a) => [a.code, a.name]));
      const chain = (await client.query(
        `SELECT id, tenant_seq FROM ledger_events WHERE tenant_id = $1 AND event_type = 'C2B_INGEST' AND event_ref = $2`,
        [c.tenantId, ev.trans_id])).rows[0];
      if (chain && byCode['2100'] && byCode['1200']) {
        await client.query(
          `INSERT INTO ledger_postings (tenant_id, event_id, account_code, account_name, side, amount, memo)
           VALUES ($1,$2,'2100',$3,'DEBIT',$4,$5), ($1,$2,'1200',$6,'CREDIT',$4,$7)`,
          [c.tenantId, chain.id, byCode['2100'], ev.trans_amount,
            `Resolve suspense ${ev.trans_id}`, byCode['1200'],
            `Allocated to ${target.admission_number} ${target.full_name}`]);
      }
      const payload = { resolves: ev.trans_id, student_id: sid, student: target.admission_number, amount: ev.trans_amount };
      const chained = await appendEvent(client, c.tenantId, 'C2B_RESOLVE', ev.trans_id, payload, secret);

      /* Keep the dinero side consistent: fold the receipt into payments + fee_balances. */
      const payRef = ev.trans_id;
      const dupPay = (await client.query('SELECT id FROM payments WHERE payment_reference = $1', [payRef])).rows[0];
      if (!dupPay && ev.trans_amount > 0) {
        await client.query(
          `INSERT INTO payments (tenant_id, student_id, payment_reference, source, status, amount, learner_label, receipt_no, recorded_at, recorded_by)
           VALUES ($1,$2,$3,'MPESA','COMPLETED',$4,$5,$6,now(),$7)`,
          [c.tenantId, sid, payRef, ev.trans_amount, target.full_name, ev.trans_id, c.userId]);
        await client.query(
          `INSERT INTO fee_balances (tenant_id, student_id, total_paid) VALUES ($1,$2,$3)
           ON CONFLICT (tenant_id, student_id) DO UPDATE SET total_paid = fee_balances.total_paid + EXCLUDED.total_paid`,
          [c.tenantId, sid, ev.trans_amount]);
      }

      await client.query(
        'INSERT INTO audit_log (tenant_id, actor_id, actor_email, action, resource_type, resource_id, ip, detail) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [c.tenantId, c.userId, c.email, 'C2B_RESOLVE', 'mpesa_c2b_events', ev.id, c.ip,
          `${ev.trans_id} → ${target.admission_number} (${target.full_name})`]);
      await client.query('COMMIT');
      return res.json({ success: true, message: `${ev.trans_id} allocated to ${target.full_name} (${target.admission_number})`,
        ledger_seq: chained.tenant_seq, ledger_hash: chained.hash });
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    finally { client.release(); }
  }, ADMIN_ROLES)));

  /* Simulate an inbound Daraja-style C2B webhook (pitch/demo + QA harness).
   * Goes through the REAL pipeline: matching, postings, chain append. */
  app.post(['/api/v1/finance/mpesa/simulate-webhook', '/finance/mpesa/simulate-webhook'], h(guard(async (req, res, c) => {
    if (!c.tenantId) return res.status(403).json({ success: false, message: 'No tenant in session.' });
    const amount = Number(req.body?.amount || 0) || 45000;
    const billRef = String(req.body?.bill_ref_number || 'ADM8821').slice(0, 64);
    const senderName = String(req.body?.first_name || 'MARY WANJIKU').toUpperCase().slice(0, 128);
    const result = await ingestC2B({
      tenantId: c.tenantId,
      transId: req.body?.trans_id || `SIM${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
      transTime: new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14),
      amount, shortcode: '600112', billRef, msisdn: '2547' + String(Math.floor(Math.random() * 8e7) + 1e7),
      senderName, raw: { simulated: true, TransType: 'Pay Bill', BillRefNumber: billRef, TransAmount: amount },
    });
    if (result?.duplicate) return res.status(409).json({ success: true, message: 'This receipt has already been ingested (idempotent).', event_id: result.event_id });
    return res.status(201).json({ success: true, ...result });
  }, ADMIN_ROLES)));

  /* Reconciliation integrity: recompute the tenant chain from GENESIS. */
  app.get(['/api/v1/finance/ledger/verify', '/finance/ledger/verify'], h(guard(async (req, res, c) => {
    if (!c.tenantId) return res.status(403).json({ success: false, message: 'No tenant in session.' });
    await ensure();
    const secret = await hmacKey();
    const client = await pool.connect();
    try {
      const events = (await client.query(
        `SELECT tenant_seq, event_type, event_ref, payload, prev_hash, hash FROM ledger_events
         WHERE tenant_id = $1 ORDER BY tenant_seq`, [c.tenantId])).rows;
      let prev = 'GENESIS'; let valid = true; let brokeAt = null;
      for (const e of events) {
        const envelope = CANON({ seq: e.tenant_seq, type: e.event_type, ref: e.event_ref || '', payload: e.payload });
        const expect = crypto.createHmac('sha256', secret).update(`${e.tenant_seq}|${prev}|${envelope}`).digest('hex');
        if (expect !== e.hash || e.prev_hash !== prev) { valid = false; brokeAt = e.tenant_seq; break; }
        prev = e.hash;
      }
      const st = (await client.query('SELECT last_seq, last_hash FROM ledger_chain_state WHERE tenant_id = $1',
        [c.tenantId])).rows[0] || { last_seq: 0, last_hash: 'GENESIS' };
      return res.json({ success: true, valid, depth: events.length, broke_at: brokeAt,
        chain_head: { seq: st.last_seq, hash: st.last_hash,
          integrity: valid && (st.last_hash === prev || st.last_seq === 0) ? 'VERIFIED' : 'MISMATCH' } });
    } finally { client.release(); }
  }, FIN)));

  /* Board-ready pack: real computed summary + verifiable stamp. */
  app.get(['/api/v1/finance/board-pack', '/finance/board-pack'], h(guard(async (req, res, c) => {
    if (!c.tenantId) return res.status(403).json({ success: false, message: 'No tenant in session.' });
    await ensure();
    const secret = await hmacKey();
    const client = await pool.connect();
    try {
      const inv = (await client.query(
        `SELECT COUNT(*) n, COALESCE(SUM(total_amount),0) total, COALESCE(SUM(amount_paid),0) paid,
                COALESCE(SUM(amount_outstanding),0) outstanding FROM invoices WHERE tenant_id = $1`,
        [c.tenantId])).rows[0];
      const pay = (await client.query(
        `SELECT COALESCE(SUM(amount),0) total, COUNT(*) n FROM payments WHERE tenant_id = $1`, [c.tenantId])).rows[0];
      const learners = (await client.query(
        `SELECT COUNT(*) n FROM students WHERE tenant_id = $1`, [c.tenantId])).rows[0].n;
      const debtors = (await client.query(
        `SELECT COUNT(*) n FROM invoices WHERE tenant_id = $1 AND amount_outstanding > 0`, [c.tenantId])).rows[0].n;
      const collectionRate = Number(inv.total) > 0 ? Math.round((Number(inv.paid) / Number(inv.total)) * 1000) / 10 : 0;
      const summary = {
        tenant: c.tenantId, generated_for: c.email, generated_at: new Date().toISOString(),
        learners, invoices: Number(inv.n), invoiced_total: Number(inv.total),
        collected_ledger: Number(pay.total), collected_invoices: Number(inv.paid),
        outstanding: Number(inv.outstanding), invoices_with_balance: Number(debtors),
        collection_rate_percent: collectionRate,
      };
      const envelope = CANON(summary);
      const code = crypto.createHmac('sha256', `${secret}:board-pack`).update(envelope).digest('hex').slice(0, 24).toUpperCase();
      return res.json({ success: true, pack: summary, verification: { code, method: 'HMAC-SHA256(board-pack envelope)', verifier: 'GET /finance/board-pack?verify=' + code } });
    } finally { client.release(); }
  }, FIN)));

  app.get(['/api/v1/finance/board-pack/verify', '/finance/board-pack/verify'], h(guard(async (req, res, c) => {
    if (!c.tenantId) return res.status(403).json({ success: false, message: 'No tenant in session.' });
    await ensure();
    const secret = await hmacKey();
    const client = await pool.connect();
    try {
      const inv = (await client.query(
        `SELECT COUNT(*) n, COALESCE(SUM(total_amount),0) total, COALESCE(SUM(amount_paid),0) paid,
                COALESCE(SUM(amount_outstanding),0) outstanding FROM invoices WHERE tenant_id = $1`,
        [c.tenantId])).rows[0];
      const pay = (await client.query(`SELECT COALESCE(SUM(amount),0) total FROM payments WHERE tenant_id = $1`, [c.tenantId])).rows[0];
      const learners = (await client.query(`SELECT COUNT(*) n FROM students WHERE tenant_id = $1`, [c.tenantId])).rows[0].n;
      const debtors = (await client.query(`SELECT COUNT(*) n FROM invoices WHERE tenant_id = $1 AND amount_outstanding > 0`, [c.tenantId])).rows[0].n;
      const collectionRate = Number(inv.total) > 0 ? Math.round((Number(inv.paid) / Number(inv.total)) * 1000) / 10 : 0;
      const summary = { tenant: c.tenantId, generated_for: c.email, generated_at: new Date().toISOString(),
        learners, invoices: Number(inv.n), invoiced_total: Number(inv.total), collected_ledger: Number(pay.total),
        collected_invoices: Number(inv.paid), outstanding: Number(inv.outstanding),
        invoices_with_balance: Number(debtors), collection_rate_percent: collectionRate };
      const code = crypto.createHmac('sha256', `${secret}:board-pack`).update(CANON(summary)).digest('hex').slice(0, 24).toUpperCase();
      return res.json({ success: true, matches: code === String(req.query.code || '').toUpperCase(), current_code: code });
    } finally { client.release(); }
  }, FIN)));

  return { ingestC2B, ensure, hmacKey, suggestMatches };
}

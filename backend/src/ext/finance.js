/* Finance domain: categories, structures, invoices (+fee_balances), payments
 * (+allocation), credits, adjustments, refunds, reconciliation, M-Pesa ledger,
 * STK push requests. Parents are scoped to their children on GETs. */
import crypto from 'node:crypto';
import { guard, h, isParentRole, money, ref, today, FIN_ADMIN } from './context.js';

export function installFinance(app, deps) {
  const { pool, childIdsOf } = deps;
  const A = (paths, handler, allowed) => app.get((Array.isArray(paths) ? paths : [paths]).map((p) => `/api/v1${p}`), h(guard(handler, allowed)));

  /* ------------------------- fee categories ------------------------- */

  app.get(['/api/v1/finance/fee-categories', '/finance/fee-categories'], h(guard(async (req, res, c) => {
    if (!c.tenantId) return res.status(403).json({ success: false, message: 'No tenant in session.' });
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT id, code, name, description, is_tuition, is_optional, requires_consent, is_active, is_custom
         FROM fee_categories WHERE tenant_id = $1 ORDER BY name`, [c.tenantId]);
      return res.json(rows.map((r) => ({ ...r, category_id: r.id })));
    } finally { client.release(); }
  }, FIN_ADMIN)));

  app.post(['/api/v1/finance/fee-categories', '/finance/fee-categories'], h(guard(async (req, res, c) => {
    const b = req.body || {};
    const fieldErrors = [];
    if (!b.name) fieldErrors.push({ field: 'name', message: 'Name is required' });
    if (!b.code) fieldErrors.push({ field: 'code', message: 'Code is required' });
    if (fieldErrors.length) return res.status(400).json({ success: false, message: 'Validation failed', field_errors: fieldErrors });
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `INSERT INTO fee_categories (tenant_id, code, name, description, is_tuition, is_optional, requires_consent, is_custom)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true) RETURNING id`,
        [c.tenantId, b.code, b.name, b.description || null, !!b.is_tuition, !!b.is_optional, !!b.requires_consent]);
      await client.query('INSERT INTO audit_log (tenant_id, actor_id, actor_email, action, resource_type, resource_id, ip) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [c.tenantId, c.userId, c.email, 'CREATE', 'fee_category', rows[0].id, c.ip]);
      return res.status(201).json({ success: true, category_id: rows[0].id, message: 'Fee category created' });
    } finally { client.release(); }
  }, FIN_ADMIN)));

  app.patch(['/api/v1/finance/fee-categories/:id', '/finance/fee-categories/:id'], h(guard(async (req, res, c) => {
    const b = req.body || {};
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `UPDATE fee_categories SET name = COALESCE($3, name), description = COALESCE($4, description),
         is_tuition = COALESCE($5, is_tuition), is_optional = COALESCE($6, is_optional),
         requires_consent = COALESCE($7, requires_consent), is_active = COALESCE($8, is_active)
         WHERE id = $2 AND tenant_id = $1 RETURNING id`,
        [c.tenantId, req.params.id, b.name || null, b.description || null,
          b.is_tuition ?? null, b.is_optional ?? null, b.requires_consent ?? null, b.is_active ?? null]);
      if (!rows.length) return res.status(404).json({ success: false, message: 'Category not found' });
      return res.json({ success: true, category_id: rows[0].id, message: 'Fee category updated' });
    } finally { client.release(); }
  }, FIN_ADMIN)));

  app.delete(['/api/v1/finance/fee-categories/:id', '/finance/fee-categories/:id'], h(guard(async (req, res, c) => {
    const client = await pool.connect();
    try {
      const { rowCount } = await client.query('DELETE FROM fee_categories WHERE id = $1 AND tenant_id = $2', [req.params.id, c.tenantId]);
      if (!rowCount) return res.status(404).json({ success: false, message: 'Category not found' });
      return res.json({ success: true, message: 'Fee category deleted' });
    } finally { client.release(); }
  }, FIN_ADMIN)));

  /* ------------------------- fee structures ------------------------- */

  app.get(['/api/v1/finance/fee-structures', '/finance/fee-structures'], h(guard(async (req, res, c) => {
    if (!c.tenantId) return res.status(403).json({ success: false, message: 'No tenant in session.' });
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT fs.id AS structure_id, fs.grade_label AS grade_id, fc.code AS category_code, fc.name AS category_name,
                fs.amount_per_term, fs.amount_per_year, fs.currency, fs.payment_frequency, fs.is_mandatory, fs.due_day
         FROM fee_structures fs LEFT JOIN fee_categories fc ON fc.id = fs.category_id
         WHERE fs.tenant_id = $1 ORDER BY fs.grade_label, fc.name`, [c.tenantId]);
      return res.json(rows);
    } finally { client.release(); }
  })));

  app.post(['/api/v1/finance/fee-structures', '/finance/fee-structures'], h(guard(async (req, res, c) => {
    const b = req.body || {};
    const fieldErrors = [];
    if (!b.grade_id && !b.grade_label) fieldErrors.push({ field: 'grade_id', message: 'Grade is required' });
    if (!b.category_id) fieldErrors.push({ field: 'category_id', message: 'Category is required' });
    if (!Number.isFinite(Number(b.amount_per_term))) fieldErrors.push({ field: 'amount_per_term', message: 'Amount must be a number' });
    if (fieldErrors.length) return res.status(400).json({ success: false, message: 'Validation failed', field_errors: fieldErrors });
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `INSERT INTO fee_structures (tenant_id, category_id, grade_label, amount_per_term, amount_per_year,
          currency, payment_frequency, is_mandatory, due_day)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [c.tenantId, b.category_id, b.grade_label || b.grade_id,
          money(b.amount_per_term), money(b.amount_per_year) || money(b.amount_per_term) * 3,
          b.currency || 'KES', b.payment_frequency || 'PER_TERM', b.is_mandatory ?? true, b.due_day ?? null]);
      return res.status(201).json({ success: true, structure_id: rows[0].id, message: 'Fee structure registered' });
    } finally { client.release(); }
  }, FIN_ADMIN)));

  /* --------------------------- invoices ----------------------------- */

  app.get(['/api/v1/finance/invoices', '/finance/invoices'], h(guard(async (req, res, c) => {
    if (!c.tenantId) return res.status(403).json({ success: false, message: 'No tenant in session.' });
    const client = await pool.connect();
    try {
      let rows;
      if (isParentRole(c.role)) {
        const children = await childIdsOf(client, c);
        rows = children.length
          ? (await client.query(
              `SELECT i.*, s.full_name AS learner_name, s.admission_number
               FROM invoices i LEFT JOIN students s ON s.id = i.student_id
               WHERE i.tenant_id = $1 AND i.student_id = ANY($2::uuid[])
               ORDER BY i.created_at DESC`, [c.tenantId, children])).rows
          : [];
      } else {
        rows = (await client.query(
          `SELECT i.*, s.full_name AS learner_name, s.admission_number
           FROM invoices i LEFT JOIN students s ON s.id = i.student_id
           WHERE i.tenant_id = $1 ORDER BY i.created_at DESC`, [c.tenantId])).rows;
      }
      return res.json(rows.map((r) => ({
        invoice_id: r.id, invoice_number: r.invoice_number, term_id: r.term_id,
        learner_id: r.student_id, learner: r.learner_name || r.admission_number || null,
        learner_name: r.learner_name || null, admission_number: r.admission_number || null,
        description: r.description, status: r.status,
        total_amount: r.total_amount, amount_paid: r.amount_paid, amount_outstanding: r.amount_outstanding,
        total: r.total_amount, paid: r.amount_paid, outstanding: r.amount_outstanding,
        due_date: r.due_date, created_at: r.created_at,
      })));
    } finally { client.release(); }
  })));

  app.post(['/api/v1/finance/invoices', '/finance/invoices'], h(guard(async (req, res, c) => {
    const b = req.body || {};
    const fieldErrors = [];
    if (!b.learner_id) fieldErrors.push({ field: 'learner_id', message: 'Learner is required' });
    const amount = money(b.amount ?? b.total_amount);
    if (amount <= 0) fieldErrors.push({ field: 'amount', message: 'Amount must be greater than zero' });
    if (fieldErrors.length) return res.status(400).json({ success: false, message: 'Validation failed', field_errors: fieldErrors });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const learner = await client.query(
        'SELECT full_name, admission_number FROM students WHERE id = $1 AND tenant_id = $2', [b.learner_id, c.tenantId]);
      if (!learner.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Learner not found in your school' }); }
      const seq = (await client.query('SELECT COUNT(*)::int AS n FROM invoices WHERE tenant_id = $1', [c.tenantId])).rows[0].n + 1;
      const settings = await client.query(
        `INSERT INTO finance_settings (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`, [c.tenantId]);
      const prefix = (await client.query('SELECT invoice_prefix FROM finance_settings WHERE tenant_id = $1', [c.tenantId])).rows[0]?.invoice_prefix || 'INV';
      const invoiceNumber = `${prefix}-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`;
      const { rows } = await client.query(
        `INSERT INTO invoices (tenant_id, student_id, invoice_number, term_id, description, total_amount, due_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, invoice_number`,
        [c.tenantId, b.learner_id, invoiceNumber, b.term_id || null, b.description || null, amount, b.due_date || null]);
      await client.query(
        `INSERT INTO fee_balances (tenant_id, student_id, total_invoiced) VALUES ($1,$2,$3)
         ON CONFLICT (tenant_id, student_id) DO UPDATE SET total_invoiced = fee_balances.total_invoiced + $3`,
        [c.tenantId, b.learner_id, amount]);
      await client.query('COMMIT');
      await client.query('INSERT INTO audit_log (tenant_id, actor_id, actor_email, action, resource_type, resource_id, ip) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [c.tenantId, c.userId, c.email, 'CREATE', 'invoice', rows[0].id, c.ip]);
      return res.status(201).json({ success: true, invoice_id: rows[0].id, invoice_number: rows[0].invoice_number, message: `Invoice ${rows[0].invoice_number} generated` });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally { client.release(); }
  }, FIN_ADMIN)));

  /* --------------------------- payments ----------------------------- */

  app.get(['/api/v1/finance/payments', '/finance/payments'], h(guard(async (req, res, c) => {
    if (!c.tenantId) return res.status(403).json({ success: false, message: 'No tenant in session.' });
    const client = await pool.connect();
    try {
      let rows;
      if (isParentRole(c.role)) {
        const children = await childIdsOf(client, c);
        rows = children.length
          ? (await client.query(
              `SELECT p.*, s.full_name AS learner_name
               FROM payments p LEFT JOIN students s ON s.id = p.student_id
               WHERE p.tenant_id = $1 AND p.student_id = ANY($2::uuid[]) ORDER BY p.recorded_at DESC`, [c.tenantId, children])).rows
          : [];
      } else {
        rows = (await client.query(
          `SELECT p.*, s.full_name AS learner_name FROM payments p LEFT JOIN students s ON s.id = p.student_id
           WHERE p.tenant_id = $1 ORDER BY p.recorded_at DESC`, [c.tenantId])).rows;
      }
      return res.json(rows.map((r) => ({
        payment_id: r.id, payment_reference: r.payment_reference, reference: r.payment_reference,
        learner_id: r.student_id, learner: r.learner_label || r.learner_name || null, learner_name: r.learner_name || null,
        source: r.source, payment_method: r.source, status: r.status,
        amount: r.amount, recorded_at: r.recorded_at, recorded_by: r.recorded_by,
        receipt_id: r.id,
      })));
    } finally { client.release(); }
  })));

  app.post(['/api/v1/finance/payments', '/finance/payments'], h(guard(async (req, res, c) => {
    const b = req.body || {};
    const fieldErrors = [];
    const amount = money(b.amount);
    if (amount <= 0) fieldErrors.push({ field: 'amount', message: 'Amount must be greater than zero' });
    if (fieldErrors.length) return res.status(400).json({ success: false, message: 'Validation failed', field_errors: fieldErrors });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let studentId = null, learnerLabel = null;
      if (b.invoice_id) {
        const inv = await client.query('SELECT student_id FROM invoices WHERE id = $1 AND tenant_id = $2', [b.invoice_id, c.tenantId]);
        if (!inv.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Invoice not found in your school' }); }
        studentId = inv.rows[0].student_id;
      } else if (b.learner_id) {
        studentId = b.learner_id;
      }
      if (studentId) {
        learnerLabel = (await client.query('SELECT full_name FROM students WHERE id = $1', [studentId])).rows[0]?.full_name || null;
      }
      const paymentReference = b.reference || ref('PAY');
      const source = String(b.payment_method || b.source || 'CASH').toUpperCase().replace(/[^A-Z_]/g, '') || 'CASH';
      const { rows } = await client.query(
        `INSERT INTO payments (tenant_id, student_id, invoice_id, payment_reference, source, amount, learner_label, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, payment_reference`,
        [c.tenantId, studentId, b.invoice_id || null, paymentReference, source, amount, learnerLabel, c.userId]);
      if (b.invoice_id) {
        const updated = await client.query(
          `UPDATE invoices SET amount_paid = LEAST(amount_paid + $3, total_amount),
             status = CASE WHEN amount_paid + $3 >= total_amount THEN 'PAID' ELSE 'PARTIALLY_PAID' END
           WHERE id = $1 AND tenant_id = $2 RETURNING status`, [b.invoice_id, c.tenantId, amount]);
        if (updated.rows[0]?.status && studentId) {
          // recompute balance rows
          await client.query(
            `UPDATE fee_balances SET total_paid = COALESCE((SELECT SUM(amount_paid) FROM invoices WHERE student_id = $2 AND tenant_id = $1), 0)
             WHERE tenant_id = $1 AND student_id = $2`, [c.tenantId, studentId]);
        }
      } else if (studentId) {
        await client.query(
          `INSERT INTO fee_balances (tenant_id, student_id, total_invoiced) VALUES ($1,$2,0)
           ON CONFLICT (tenant_id, student_id) DO UPDATE SET total_paid = fee_balances.total_paid + $3`,
          [c.tenantId, studentId, amount]);
      }
      await client.query('COMMIT');
      return res.status(201).json({
        success: true, payment_id: rows[0].id, payment_reference: rows[0].payment_reference,
        message: `Payment recorded and allocated`,
      });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally { client.release(); }
  }, FIN_ADMIN)));

  /* ------------------- derived ledgers & reports -------------------- */

  app.get(['/api/v1/finance/mpesa/transactions', '/finance/mpesa/transactions'], h(guard(async (req, res, c) => {
    if (!c.tenantId) return res.status(403).json({ success: false, message: 'No tenant in session.' });
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT mpesa_receipt_number, phone_number, amount, transaction_date, raw_payload, account_reference
         FROM fee_payments WHERE tenant_id = $1 ORDER BY COALESCE(transaction_date, created_at) DESC LIMIT 500`, [c.tenantId]);
      return res.json(rows.map((r) => {
        const phone = r.phone_number || '';
        return {
          external_trans_id: r.mpesa_receipt_number,
          msisdn_masked: phone.length >= 6 ? `${phone.slice(0, 6)}${'*'.repeat(Math.max(0, phone.length - 6))}` : phone,
          msisdn: phone,
          amount: r.amount, transaction_type: 'C2B', status: 'COMPLETED',
          account_reference: r.account_reference, transaction_date: r.transaction_date,
        };
      }));
    } finally { client.release(); }
  })));

  app.get(['/api/v1/finance/reconciliation/runs', '/finance/reconciliation/runs'], h(guard(async (req, res, c) => {
    if (!c.tenantId) return res.status(403).json({ success: false, message: 'No tenant in session.' });
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT id, period_start, period_end, period, status, total_expected, total_matched, variance, created_at
         FROM reconciliation_runs WHERE tenant_id = $1 ORDER BY created_at DESC`, [c.tenantId]);
      return res.json(rows.map((r) => ({
        run_id: r.id, period: r.period || (r.period_start ? `${r.period_start} → ${r.period_end || r.period_start}` : '—'),
        status: r.status, total_expected: r.total_expected, total_matched: r.total_matched,
        total: r.total_expected, matched: r.total_matched, variance: r.variance, created_at: r.created_at,
      })));
    } finally { client.release(); }
  })));

  app.get(['/api/v1/finance/credits', '/finance/credits'], h(guard(async (req, res, c) => {
    if (!c.tenantId) return res.status(403).json({ success: false, message: 'No tenant in session.' });
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT id, credit_reference, learner_id, student_id AS learner_id_alt, learner_label, amount, reason, created_at
         FROM fee_credits WHERE tenant_id = $1 ORDER BY created_at DESC`, [c.tenantId]);
      return res.json(rows.map((r) => ({
        credit_id: r.id, credit_reference: r.credit_reference, learner_id: r.learner_id || r.learner_id_alt,
        learner: r.learner_label, amount: r.amount, reason: r.reason, created_at: r.created_at,
      })));
    } finally { client.release(); }
  })));

  app.get(['/api/v1/finance/adjustments', '/finance/adjustments'], h(guard(async (req, res, c) => {
    if (!c.tenantId) return res.status(403).json({ success: false, message: 'No tenant in session.' });
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT a.id, a.adjustment_reference, a.invoice_id, a.amount, a.direction, a.reason, a.created_at,
                i.invoice_number
         FROM fee_adjustments a LEFT JOIN invoices i ON i.id = a.invoice_id
         WHERE a.tenant_id = $1 ORDER BY a.created_at DESC`, [c.tenantId]);
      return res.json(rows.map((r) => ({
        adjustment_id: r.id, adjustment_reference: r.adjustment_reference, invoice_id: r.invoice_id,
        invoice_number: r.invoice_number, invoice: r.invoice_number, amount: r.amount,
        direction: r.direction, reason: r.reason, created_at: r.created_at,
      })));
    } finally { client.release(); }
  })));

  app.get(['/api/v1/finance/refunds', '/finance/refunds'], h(guard(async (req, res, c) => {
    if (!c.tenantId) return res.status(403).json({ success: false, message: 'No tenant in session.' });
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT r.id, r.refund_reference, r.payment_id, r.amount, r.status, r.created_at
         FROM fee_refunds r WHERE r.tenant_id = $1 ORDER BY r.created_at DESC`, [c.tenantId]);
      return res.json(rows.map((r) => ({
        refund_id: r.id, refund_reference: r.refund_reference, payment_id: r.payment_id,
        amount: r.amount, status: r.status, created_at: r.created_at,
      })));
    } finally { client.release(); }
  })));

  /* ------------------------ STK push requests ----------------------- */

  app.post(['/api/v1/finance/mpesa/stk-requests', '/finance/mpesa/stk-requests'], h(guard(async (req, res, c) => {
    const b = req.body || {};
    const amount = money(b.amount);
    const phone = String(b.phone || '').trim();
    if (amount <= 0) return res.status(400).json({ success: false, message: 'Amount must be greater than zero.' });
    if (!/^0[17]\d{8}$/.test(phone.replace(/\s|\+/g, '').replace(/^254/, '0'))) {
      return res.status(400).json({ success: false, message: 'A valid Safaricom number (07XXXXXXXX) is required.' });
    }
    const client = await pool.connect();
    try {
      const settings = (await client.query('SELECT paybill, stk_enabled FROM finance_settings WHERE tenant_id = $1', [c.tenantId])).rows[0];
      const { rows } = await client.query(
        `INSERT INTO mpesa_stk_requests (tenant_id, parent_user_id, student_id, amount, phone, status, checkout_request_id)
         VALUES ($1,$2,$3,$4,$5, $6, $7) RETURNING id, checkout_request_id`,
        [c.tenantId, c.userId, b.student_id || b.learner_id || null, amount, phone,
          settings?.stk_enabled === false ? 'DISABLED' : 'PENDING',
          `ws_CO_${Date.now()}_${crypto.randomInt(0x100000, 0xffffff).toString(36).toUpperCase()}`]);
      return res.json({
        success: true,
        checkout_request_id: rows[0].checkout_request_id,
        status: 'PENDING',
        paybill: settings?.paybill || null,
        message: 'STK push initiated. Enter your M-Pesa PIN on the prompt to complete payment.',
      });
    } finally { client.release(); }
  })));
}

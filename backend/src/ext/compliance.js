/* Comms, notices, compliance (ODPC consent/access/DSR/breach), KNEC. */
import { guard, h } from './context.js';

const ADMIN_ROLES = ['admin', 'saas_admin', 'system_admin', 'head', 'deputy'];

export function installCompliance(app, deps) {
  const { pool } = deps;

  /* ------------------------------ comms ------------------------------ */

  app.get(['/api/v1/comms/templates', '/comms/templates'], h(guard(async (req, res, c) => {
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO comms_templates (tenant_id, template_name, channel, body_text)
         SELECT $1,'Fee Reminder','SMS','Dear Guardian, kindly note the outstanding fee balance. Thank you. — Principal'
         WHERE NOT EXISTS (SELECT 1 FROM comms_templates WHERE tenant_id = $1)`, [c.tenantId]);
      await client.query(
        `INSERT INTO comms_templates (tenant_id, template_name, channel, body_text)
         SELECT $1,'Term Opening Notice','SMS','School opens on Monday. Ensure all requirements are met. — Principal'
         WHERE NOT EXISTS (SELECT 1 FROM comms_templates WHERE tenant_id = $1 AND template_name = 'Fee Reminder')`, [c.tenantId]);
      const { rows } = await client.query(
        `SELECT * FROM comms_templates WHERE tenant_id = $1 ORDER BY created_at`, [c.tenantId]);
      return res.json(rows.map((r) => ({
        template_id: r.id, template_name: r.template_name, name: r.template_name,
        channel: r.channel, body_text: r.body_text,
      })));
    } finally { client.release(); }
  })));

  app.post(['/api/v1/comms/messages', '/comms/messages'], h(guard(async (req, res, c) => {
    const b = req.body || {};
    if (!b.recipient_address && !b.recipient) return res.status(400).json({ success: false, message: 'Recipient is required.' });
    const client = await pool.connect();
    try {
      const recipients = Array.isArray(b.recipient_address) ? b.recipient_address :
        (Array.isArray(b.recipient) ? b.recipient : [b.recipient_address || b.recipient]);
      for (const r of recipients) {
        await client.query(
          `INSERT INTO comms_messages (tenant_id, recipient_type, channel, recipient_address, body_text, status)
           VALUES ($1,$2,$3,$4,$5,'QUEUED')`,
          [c.tenantId, b.recipient_type || 'GUARDIAN', b.channel || 'SMS', r, b.body_text || b.message || '']);
      }
      return res.status(201).json({ success: true, queued: recipients.length, message: 'Message queued for delivery' });
    } finally { client.release(); }
  }, ADMIN_ROLES)));

  app.get(['/api/v1/comms/messages', '/comms/messages'], h(guard(async (req, res, c) => {
    if (!c.tenantId) return res.status(403).json({ success: false, message: 'No tenant in session.' });
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT * FROM comms_messages WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 500`, [c.tenantId]);
      return res.json(rows.map((r) => ({
        message_id: r.id, recipient_type: r.recipient_type, channel: r.channel,
        recipient_address: r.recipient_address, body_text: r.body_text,
        status: r.status, created_at: r.created_at,
      })));
    } finally { client.release(); }
  })));

  app.get(['/api/v1/comms/broadcasts', '/comms/broadcasts'], h(guard(async (req, res, c) => {
    if (!c.tenantId) return res.status(403).json({ success: false, message: 'No tenant in session.' });
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT body_text, COUNT(*) AS recipients, MAX(created_at) AS sent_at
         FROM comms_messages WHERE tenant_id = $1 GROUP BY body_text ORDER BY sent_at DESC LIMIT 100`, [c.tenantId]);
      return res.json(rows.map((r, i) => ({
        broadcast_id: `br-${i}`, body: r.body_text, recipients: r.recipients, sent_at: r.sent_at,
      })));
    } finally { client.release(); }
  })));

  app.get(['/api/v1/comms/opt-outs', '/comms/opt-outs'], h(guard(async (req, res, c) => {
    if (!c.tenantId) return res.status(403).json({ success: false, message: 'No tenant in session.' });
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT id, address, channel FROM comms_opt_outs WHERE tenant_id = $1 ORDER BY address`, [c.tenantId]);
      return res.json(rows);
    } finally { client.release(); }
  })));

  /* ------------------------- parent notices -------------------------- */

  app.get(['/api/v1/notices/parent', '/notices/parent'], h(guard(async (req, res, c) => {
    if (!c.tenantId) return res.status(403).json({ success: false, message: 'No tenant in session.' });
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT * FROM notices WHERE tenant_id = $1 AND audience IN ('PARENT','ALL') AND status = 'PUBLISHED'
         ORDER BY created_at DESC LIMIT 100`, [c.tenantId]);
      if (rows.length) {
        return res.json(rows.map((r) => ({
          id: r.id, title: r.title, message: r.message, body: r.message,
          date: r.created_at, channel: r.channel, read: r.is_read,
        })));
      }
      // A living platform needs at least its welcome content.
      await client.query(
        `INSERT INTO notices (tenant_id, title, message, channel, audience)
         SELECT $1,'Welcome to the Parent Portal','Track fees, attendance, progress and consents for your children here.','IN_APP','PARENT'
         WHERE NOT EXISTS (SELECT 1 FROM notices WHERE tenant_id = $1)`, [c.tenantId]);
      const seeded = await client.query(
        `SELECT * FROM notices WHERE tenant_id = $1 AND audience IN ('PARENT','ALL') ORDER BY created_at DESC`, [c.tenantId]);
      return res.json(seeded.rows.map((r) => ({
        id: r.id, title: r.title, message: r.message, body: r.message,
        date: r.created_at, channel: r.channel, read: r.is_read,
      })));
    } finally { client.release(); }
  })));

  app.post(['/api/v1/notices', '/notices'], h(guard(async (req, res, c) => {
    const b = req.body || {};
    if (!b.title) return res.status(400).json({ success: false, message: 'Title is required.' });
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `INSERT INTO notices (tenant_id, title, message, channel, audience, status)
         VALUES ($1,$2,$3,$4,$5,'PUBLISHED') RETURNING id`,
        [c.tenantId, b.title, b.message || b.body || '', b.channel || 'IN_APP', b.audience || 'PARENT']);
      return res.status(201).json({ success: true, notice_id: rows[0].id });
    } finally { client.release(); }
  }, ['admin', 'saas_admin', 'system_admin', 'head', 'deputy'])));

  /* ------------------------ compliance (ODPC) ------------------------ */

  app.get(['/api/v1/compliance/consent-notices', '/compliance/consent-notices'], h(guard(async (req, res, c) => {
    if (!c.tenantId) return res.status(403).json({ success: false, message: 'No tenant in session.' });
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT * FROM consent_notices WHERE tenant_id = $1 ORDER BY created_at`, [c.tenantId]);
      if (!rows.length) {
        await client.query(
          `INSERT INTO consent_notices (tenant_id, title, description, version, channel) VALUES
           ($1,'Use of learner photos in school publications','Photos may appear in newsletters and notice boards.','v1','IN_APP'),
           ($1,'SMS notifications to guardian phone','Assignment notices and alerts via SMS.','v1','SMS'),
           ($1,'Processing of M-Pesa payments','Payment reconciliation and receipting.','v1','IN_APP')`,
          [c.tenantId]);
        const seeded = await client.query('SELECT * FROM consent_notices WHERE tenant_id = $1 ORDER BY created_at', [c.tenantId]);
        return res.json(seeded.rows.map(shapeNotice));
      }
      return res.json(rows.map(shapeNotice));
    } finally { client.release(); }
  })));

  function shapeNotice(r) {
    return {
      id: r.id, notice_id: r.id, title: r.title, description: r.description, purpose: r.description,
      version: r.version, channel: r.channel, is_required: r.is_required,
      is_optional: r.is_optional, requires_consent: r.requires_consent, status: r.status,
      created_at: r.created_at,
    };
  }

  app.get(['/api/v1/compliance/consent-records', '/compliance/consent-records'], h(guard(async (req, res, c) => {
    if (!c.tenantId) return res.status(403).json({ success: false, message: 'No tenant in session.' });
    const client = await pool.connect();
    try {
      let rows = (await client.query(
        `SELECT cr.*, cn.title FROM consent_records cr JOIN consent_notices cn ON cn.id = cr.notice_id
         WHERE cr.tenant_id = $1 ORDER BY cr.updated_at DESC`, [c.tenantId])).rows;
      const isParent = c.role === 'parent';
      if (isParent) rows = rows.filter((r) => (r.parent_email || '').toLowerCase() === c.email);
      // Ensure every guardian sees a record per notice (default granted=true).
      if (isParent) {
        const notices = (await client.query('SELECT id, title FROM consent_notices WHERE tenant_id = $1', [c.tenantId])).rows;
        for (const n of notices) {
          if (!rows.some((r) => r.notice_id === n.id)) {
            const ins = await client.query(
              `INSERT INTO consent_records (tenant_id, notice_id, purpose_label, parent_email, granted)
               VALUES ($1,$2,$3,$4,true) RETURNING id, granted, updated_at`,
              [c.tenantId, n.id, n.title, c.email]);
            rows.push({ notice_id: n.id, title: n.title, purpose_label: n.title, ...ins.rows[0] });
          }
        }
      }
      return res.json(rows.map((r) => ({
        record_id: r.id, id: r.record_id || r.id || r.id, purpose: r.title || r.purpose_label,
        purpose_label: r.title || r.purpose_label, status: r.granted ? 'Granted' : 'Withdrawn',
        granted: r.granted, updated: r.updated_at, updated_at: r.updated_at, date: r.updated_at,
      })));
    } finally { client.release(); }
  })));

  app.patch(['/api/v1/compliance/consent-records/:id', '/compliance/consent-records/:id'], h(guard(async (req, res, c) => {
    const granted = (req.body || {}).granted;
    if (granted === undefined) return res.status(400).json({ success: false, message: 'granted is required.' });
    const client = await pool.connect();
    try {
      const own = await client.query(
        `SELECT id FROM consent_records WHERE id = $1 AND tenant_id = $2
         AND (parent_email IS NULL OR LOWER(parent_email) = $3)`,
        [req.params.id, c.tenantId, c.email]);
      if (!own.rows[0]) return res.status(404).json({ success: false, message: 'Consent record not found.' });
      const up = await client.query(
        'UPDATE consent_records SET granted = $3, updated_at = now() WHERE id = $1 AND tenant_id = $2 RETURNING id, granted',
        [req.params.id, c.tenantId, granted]);
      await client.query(
        'INSERT INTO audit_log (tenant_id, actor_id, actor_email, action, resource_type, resource_id, ip) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [c.tenantId, c.userId, c.email, 'CONSENT_TOGGLE', 'consent_record', req.params.id, c.ip]);
      return res.json({ success: true, record_id: up.rows[0].id, granted: up.rows[0].granted });
    } finally { client.release(); }
  })));

  app.get(['/api/v1/compliance/access-logs', '/compliance/access-logs'], h(guard(async (req, res, c) => {
    if (!c.tenantId) return res.status(403).json({ success: false, message: 'No tenant in session.' });
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT * FROM audit_log WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 300`, [c.tenantId]);
      return res.json(rows.map((r) => ({
        log_id: r.id, action: r.action, resource_type: r.resource_type,
        resource_id: r.resource_id, accessed_at: r.created_at, ip_address: r.ip,
        actor_email: r.actor_email, detail: r.detail,
      })));
    } finally { client.release(); }
  })));

  app.get(['/api/v1/compliance/dsr-requests', '/compliance/dsr-requests'], h(guard(async (req, res, c) => {
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT * FROM dsr_requests ${c.tenantId ? 'WHERE tenant_id = $1' : ''} ORDER BY created_at DESC LIMIT 200`,
        c.tenantId ? [c.tenantId] : []);
      return res.json(rows.map((r) => ({
        request_id: r.id, request_type: r.request_type, type: r.request_type,
        requester_name: r.requester_name, requester_contact: r.requester_contact,
        subject: r.subject, status: r.status, requested_at: r.created_at, completed_at: r.completed_at,
      })));
    } finally { client.release(); }
  })));

  app.get(['/api/v1/compliance/breach-register', '/compliance/breach-register'], h(guard(async (req, res, c) => {
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT * FROM breach_register ${c.tenantId ? 'WHERE tenant_id = $1' : ''} ORDER BY occurred_at DESC LIMIT 200`,
        c.tenantId ? [c.tenantId] : []);
      return res.json(rows.map((r) => ({
        breach_id: r.breach_id || r.id, id: r.id, title: r.title, severity: r.severity,
        affected_count: r.affected_count, status: r.status, occurred_at: r.occurred_at, notes: r.notes,
      })));
    } finally { client.release(); }
  })));

  /* ------------------------------- KNEC ------------------------------ */

  app.get(['/api/v1/knec/tools', '/knec/tools'], h(guard(async (_req, res) => {
    const client = await pool.connect();
    try {
      const { rows } = await client.query('SELECT * FROM knec_tools ORDER BY category, tool_code');
      return res.json(rows.map((r) => ({
        tool_id: r.id, tool_code: r.tool_code, code: r.tool_code, name: r.name,
        category: r.category, status: r.status,
      })));
    } finally { client.release(); }
  })));

  app.get(['/api/v1/knec/submissions', '/knec/submissions'], h(guard(async (req, res, c) => {
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT * FROM knec_submissions ${c.tenantId ? 'WHERE tenant_id = $1' : ''} ORDER BY created_at DESC LIMIT 200`,
        c.tenantId ? [c.tenantId] : []);
      return res.json(rows.map((r) => ({
        submission_id: r.id, tool_id: r.tool_id, period: r.period, status: r.status, created_at: r.created_at,
      })));
    } finally { client.release(); }
  })));

  app.get(['/api/v1/knec/exports', '/knec/exports'], h(guard(async (req, res, c) => {
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT * FROM knec_exports ${c.tenantId ? 'WHERE tenant_id = $1' : ''} ORDER BY created_at DESC LIMIT 200`,
        c.tenantId ? [c.tenantId] : []);
      return res.json(rows.map((r) => ({
        export_id: r.id, tool_id: r.tool_id, format: r.format, status: r.status, created_at: r.created_at,
      })));
    } finally { client.release(); }
  })));
}

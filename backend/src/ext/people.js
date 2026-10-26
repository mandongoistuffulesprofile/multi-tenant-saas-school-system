/* People & structure: staff CRUD, school profile, finance settings,
 * integration channels, curriculum versions/areas, streams, teaching
 * allocations. */
import crypto from 'node:crypto';
import { guard, h, ref } from './context.js';

const ADMIN_ROLES = ['admin', 'saas_admin', 'system_admin', 'head', 'deputy'];
const ROLE_PASS = { HEAD: 'head', DEPUTY: 'deputy', BURSAR: 'bursar', CLERK: 'clerk', TEACHER: 'teacher', ADMIN: 'admin', ACCOUNTANT: 'accountant' };

export function installPeople(app, deps) {
  const { pool, hashPassword } = deps;

  /* ----------------------------- staff ------------------------------ */

  app.get(['/api/v1/staff', '/staff'], h(guard(async (req, res, c) => {
    if (!c.tenantId) return res.status(403).json({ success: false, message: 'No tenant in session.' });
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT id, email, phone_number, role, full_name, tsc_number
         FROM users WHERE tenant_id = $1 ORDER BY created_at`, [c.tenantId]);
      return res.json(rows.map((r) => ({
        staff_id: r.id, user_id: r.id, name: r.full_name, full_name: r.full_name,
        email: r.email, phone_number: r.phone_number, phone: r.phone_number,
        role: r.role, status: 'ACTIVE', tsc_number: r.tsc_number,
      })));
    } finally { client.release(); }
  }, ADMIN_ROLES)));

  app.post(['/api/v1/staff', '/staff'], h(guard(async (req, res, c) => {
    const b = req.body || {};
    const fieldErrors = [];
    if (!b.email) fieldErrors.push({ field: 'email', message: 'Email is required' });
    if (!b.role) fieldErrors.push({ field: 'role', message: 'Role is required' });
    if (fieldErrors.length) return res.status(400).json({ success: false, message: 'Validation failed', field_errors: fieldErrors });
    const client = await pool.connect();
    try {
      const dbRole = ROLE_PASS[String(b.role).toUpperCase()] || 'teacher';
      const tempPassword = `Yna@${String(Date.now()).slice(-6)}`;
      const { rows } = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, full_name, role, phone_number, tsc_number)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (tenant_id, email) DO NOTHING
         RETURNING id, email`,
        [c.tenantId, String(b.email).toLowerCase().trim(),
          hashPassword(tempPassword), b.name || b.full_name || String(b.email).split('@')[0],
          dbRole, b.phone_number || null, b.tsc_number || null]);
      if (!rows.length) return res.status(409).json({ success: false, message: 'A staff account with that email already exists.' });
      await client.query(
        'INSERT INTO audit_log (tenant_id, actor_id, actor_email, action, resource_type, resource_id, ip) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [c.tenantId, c.userId, c.email, 'CREATE', 'staff', rows[0].id, c.ip]);
      return res.status(201).json({
        success: true, staff_id: rows[0].id, email: rows[0].email,
        // Provisional credential returned ONCE (hashed at rest).
        temp_password: tempPassword,
        message: 'Staff account created. Share the password privately.',
      });
    } finally { client.release(); }
  }, ADMIN_ROLES)));

  /* -------------------------- school profile ------------------------ */

  app.get(['/api/v1/school', '/school'], h(guard(async (req, res, c) => {
    if (!c.tenantId) return res.status(403).json({ success: false, message: 'No tenant in session.' });
    const client = await pool.connect();
    try {
      const t = await client.query('SELECT id, school_name, subdomain, plan_code, active, created_at FROM tenants WHERE id = $1', [c.tenantId]);
      if (!t.rows[0]) return res.status(404).json({ success: false, message: 'School not found.' });
      const p = await client.query('SELECT * FROM school_profile WHERE tenant_id = $1', [c.tenantId]);
      const profile = p.rows[0] || {};
      const { rowCount: learners } = await client.query('SELECT 1 FROM students WHERE tenant_id = $1 LIMIT 1', [c.tenantId]);
      return res.json({
        school_id: t.rows[0].id,
        school_name: t.rows[0].school_name,
        subdomain: t.rows[0].subdomain, school_code: t.rows[0].subdomain,
        plan_code: t.rows[0].plan_code,
        school_type: profile.school_type || 'PUBLIC_PRIMARY',
        funding_mode: profile.funding_mode || 'MoE_GRANT',
        county: profile.county || null,
        postal_address: profile.postal_address || null,
        phone: profile.phone || null, email: profile.email || null,
        motto: profile.motto || null,
        license_tier: t.rows[0].plan_code || 'STANDARD',
        status: t.rows[0].active === false ? 'SUSPENDED' : 'ACTIVE',
        has_learners: learners > 0,
        created_at: t.rows[0].created_at,
      });
    } finally { client.release(); }
  })));

  app.patch(['/api/v1/school', '/school'], h(guard(async (req, res, c) => {
    const b = req.body || {};
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO school_profile (tenant_id, school_type, funding_mode, county, postal_address, phone, email, motto, license_tier)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (tenant_id) DO UPDATE SET school_type = COALESCE($2, school_profile.school_type),
           funding_mode = COALESCE($3, school_profile.funding_mode), county = COALESCE($4, school_profile.county),
           postal_address = COALESCE($5, school_profile.postal_address), phone = COALESCE($6, school_profile.phone),
           email = COALESCE($7, school_profile.email), motto = COALESCE($8, school_profile.motto),
           license_tier = COALESCE($9, school_profile.license_tier), updated_at = now()`,
        [c.tenantId, b.school_type || null, b.funding_mode || null, b.county || null,
          b.postal_address || null, b.phone || b.phone_number || null, b.email || null,
          b.motto || null, b.license_tier || null]);
      return res.json({ success: true, message: 'School profile saved' });
    } finally { client.release(); }
  }, ADMIN_ROLES)));

  /* --------------------- finance settings/integrations ---------------- */

  app.get(['/api/v1/school/finance-settings', '/school/finance-settings'], h(guard(async (req, res, c) => {
    if (!c.tenantId) return res.status(403).json({ success: false, message: 'No tenant in session.' });
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `INSERT INTO finance_settings (tenant_id) VALUES ($1)
         ON CONFLICT (tenant_id) DO UPDATE SET updated_at = finance_settings.updated_at
         RETURNING paybill, invoice_prefix, stk_enabled, late_fee, updated_at`, [c.tenantId]);
      return res.json({ paybill: rows[0].paybill, invoice_prefix: rows[0].invoice_prefix, stk_enabled: rows[0].stk_enabled, late_fee: rows[0].late_fee });
    } finally { client.release(); }
  }, ADMIN_ROLES)));

  app.patch(['/api/v1/school/finance-settings', '/school/finance-settings'], h(guard(async (req, res, c) => {
    const b = req.body || {};
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO finance_settings (tenant_id, paybill, invoice_prefix, stk_enabled, late_fee)
         VALUES ($1, COALESCE($2, ''), COALESCE($3, 'INV'), COALESCE($4, false), COALESCE($5, 0))
         ON CONFLICT (tenant_id) DO UPDATE SET paybill = COALESCE($2, finance_settings.paybill),
           invoice_prefix = COALESCE($3, finance_settings.invoice_prefix),
           stk_enabled = COALESCE($4, finance_settings.stk_enabled),
           late_fee = COALESCE($5, finance_settings.late_fee), updated_at = now()`,
        [c.tenantId, b.paybill || null, b.invoice_prefix || null, b.stk_enabled ?? null, b.late_fee ?? null]);
      return res.json({ success: true, message: 'Finance settings saved' });
    } finally { client.release(); }
  }, ADMIN_ROLES)));

  app.get(['/api/v1/school/integrations/channels', '/school/integrations/channels'], h(guard(async (req, res, c) => {
    if (!c.tenantId) return res.status(403).json({ success: false, message: 'No tenant in session.' });
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO integration_channels (tenant_id, name, channel, provider, status)
         SELECT $1,'M-Pesa STK Push','PAYMENTS','DARAJA','healthy'
         WHERE NOT EXISTS (SELECT 1 FROM integration_channels WHERE tenant_id = $1 AND channel = 'PAYMENTS')`, [c.tenantId]);
      const { rows } = await client.query(
        `SELECT name, channel, provider, status FROM integration_channels WHERE tenant_id = $1 ORDER BY name`, [c.tenantId]);
      return res.json(rows.map((r) => ({ id: r.name?.toLowerCase().replace(/\W+/g, '_'), ...r })));
    } finally { client.release(); }
  }, ADMIN_ROLES)));

  /* ------------------ curriculum versions and areas ------------------ */

  app.get(['/api/v1/curriculum/versions', '/curriculum/versions'], h(guard(async (req, res, c) => {
    const client = await pool.connect();
    try {
      const { rows } = await client.query('SELECT * FROM curriculum_versions ORDER BY effective_from DESC');
      return res.json(rows.map((r) => ({
        version_id: r.id, version_label: r.code, code: r.code,
        description: r.description, effective_from: r.effective_from,
        is_published: r.is_published, status: r.is_published ? 'Published' : 'Draft',
      })));
    } finally { client.release(); }
  })));

  app.get(['/api/v1/curriculum/areas', '/curriculum/areas'], h(guard(async (req, res, c) => {
    const vid = req.query.version_id;
    const client = await pool.connect();
    try {
      const { rows } = vid
        ? await client.query('SELECT * FROM learning_areas WHERE version_id = $1 ORDER BY sort_order', [vid])
        : await client.query('SELECT * FROM learning_areas ORDER BY sort_order');
      return res.json(rows.map((r) => ({
        area_id: r.code, id: r.code, learning_area_id: r.code,
        code: r.code, name: r.name, grade_band: r.grade_band, sort_order: r.sort_order,
        version_id: r.version_id,
      })));
    } finally { client.release(); }
  })));

  /* ------------------------- structure ops -------------------------- */

  /* Learner placement/status update — powers Grades & Streams assignment. */
  app.patch(['/api/v1/learners/:id', '/learners/:id'], h(guard(async (req, res, c) => {
    const id = req.params.id;
    const b = req.body || {};
    if (!/^[0-9a-f-]{36}$/i.test(String(id))) return res.status(400).json({ success: false, message: 'Invalid learner id.' });
    const updates = [];
    const params = [];
    const setField = (col, key) => {
      if (b[key] !== undefined && b[key] !== null && b[key] !== '') {
        params.push(String(b[key]));
        updates.push(`${col} = $${params.length}`);
      }
    };
    setField('grade_level', 'grade_level');
    setField('grade_level', 'grade_id');
    setField('grade_level', 'grade_label');
    setField('stream', 'stream');
    setField('stream', 'stream_name');
    setField('status', 'status');
    setField('parent_email', 'parent_email');
    setField('guardian_name', 'guardian_name');
    setField('guardian_phone', 'guardian_phone');
    if (!updates.length) return res.status(400).json({ success: false, message: 'No updatable fields in payload.' });
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `UPDATE students SET ${updates.join(', ')}
         WHERE id = $${params.length + 1} AND tenant_id = $${params.length + 2} RETURNING id, full_name`,
        [...params, id, c.tenantId]);
      if (!rows[0]) return res.status(404).json({ success: false, message: 'Learner not found in your school.' });
      await client.query(
        'INSERT INTO audit_log (tenant_id, actor_id, actor_email, action, resource_type, resource_id, ip, detail) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [c.tenantId, c.userId, c.email, 'STUDENT_UPDATE', 'students', rows[0].id, c.ip, `Learner placement updated (${updates.map((u) => u.split(' =')[0]).join(', ')})`]);
      return res.json({ success: true, learner_id: rows[0].id, message: `${rows[0].full_name} updated.` });
    } finally { client.release(); }
  }, ADMIN_ROLES)));

  app.get(['/api/v1/structure/streams', '/structure/streams'], h(guard(async (req, res, c) => {
    const grade = req.query.grade_label;
    const client = await pool.connect();
    try {
      const { rows } = grade
        ? await client.query('SELECT id, grade_label, name FROM streams WHERE tenant_id = $1 AND COALESCE(grade_label,\'\') = $2 ORDER BY name', [c.tenantId, grade])
        : await client.query('SELECT id, grade_label, name FROM streams WHERE tenant_id = $1 ORDER BY COALESCE(grade_label,\'\'), name', [c.tenantId]);
      return res.json(rows.map((r) => ({ stream_id: r.id, grade_label: r.grade_label, grade_id: r.grade_label, name: r.name })));
    } finally { client.release(); }
  }, ADMIN_ROLES)));

  app.post(['/api/v1/structure/streams', '/structure/streams'], h(guard(async (req, res, c) => {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ success: false, message: 'Stream name is required.' });
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        'INSERT INTO streams (tenant_id, grade_label, name) VALUES ($1,$2,$3) RETURNING id',
        [c.tenantId, b.grade_id || b.grade_label || null, b.name]);
      return res.status(201).json({ success: true, stream_id: rows[0].id });
    } finally { client.release(); }
  }, ADMIN_ROLES)));

  app.post(['/api/v1/structure/teaching-allocations', '/structure/teaching-allocations'], h(guard(async (req, res, c) => {
    // Contract from TeachingAllocationPage: payload = { [area_id]: teacher_id, ... }
    const b = req.body || {};
    const entries = Object.entries(b)
      .filter(([area, teacher]) => teacher && /^[0-9a-f-]{36}$|^[0-9A-Za-z-]{1,64}$/.test(String(teacher)))
      .filter(([, teacher]) => /^[0-9a-f-]{36}$/i.test(String(teacher)));
    if (!entries.length) return res.status(400).json({ success: false, message: 'No valid allocations in payload.' });
    const client = await pool.connect();
    try {
      await client.query('DELETE FROM teaching_allocations WHERE tenant_id = $1 AND learning_area_id = ANY($2::varchar[])',
        [c.tenantId, entries.map(([a]) => a)]);
      for (const [area, teacher] of entries) {
        const name = (await client.query('SELECT name FROM learning_areas WHERE code = $1 LIMIT 1', [area])).rows[0]?.name || area;
        await client.query(
          `INSERT INTO teaching_allocations (tenant_id, teacher_id, learning_area_id, learning_area)
           VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id, teacher_id, learning_area_id) DO UPDATE SET learning_area = $4`,
          [c.tenantId, teacher, area, name]);
      }
      await client.query(
        'INSERT INTO audit_log (tenant_id, actor_id, actor_email, action, resource_type, resource_id, ip, detail) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [c.tenantId, c.userId, c.email, 'SAVE', 'teaching_allocations', null, c.ip, `${entries.length} allocations`]);
      return res.json({ success: true, saved: entries.length, message: 'Teaching allocations saved' });
    } finally { client.release(); }
  }, ADMIN_ROLES)));
}

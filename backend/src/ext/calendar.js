/* Academic calendar: years, terms, exam windows (lazy-seeded realistically). */
import { guard, h, today } from './context.js';

export function installCalendar(app, deps) {
  const { pool } = deps;

  async function seedIfEmpty(client, tenantId) {
    const { rows } = await client.query('SELECT 1 FROM calendar_years WHERE tenant_id = $1 LIMIT 1', [tenantId]);
    if (rows.length) return;
    const y = new Date().getFullYear();
    const year = await client.query(
      `INSERT INTO calendar_years (tenant_id, year_label, year, status, starts_at, ends_at)
       VALUES ($1,$2,$3,'ACTIVE',$4,$5) RETURNING id`,
      [tenantId, `${y}`, y, `${y}-01-06`, `${y}-11-30`]);
    await client.query(
      `INSERT INTO calendar_terms (tenant_id, year_id, term_label, term_number, starts_at, ends_at, status) VALUES
       ($1,$2,'Term 1',1,$3,$4,'ACTIVE'),($1,$2,'Term 2',2,$5,$6,'PLANNED'),($1,$2,'Term 3',3,$7,$8,'PLANNED')`,
      [tenantId, year.rows[0].id, `${y}-01-06`, `${y}-04-05`, `${y}-05-06`, `${y}-08-09`, `${y}-09-01`, `${y}-11-27`]);
    await client.query(
      `INSERT INTO exam_windows (tenant_id, term_id, window_label, starts_at, ends_at, status)
       SELECT $1, t.id, 'End-Term Assessment', t.ends_at - 7, t.ends_at, 'PLANNED'
       FROM calendar_terms t WHERE t.tenant_id = $1 AND t.term_number = 1`,
      [tenantId]);
  }

  app.get(['/api/v1/calendar/years', '/calendar/years'], h(guard(async (req, res, c) => {
    if (!c.tenantId) return res.status(403).json({ success: false, message: 'No tenant in session.' });
    const client = await pool.connect();
    try {
      await seedIfEmpty(client, c.tenantId);
      const { rows } = await client.query(
        `SELECT * FROM calendar_years WHERE tenant_id = $1 ORDER BY year DESC`, [c.tenantId]);
      return res.json(rows.map((r) => ({
        year_id: r.id, id: r.id, year_label: r.year_label, year: r.year,
        status: r.status, starts_at: r.starts_at, ends_at: r.ends_at,
      })));
    } finally { client.release(); }
  })));

  app.get(['/api/v1/calendar/terms', '/calendar/terms'], h(guard(async (req, res, c) => {
    if (!c.tenantId) return res.status(403).json({ success: false, message: 'No tenant in session.' });
    const client = await pool.connect();
    try {
      await seedIfEmpty(client, c.tenantId);
      const { rows } = await client.query(
        `SELECT * FROM calendar_terms WHERE tenant_id = $1 ORDER BY term_number`, [c.tenantId]);
      return res.json(rows.map((r) => ({
        term_id: r.id, id: r.id, term_label: r.term_label, term_number: r.term_number,
        name: r.term_label, starts_at: r.starts_at, ends_at: r.ends_at, status: r.status,
        academic_year_id: r.year_id,
      })));
    } finally { client.release(); }
  })));

  app.get(['/api/v1/calendar/exam-windows', '/calendar/exam-windows'], h(guard(async (req, res, c) => {
    if (!c.tenantId) return res.status(403).json({ success: false, message: 'No tenant in session.' });
    const client = await pool.connect();
    try {
      await seedIfEmpty(client, c.tenantId);
      const { rows } = await client.query(
        `SELECT * FROM exam_windows WHERE tenant_id = $1 ORDER BY starts_at`, [c.tenantId]);
      return res.json(rows.map((r) => ({
        window_id: r.id, id: r.id, window_label: r.window_label, name: r.window_label,
        starts_at: r.starts_at, ends_at: r.ends_at, status: r.status,
      })));
    } finally { client.release(); }
  })));

  app.post(['/api/v1/calendar/terms', '/calendar/terms'], h(guard(async (req, res, c) => {
    if (!c.tenantId) return res.status(403).json({ success: false, message: 'No tenant in session.' });
    const b = req.body || {};
    if (!b.term_name && !b.term_label) return res.status(400).json({ success: false, message: 'Term name is required.' });
    const client = await pool.connect();
    try {
      await seedIfEmpty(client, c.tenantId);
      const { rows } = await client.query(
        `SELECT COUNT(*)::int AS n FROM calendar_terms WHERE tenant_id = $1`, [c.tenantId]);
      const yearId = b.academic_year_id
        || ((await client.query('SELECT id FROM calendar_years WHERE tenant_id = $1 ORDER BY year DESC LIMIT 1', [c.tenantId])).rows[0]?.id)
        || null;
      const ins = await client.query(
        `INSERT INTO calendar_terms (tenant_id, year_id, term_label, term_number, status)
         VALUES ($1,$2,$3,$4,'ACTIVE') RETURNING id, term_label, term_number`,
        [c.tenantId, yearId, b.term_name || b.term_label, rows[0].n + 1]);
      return res.status(201).json({ success: true, term_id: ins.rows[0].id, message: `${ins.rows[0].term_label} added` });
    } finally { client.release(); }
  })));
}

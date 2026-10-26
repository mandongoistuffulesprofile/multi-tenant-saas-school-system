/* Academic domain: attendance (registers/marks/batch) + assessment
 * (events/results/batch). The offline teacher engine (lib/offline.ts queue)
 * POSTs /assessment/results and /attendance/marks — payloads preserved exact:
 *   result: { learner_id, event_id, sub_strand_id, level_code, state, version,
 *             device_id, client_ts, teacher_id }
 *   mark:   { register_id, learner_id, status, marked_at, device_id }
 * Staff batch endpoints accept the page contracts:
 *   /assessment/results/batch { assessment_event_id, results:[{learner_id, rubric_level, raw_score}] }
 *   /attendance/marks/batch   { register_id, marks:[{learner_id, mark}] }   (mark! not status)
 * Assessment writes live in cbc_assessments (the existing LWW store).
 */
import { guard, h, isParentRole, today } from './context.js';

export function installAcademic(app, deps) {
  const { pool } = deps;

  /* ---------------------- attendance registers ---------------------- */

  app.get(['/api/v1/attendance/registers', '/attendance/registers'], h(guard(async (req, res, c) => {
    if (!c.tenantId) return res.status(403).json({ success: false, message: 'No tenant in session.' });
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT r.*, 
                (SELECT COUNT(*) FROM attendance_marks m WHERE m.register_id = r.id) AS marks_count
         FROM attendance_registers r WHERE r.tenant_id = $1
         ORDER BY r.register_date DESC`, [c.tenantId]);
      return res.json(rows.map((r) => ({
        register_id: r.id, register_date: r.register_date,
        grade_label: r.grade_label, grade_id: r.grade_label, class_group_id: r.grade_label || r.class_group_id,
        class_name: [r.grade_label, r.stream_name].filter(Boolean).join(' - ') || null,
        stream_name: r.stream_name, session_type: r.session_type, status: r.status,
        marks_count: r.marks_count,
      })));
    } finally { client.release(); }
  })));

  app.post(['/api/v1/attendance/registers', '/attendance/registers'], h(guard(async (req, res, c) => {
    if (!c.tenantId) return res.status(403).json({ success: false, message: 'No tenant in session.' });
    const b = req.body || {};
    const date = b.register_date || today();
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `INSERT INTO attendance_registers (tenant_id, register_date, grade_label, stream_name, session_type, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (tenant_id, register_date, grade_label, stream_name, session_type)
         DO UPDATE SET status = EXCLUDED.status RETURNING id, register_date,
           grade_label, stream_name, session_type, status`,
        [c.tenantId, date, b.grade_label || b.grade_id || null, b.stream_name || b.stream || null,
          b.session_type || 'FULL_DAY', b.status || 'OPEN', c.userId]);
      return res.status(201).json({
        success: true, register_id: rows[0].id,
        register: { register_id: rows[0].id, register_date: rows[0].register_date, session_type: rows[0].session_type, status: rows[0].status },
        message: 'Register opened',
      });
    } finally { client.release(); }
  })));

  /* ------------------------ attendance marks ------------------------ */

  app.get(['/api/v1/attendance/marks', '/attendance/marks'], h(guard(async (req, res, c) => {
    if (!c.tenantId) return res.status(403).json({ success: false, message: 'No tenant in session.' });
    const qLearner = req.query.learner_id;
    const client = await pool.connect();
    try {
      let sql = `SELECT m.*, r.register_date, r.grade_label, r.stream_name, r.session_type, r.class_group_id,
                        s.full_name AS learner_name
                 FROM attendance_marks m
                 JOIN attendance_registers r ON r.id = m.register_id
                 LEFT JOIN students s ON s.id = m.student_id
                 WHERE m.tenant_id = $1`;
      const params = [c.tenantId];
      if (qLearner) { params.push(qLearner); sql += ` AND m.student_id = $${params.length}`; }
      if (isParentRole(c.role)) {
        const children = (await pool.query(
          `SELECT s.id FROM students s WHERE s.tenant_id = $1 AND LOWER(COALESCE(s.parent_email,'')) = $2
           UNION SELECT s.id FROM students s JOIN parent_children pc ON pc.student_id = s.id WHERE pc.parent_user_id = $1`,
          [c.tenantId, c.email])).rows.map((r) => r.id);
        if (!children.length) return res.json([]);
        params.push(children); sql += ` AND m.student_id = ANY($${params.length}::uuid[])`;
      }
      sql += ' ORDER BY r.register_date DESC, m.marked_at DESC LIMIT 1000';
      const { rows } = await client.query(sql, params);
      return res.json(rows.map((r) => ({
        mark_id: r.id, register_id: r.register_id, learner_id: r.student_id,
        learner: r.learner_name || null, status: r.status,
        date: r.register_date, register_date: r.register_date,
        class_name: [r.grade_label, r.stream_name].filter(Boolean).join(' - ') || null,
        class_group_id: r.grade_label || r.class_group_id,
        session_type: r.session_type, marked_at: r.marked_at, marked_by: r.marked_by,
      })));
    } finally { client.release(); }
  })));

  app.post(['/api/v1/attendance/marks', '/attendance/marks'], h(guard(offlineMarkHandler, null)));
  app.post(['/api/v1/attendance/marks/batch', '/attendance/marks/batch'], h(guard(offlineMarkBatchHandler, null)));

  async function offlineMarkHandler(req, res, c) {
    if (!c.tenantId) return res.status(403).json({ success: false, message: 'No tenant in session.' });
    const m = (req.body && (req.body.mark || req.body.mark_order)) || req.body || {};
    const id = await upsertMark(c, m);
    if (!id) return res.status(400).json({ success: false, message: 'register_id, learner_id and status required.' });
    return res.status(201).json({ success: true, mark_id: id });
  }

  async function offlineMarkBatchHandler(req, res, c) {
    if (!c.tenantId) return res.status(403).json({ success: false, message: 'No tenant in session.' });
    const b = req.body || {};
    const items = Array.isArray(b) ? b : (b.marks || b.items || []);
    let n = 0;
    for (const raw of items) {
      // page contract: { learner_id, mark } + body-level register_id; offline: per-item register_id
      const m = { ...raw, register_id: raw.register_id || b.register_id, status: raw.status || raw.mark };
      const id = await upsertMark(c, m);
      if (id) n++;
    }
    return res.status(201).json({ success: true, synced: n, received: items.length });
  }

  async function upsertMark(c, m) {
    const regId = /^[0-9a-f-]{36}$/i.test(String(m.register_id || '')) ? m.register_id : null;
    const stuId = /^[0-9a-f-]{36}$/i.test(String(m.learner_id || '')) ? m.learner_id : null;
    if (!regId || !stuId) return null;
    const status = String(m.status || 'PRESENT').toUpperCase().slice(0, 16);
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `INSERT INTO attendance_marks (tenant_id, register_id, student_id, status, marked_by, marked_at, device_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (register_id, student_id)
         DO UPDATE SET status = EXCLUDED.status, marked_by = EXCLUDED.marked_by,
           marked_at = EXCLUDED.marked_at, device_id = EXCLUDED.device_id, updated_at = now()
         RETURNING id`,
        [c.tenantId, regId, stuId, status, c.userId || null, m.marked_at || new Date().toISOString(), m.device_id || null]);
      return rows[0]?.id || null;
    } finally { client.release(); }
  }

  /* ------------------------ assessment events ----------------------- */

  app.get(['/api/v1/assessment/events', '/assessment/events'], h(guard(async (req, res, c) => {
    if (!c.tenantId) return res.status(403).json({ success: false, message: 'No tenant in session.' });
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT * FROM assessment_events WHERE tenant_id = $1 ORDER BY created_at DESC`, [c.tenantId]);
      return res.json(rows.map((r) => ({
        event_id: r.id, title: r.title, grade_label: r.grade_label, grade_id: r.grade_label,
        learning_area_id: r.learning_area_id, learning_area: r.learning_area,
        assessment_type: r.assessment_type, type: r.assessment_type,
        scoring_mode: r.scoring_mode, mode: r.scoring_mode,
        assessment_window: r.assessment_window, window: r.assessment_window,
        status: r.status,
      })));
    } finally { client.release(); }
  })));

  app.post(['/api/v1/assessment/events', '/assessment/events'], h(guard(async (req, res, c) => {
    if (!c.tenantId) return res.status(403).json({ success: false, message: 'No tenant in session.' });
    const b = req.body || {};
    if (!b.learning_area_id) return res.status(400).json({ success: false, message: 'learning_area_id is required.' });
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `INSERT INTO assessment_events (tenant_id, title, grade_label, learning_area_id, learning_area,
           assessment_type, scoring_mode, assessment_window, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [c.tenantId, b.title || null, b.grade_label || b.grade_id || null, String(b.learning_area_id),
          b.learning_area || null, b.assessment_type || b.type || 'FORMATIVE',
          b.scoring_mode || b.mode || 'RUBRIC', b.assessment_window || b.window || null, b.status || 'OPEN']);
      return res.status(201).json({ success: true, event_id: rows[0].id });
    } finally { client.release(); }
  })));

  /* ------------------------ assessment results ---------------------- */

  app.get(['/api/v1/assessment/results', '/assessment/results'], h(guard(async (req, res, c) => {
    if (!c.tenantId) return res.status(403).json({ success: false, message: 'No tenant in session.' });
    const qLearner = req.query.learner_id;
    const client = await pool.connect();
    try {
      let sql = `SELECT ca.*, e.learning_area AS event_area
                 FROM cbc_assessments ca
                 LEFT JOIN assessment_events e ON e.id::text = ca.sub_strand_id
                 WHERE ca.tenant_id = $1`;
      const params = [c.tenantId];
      if (qLearner) { params.push(qLearner); sql += ` AND ca.student_id = $${params.length}`; }
      if (isParentRole(c.role)) {
        const children = (await pool.query(
          `SELECT s.id FROM students s WHERE s.tenant_id = $1 AND LOWER(COALESCE(s.parent_email,'')) = $2
           UNION SELECT s.id FROM students s JOIN parent_children pc ON pc.student_id = s.id WHERE pc.parent_user_id = $1`,
          [c.tenantId, c.email])).rows.map((r) => r.id);
        if (!children.length) return res.json([]);
        params.push(children); sql += ` AND ca.student_id = ANY($${params.length}::uuid[])`;
      }
      sql += ' ORDER BY ca.updated_at DESC LIMIT 2000';
      const { rows } = await client.query(sql, params);
      return res.json(rows.map((r) => ({
        result_id: r.id, learner_id: r.student_id, student_id: r.student_id,
        learning_area_id: r.sub_strand_id, sub_strand_id: r.sub_strand_id,
        raw_score: r.score, score: r.score,
        assigned_grade: r.rating_code, level_code: r.rating_code, rubric_level: r.rating_code,
        assessment_date: r.updated_at, updated_at: r.updated_at, event_id: r.event_id || null,
      })));
    } finally { client.release(); }
  })));

  app.post(['/api/v1/assessment/results', '/assessment/results'], h(guard(offResultHandler, null)));
  app.post(['/api/v1/assessment/results/batch', '/assessment/results/batch'], h(guard(offResultBatchHandler, null)));

  async function offResultHandler(req, res, c) {
    if (!c.tenantId) return res.status(403).json({ success: false, message: 'No tenant in session.' });
    const r = (req.body && (req.body.result || req.body.assessment)) || req.body || {};
    const id = await upsertResult(c, r);
    if (!id) return res.status(400).json({ success: false, message: 'learner_id + sub_strand_id/learning_area required.' });
    return res.status(201).json({ success: true, result_id: id });
  }

  async function offResultBatchHandler(req, res, c) {
    if (!c.tenantId) return res.status(403).json({ success: false, message: 'No tenant in session.' });
    const b = req.body || {};
    const items = Array.isArray(b) ? b : (b.results || b.items || []);
    const eventId = b.assessment_event_id || b.event_id || null;
    // The page batch contract carries the event at body level: resolve its
    // learning area once so items only need { learner_id, rubric_level, raw_score }.
    let eventArea = null;
    if (eventId) {
      eventArea = (await pool.query('SELECT learning_area_id FROM assessment_events WHERE id = $1 AND tenant_id = $2', [eventId, c.tenantId])).rows[0]?.learning_area_id || null;
    }
    let n = 0;
    for (const raw of items) {
      const r = { ...raw, sub_strand_id: raw.sub_strand_id || raw.learning_area_id || eventArea };
      if (r.event_id && !r.sub_strand_id) {
        const ev = await pool.query('SELECT learning_area_id FROM assessment_events WHERE id = $1 AND tenant_id = $2', [r.event_id, c.tenantId]);
        r.sub_strand_id = ev.rows[0]?.learning_area_id || null;
      }
      if (await upsertResult(c, r)) n++;
    }
    return res.status(201).json({ success: true, synced: n, received: items.length });
  }

  /* LWW upsert into cbc_assessments — mirrors the bulk-sync rules. */
  const SCORE_MAP = { EE: 4, ME: 3, AE: 2, BE: 1, '4': 4, '3': 3, '2': 2, '1': 1 };
  async function upsertResult(c, r) {
    const stuId = /^[0-9a-f-]{36}$/i.test(String(r.learner_id || r.student_id || '')) ? (r.learner_id || r.student_id) : null;
    if (!stuId) return null;
    const subStrand = String(r.sub_strand_id || r.learning_area_id || '').slice(0, 128);
    if (!subStrand) return null;
    const rating = String(r.level_code || r.rating_code || r.rubric_level || r.assigned_grade || '').toUpperCase() || null;
    const score = Number.isFinite(Number(r.raw_score ?? r.score))
      ? Number(r.raw_score ?? r.score)
      : (SCORE_MAP[rating] ?? null);
    const updated = r.client_ts || r.updated_at || new Date().toISOString();
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `UPDATE cbc_assessments SET score = $4, rating_code = $5, updated_at = $6, synced_at = now()
         WHERE tenant_id = $1 AND student_id = $2 AND sub_strand_id = $3 RETURNING id`,
        [c.tenantId, stuId, subStrand, score, rating, updated]);
      if (rows.length) return rows[0].id;
      const ins = await client.query(
        `INSERT INTO cbc_assessments (tenant_id, student_id, sub_strand_id, score, rating_code, updated_at, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6, now()) RETURNING id`,
        [c.tenantId, stuId, subStrand, score, rating, updated]);
      return ins.rows[0].id;
    } finally { client.release(); }
  }
}

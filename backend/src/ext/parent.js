/* Parent-portal specific endpoints: linked children + per-child attendance.
 * Finance/assessment/report endpoints are persona-scoped in their modules. */
import { h, guard } from './context.js';

export function installParent(app, deps) {
  const { pool } = deps;

  app.get(['/api/v1/me/linked-learners', '/me/linked-learners'], h(async (req, res, c) => {
    if (!c?.userId) return res.status(401).json({ success: false, message: 'Authentication required.' });
    if (c.role !== 'parent') return res.status(403).json({ success: false, message: 'Parent account required.' });
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT * FROM students WHERE tenant_id = $1 AND LOWER(COALESCE(parent_email,'')) = $2
         UNION
         SELECT s.* FROM students s JOIN parent_children pc ON pc.student_id = s.id WHERE pc.parent_user_id = $1
         ORDER BY full_name`,
        [c.tenantId, c.email]);
      return res.json(rows.map((r) => {
        const i = (r.full_name || '').indexOf(' ');
        return {
          learner_id: r.id, admission_number: r.admission_number,
          first_name: i === -1 ? r.full_name : r.full_name.slice(0, i),
          last_name: i === -1 ? '' : r.full_name.slice(i + 1),
          full_name: r.full_name,
          grade_label: r.grade_level, grade_id: r.grade_level,
          stream_name: r.stream || 'General', class_name: [r.grade_level, r.stream].filter(Boolean).join(' - '),
          status: r.status || 'ACTIVE',
        };
      }));
    } finally { client.release(); }
  }));

  /* Admin endpoint: link a guardian to a learner (by parent's account email). */
  app.post(['/api/v1/structure/learner-guardian', '/structure/learner-guardian'], h(guard(async (req, res, c) => {
    const b = req.body || {};
    if (!b.learner_id || !b.parent_email) {
      return res.status(400).json({ success: false, message: 'learner_id and parent_email are required.' });
    }
    const client = await pool.connect();
    try {
      const parent = await client.query(
        'SELECT id FROM users WHERE LOWER(email) = $1 AND tenant_id = $2', [String(b.parent_email).toLowerCase(), c.tenantId]);
      if (!parent.rows[0]) return res.status(404).json({ success: false, message: 'No parent account with that email in your school.' });
      await client.query(
        `INSERT INTO parent_children (parent_user_id, student_id) VALUES ($1,$2)
         ON CONFLICT DO NOTHING`, [parent.rows[0].id, b.learner_id]);
      return res.status(201).json({ success: true, message: 'Guardian linked to learner.' });
    } finally { client.release(); }
  }, ['admin', 'head', 'deputy'])));

  /* Parent attendance roster across all linked children. */
  app.get(['/api/v1/parent/attendance', '/parent/attendance'], h(async (req, res, c) => {
    if (!c?.userId) return res.status(401).json({ success: false, message: 'Authentication required.' });
    if (c.role !== 'parent') return res.status(403).json({ success: false, message: 'Parent account required.' });
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT m.status, m.marked_at, r.register_date, r.grade_label, r.stream_name, r.class_group_id,
                s.full_name AS learner_name, s.id AS learner_id
         FROM attendance_marks m
         JOIN attendance_registers r ON r.id = m.register_id
         JOIN students s ON s.id = m.student_id
         WHERE (m.tenant_id = $1 AND (LOWER(COALESCE(s.parent_email,'')) = $2 OR s.id IN (
            SELECT pc.student_id FROM parent_children pc WHERE pc.parent_user_id = $3)))
         ORDER BY r.register_date DESC LIMIT 300`,
        [c.tenantId, c.email, c.userId]);
      return res.json(rows.map((r) => ({
        date: r.register_date, register_date: r.register_date,
        status: r.status, learner: r.learner_name, learner_id: r.learner_id,
        class_name: [r.grade_label, r.stream_name].filter(Boolean).join(' - ') || r.class_group_id,
        class_group_id: r.class_group_id || r.grade_label,
      })));
    } finally { client.release(); }
  }));
}

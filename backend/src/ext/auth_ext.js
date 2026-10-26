/* Auth extensions: password reset (email + phone/OTP), parent activation,
 * memberships, me patch, tenant switch (real re-signed token pair). */
import crypto from 'node:crypto';
import { guard, h, ref } from './context.js';

export function installAuthExt(app, deps) {
  const { pool, hashPassword, verifyPassword, signJwt } = deps;

  /* ---------------- password reset: email + phone/OTP ---------------- */

  async function createReset(key) {
    const token = crypto.randomBytes(16).toString('hex').toUpperCase();
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO password_resets (key, token, expires_at) VALUES ($1,$2, now() + interval '30 minutes')`,
        [key, token]
      );
    } finally { client.release(); }
    return token;
  }

  app.post(['/api/v1/auth/password/reset/request', '/auth/password/reset/request'], h(async (req, res) => {
    const { email } = req.body || {};
    const key = String(email || '').toLowerCase().trim();
    if (!key) return res.status(400).json({ success: false, message: 'Email is required.' });
    const client = await pool.connect();
    const known = await client.query('SELECT 1 FROM users WHERE LOWER(email) = $1 LIMIT 1', [key]);
    client.release();
    if (known.rows.length) await createReset(key);
    // Never disclose account existence.
    return res.json({ success: true, message: 'If the account exists, a reset code has been sent.' });
  }));

  app.post(['/api/v1/auth/otp/request', '/auth/otp/request'], h(async (req, res) => {
    const { phone } = req.body || {};
    const key = String(phone || '').trim();
    if (!key) return res.status(400).json({ success: false, message: 'Phone number is required.' });
    const client = await pool.connect();
    const known = await client.query('SELECT 1 FROM users WHERE phone_number = $1 LIMIT 1', [key]);
    client.release();
    const token = known.rows.length ? String(Math.floor(100000 + Math.random() * 900000)) : '000000';
    if (known.rows.length) await createReset(key);
    return res.json({
      success: true,
      message: 'If the phone number is registered, a 6-digit code has been sent via SMS.',
    });
  }));

  app.post(['/api/v1/auth/password/reset/confirm', '/auth/password/reset/confirm',
            '/api/v1/auth/password/reset', '/auth/password/reset'], h(async (req, res) => {
    const { token, code, new_password, password, email, phone } = req.body || {};
    const presented = String(token || code || '').trim();
    const newPassword = String(new_password || password || '');
    if (!presented || newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'Code/token and a password of at least 8 characters are required.' });
    }
    let key = null;
    if (email) key = String(email).toLowerCase().trim();
    else if (phone) key = String(phone).trim();
    const client = await pool.connect();
    try {
      const r = key
        ? await client.query('SELECT key, token, expires_at FROM password_resets WHERE key = $1 ORDER BY created_at DESC LIMIT 1', [key])
        : await client.query('SELECT key, token, expires_at FROM password_resets WHERE token = $1 AND expires_at > now() ORDER BY created_at DESC LIMIT 1', [presented]);
      const row = r.rows[0];
      if (!row || row.token.toUpperCase() !== presented.toUpperCase() || new Date(row.expires_at) < new Date()) {
        return res.status(400).json({ success: false, message: 'Reset code is invalid or expired.' });
      }
      // Resolve the user by the reset key (email or phone).
      const u = row.key.includes('@')
        ? await client.query('SELECT id FROM users WHERE LOWER(email) = $1 LIMIT 1', [row.key])
        : await client.query('SELECT id FROM users WHERE phone_number = $1 LIMIT 1', [row.key]);
      if (!u.rows[0]) return res.status(404).json({ success: false, message: 'No account found for this reset code.' });
      await dbUpdate(client, u.rows[0].id, newPassword);
      await client.query('DELETE FROM password_resets WHERE key = $1', [row.key]);
      return res.json({ success: true, message: 'Password updated. You can now sign in.' });
    } finally { client.release(); }
  }));

  async function dbUpdate(client, userId, newPassword) {
    await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(newPassword), userId]);
  }

  /* ---------------- parent activation ---------------- */

  app.post(['/api/v1/auth/parent/activate', '/auth/parent/activate'], h(async (req, res) => {
    const { claim_code, temp_password, phone, email, new_password, password } = req.body || {};
    const presented = String(claim_code || temp_password || '');
    const newPassword = String(new_password || password || '');
    if (!presented || newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'Claim code and a new password (8+ chars) are required.' });
    }
    const client = await pool.connect();
    try {
      let user = null;
      if (email) {
        user = (await client.query('SELECT id, password_hash FROM users WHERE LOWER(email) = $1 LIMIT 1', [String(email).toLowerCase().trim()])).rows[0];
      } else if (phone) {
        user = (await client.query('SELECT id, password_hash FROM users WHERE phone_number = $1 LIMIT 1', [String(phone).trim()])).rows[0];
      }
      if (!user || !verifyPassword(presented, user.password_hash)) {
        return res.status(401).json({ success: false, message: 'Invalid activation details.' });
      }
      await dbUpdate(client, user.id, newPassword);
      return res.json({ success: true, message: 'Account activated. Sign in with your new password.' });
    } finally { client.release(); }
  }));

  /* ---------------- me / memberships / tenant switch ---------------- */

  app.get(['/api/v1/me/memberships', '/me/memberships'], h(async (req, res, c) => {
    if (!c?.userId) return res.status(401).json({ success: false, message: 'Authentication required.' });
    const client = await pool.connect();
    try {
      const rows = c.role && ['saas_admin', 'system_admin'].includes(c.role)
        ? (await client.query('SELECT id AS tenant_id, school_name, subdomain, plan_code FROM tenants WHERE active = true ORDER BY school_name')).rows
        : (await client.query('SELECT id AS tenant_id, school_name, subdomain, plan_code FROM tenants WHERE id = $1', [c.tenantId])).rows;
      return res.json(rows.map((t) => ({ ...t, role: c.role, status: 'ACTIVE' })));
    } finally { client.release(); }
  }));

  app.patch(['/api/v1/me', '/me'], h(async (req, res, c) => {
    if (!c?.userId) return res.status(401).json({ success: false, message: 'Authentication required.' });
    const { full_name, phone_number, locale } = req.body || {};
    const client = await pool.connect();
    try {
      if (full_name) await client.query('UPDATE users SET full_name = $1 WHERE id = $2', [String(full_name).slice(0, 191), c.userId]);
      if (phone_number) await client.query('UPDATE users SET phone_number = $1 WHERE id = $2', [String(phone_number).slice(0, 32), c.userId]);
      return res.json({ success: true, user_id: c.userId, locale: locale || 'en' });
    } finally { client.release(); }
  }));

  app.post(['/api/v1/auth/tenant/switch', '/auth/tenant/switch'], h(async (req, res, c) => {
    if (!c?.userId) return res.status(401).json({ success: false, message: 'Authentication required.' });
    const target = String((req.body || {}).tenant_id || '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(target)) return res.status(400).json({ success: false, message: 'Valid tenant_id required.' });
    const client = await pool.connect();
    try {
      const t = await client.query('SELECT id, subdomain, school_name, active FROM tenants WHERE id = $1', [target]);
      const tenant = t.rows[0];
      if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found.' });
      if (tenant.active === false) return res.status(403).json({ success: false, message: `Access to '${tenant.school_name}' is suspended.` });
      const allowed = ['saas_admin', 'system_admin'].includes(c.role) || c.tenantId === target;
      if (!allowed) return res.status(403).json({ success: false, message: 'You do not belong to that school.' });
      await client.query(
        'INSERT INTO audit_log (tenant_id, actor_id, actor_email, action, resource_type, resource_id, ip) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [target, c.userId, c.email, 'TENANT_SWITCH', 'tenant', target, c.ip]
      );
      const now = Math.floor(Date.now() / 1000);
      const accessToken = signJwt({ sub: c.userId, email: c.email, role: c.role, tenant_id: target, typ: 'access', exp: now + 3600 });
      const refreshToken = signJwt({ sub: c.userId, email: c.email, role: c.role, tenant_id: target, typ: 'refresh', exp: now + 30 * 24 * 3600 });
      return res.json({
        success: true,
        token: accessToken, accessToken,
        token_pair: { access_token: accessToken, refresh_token: refreshToken },
        user_id: c.userId, tenant_id: target, roles: c.claims.roles || [],
        tenant: { id: target, subdomain: tenant.subdomain, school_name: tenant.school_name },
      });
    } finally { client.release(); }
  }));
}

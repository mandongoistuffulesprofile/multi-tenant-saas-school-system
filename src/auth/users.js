import { query } from '../db/client.js';
import { hashPassword, verifyPassword, dummyVerify, generateSessionToken } from '../crypto/index.js';

export async function findUserByEmail(email) {
  const norm = email.trim().toLowerCase();
  const res = await query(
    `SELECT id, email, email_norm, password_hash, is_active, failed_login_count, locked_until
     FROM users WHERE email_norm = $1`,
    [norm]
  );
  return res.rows[0] ?? null;
}

export async function findUserById(id) {
  const res = await query(
    `SELECT id, email, email_norm, is_active, failed_login_count, locked_until FROM users WHERE id = $1`,
    [id]
  );
  return res.rows[0] ?? null;
}

export async function createUser({ email, passwordHash }) {
  const norm = email.trim().toLowerCase();
  const res = await query(
    `INSERT INTO users (email, email_norm, password_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT (email_norm) DO UPDATE SET email = EXCLUDED.email
     RETURNING id, email`,
    [norm, norm, passwordHash]
  );
  return res.rows[0];
}

export async function setPassword(userId, passwordHash) {
  await query(
    `UPDATE users SET password_hash = $1, failed_login_count = 0, locked_until = NULL, updated_at = now()
     WHERE id = $2`,
    [passwordHash, userId]
  );
}

export async function touchLogin(userId) {
  await query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [userId]);
}

export async function recordFailedLogin(userId, threshold, lockoutMs) {
  const res = await query(
    `UPDATE users
      SET failed_login_count = failed_login_count + 1,
          locked_until = CASE
            WHEN failed_login_count + 1 >= $2 THEN now() + ($3 || ' milliseconds')::interval
            ELSE locked_until
          END
     WHERE id = $1
     RETURNING failed_login_count, locked_until`,
    [userId, threshold, lockoutMs]
  );
  return res.rows[0];
}

export async function clearFailedLogins(userId) {
  await query(
    `UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = $1`,
    [userId]
  );
}

export async function createSession({ userId, userAgent, ip, maxAgeMs }) {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + maxAgeMs);
  const res = await query(
    `INSERT INTO sessions (user_id, session_token, user_agent, ip, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, session_token, expires_at`,
    [userId, token, userAgent, ip, expiresAt]
  );
  return res.rows[0];
}

export async function getSessionByToken(token) {
  const res = await query(
    `SELECT s.*, u.id as uid, u.email, u.is_active
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.session_token = $1 AND s.revoked = false AND s.expires_at > now()`,
    [token]
  );
  return res.rows[0] ?? null;
}

export async function rotateSession(userId, userAgent, ip, maxAgeMs) {
  await query(`UPDATE sessions SET revoked = true WHERE user_id = $1`, [userId]);
  return createSession({ userId, userAgent, ip, maxAgeMs });
}

export async function invalidateAllSessions(userId) {
  const res = await query(
    `UPDATE sessions SET revoked = true WHERE user_id = $1 AND revoked = false
     RETURNING count(*)`,
    [userId]
  );
  return parseInt(res.rows[0]?.count ?? 0, 10);
}

export async function createResetToken(userId, token, tokenHash, prefix, expiresAt, ip, userAgent, requestId) {
  const res = await query(
    `INSERT INTO password_reset_tokens
       (user_id, token_hash, token_prefix, expires_at, created_by_ip, created_by_ua, request_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, created_at`,
    [userId, tokenHash, prefix, expiresAt, ip, userAgent, requestId]
  );
  return res.rows[0];
}

export async function consumeResetToken(token) {
  const res = await query(
    `SELECT id, user_id, token_hash, expires_at, used_at, invalidated
       FROM password_reset_tokens
       WHERE token_hash = $1
       FOR UPDATE`,
    [token]
  );
  return res.rows[0] ?? null;
}

export async function markTokenUsed(tokenId, usedByIp) {
  await query(
    `UPDATE password_reset_tokens
       SET used_at = now(), used_by_ip = $1
       WHERE id = $2`,
    [usedByIp, tokenId]
  );
}

export async function invalidateAllResetTokens(userId) {
  const res = await query(
    `UPDATE password_reset_tokens
       SET invalidated = true
       WHERE user_id = $1 AND invalidated = false
       RETURNING count(*)`,
    [userId]
  );
  return parseInt(res.rows[0]?.count ?? 0, 10);
}
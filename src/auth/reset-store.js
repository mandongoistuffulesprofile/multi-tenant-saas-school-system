import { query } from '../db/client.js';
import { hashToken, generateResetToken, getResetTokenExpiry, tokenPrefix } from './reset.js';
import { env } from '../config/index.js';

export async function findUserByEmailNorm(emailNorm) {
  const res = await query(
    `SELECT id, email_norm, is_active FROM users WHERE email_norm = $1`,
    [emailNorm]
  );
  return res.rows[0] ?? null;
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
  const tokenHash = hashToken(token);
  const res = await query(
    `SELECT id, user_id, token_hash, expires_at, used_at, invalidated
       FROM password_reset_tokens
       WHERE token_hash = $1
       FOR UPDATE`,
    [tokenHash]
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

export async function invalidateAllSessions(userId) {
  const res = await query(
    `UPDATE sessions SET revoked = true
       WHERE user_id = $1 AND revoked = false
       RETURNING count(*)`,
    [userId]
  );
  return parseInt(res.rows[0]?.count ?? 0, 10);
}

export async function invalidateAllRefreshTokens(userId) {
  const res = await query(
    `UPDATE refresh_tokens SET revoked_at = now()
       WHERE user_id = $1 AND revoked_at IS NULL
       RETURNING count(*)`,
    [userId]
  );
  return parseInt(res.rows[0]?.count ?? 0, 10);
}

export async function touchUser(userId) {
  await query(`UPDATE users SET updated_at = now() WHERE id = $1`, [userId]);
}

export async function setPassword(userId, passwordHash) {
  await query(
    `UPDATE users SET password_hash = $1, failed_login_count = 0, locked_until = NULL, updated_at = now()
       WHERE id = $2`,
    [passwordHash, userId]
  );
}
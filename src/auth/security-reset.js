import crypto from 'node:crypto';
import { query } from '../db/client.js';

const RESET_TOKEN_BYTES = 32; // 256 bits
const RESET_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 3;

export function generateResetToken() {
  return crypto.randomBytes(RESET_TOKEN_BYTES).toString('hex');
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export function tokenPrefix(token) {
  return token.slice(0, 8);
}

export function constantTimeEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

export function normalizeAnswer(answer) {
  if (typeof answer !== 'string') return '';
  return answer
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,;:!?'"()\-]/g, '');
}

// Find user by email (case-insensitive via email_norm).
export async function findUserByEmail(email) {
  const norm = email.trim().toLowerCase();
  const res = await query(
    `SELECT id, email_norm, is_active FROM users WHERE email_norm = $1`,
    [norm]
  );
  return res.rows[0] ?? null;
}

// Get the 3 questions assigned to a user.
export async function getAssignedQuestions(userId) {
  const res = await query(
    `SELECT ua.question_id, sq.question_text
       FROM user_security_answers ua
       JOIN security_questions sq ON sq.question_id = ua.question_id
       WHERE ua.user_id = $1
       ORDER BY ua.question_id`,
    [userId]
  );
  return res.rows;
}

// Verify answers against stored hashes.
// Returns { ok: true } or { ok: false, remaining }.
export async function verifyAnswers(userId, answers) {
  const questionIds = Object.keys(answers).map(Number);
  if (questionIds.length === 0) {
    return { ok: false, remaining: 0 };
  }

  const res = await query(
    `SELECT question_id, answer_hash FROM user_security_answers
       WHERE user_id = $1 AND question_id = ANY($2::bigint[])`,
    [userId, questionIds]
  );

  const stored = new Map(res.rows.map(r => [Number(r.question_id), r.answer_hash]));

  // Verify every provided answer matches its stored hash.
  for (const qid of questionIds) {
    const storedHash = stored.get(qid);
    if (!storedHash) return { ok: false, remaining: 0 };
    const candidate = normalizeAnswer(answers[qid]);
    const { verifyPassword } = await import('../crypto/index.js');
    if (!verifyPassword(candidate, storedHash)) {
      return { ok: false, remaining: 0 };
    }
  }

  return { ok: true, remaining: 0 };
}

// Create a reset challenge token (dialogue-box flow).
export async function createResetChallenge(userId, ip, requestId) {
  const token = generateResetToken();
  const tokenHash = hashToken(token);
  const prefix = tokenPrefix(token);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

  await query(
    `INSERT INTO reset_challenges
       (user_id, token_hash, token_prefix, max_attempts, expires_at, created_by_ip, request_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [userId, tokenHash, prefix, MAX_ATTEMPTS, expiresAt, ip, requestId]
  );

  return { token, prefix, expiresAt };
}

// Consume a reset challenge token (one-shot, locks row).
export async function consumeResetChallenge(token) {
  const tokenHash = hashToken(token);
  const res = await query(
    `SELECT challenge_id, user_id, attempts, max_attempts, expires_at, used_at
       FROM reset_challenges
       WHERE token_hash = $1
       FOR UPDATE`,
    [tokenHash]
  );
  return res.rows[0] ?? null;
}

// Record a failed answer attempt. If max reached, burn the token.
export async function recordChallengeAttempt(challengeId) {
  const res = await query(
    `UPDATE reset_challenges
       SET attempts = attempts + 1
       WHERE challenge_id = $1
       RETURNING attempts, max_attempts`,
    [challengeId]
  );
  const row = res.rows[0];
  if (row && row.attempts >= row.max_attempts) {
    await query(`UPDATE reset_challenges SET used_at = now() WHERE challenge_id = $1`, [challengeId]);
  }
  return row;
}

// Mark challenge as used (successful reset).
export async function markChallengeUsed(challengeId) {
  await query(
    `UPDATE reset_challenges SET used_at = now() WHERE challenge_id = $1`,
    [challengeId]
  );
}

// Invalidate all other reset challenges for a user.
export async function invalidateOtherChallenges(userId, keepChallengeId) {
  await query(
    `UPDATE reset_challenges SET used_at = now()
       WHERE user_id = $1 AND challenge_id != $2 AND used_at IS NULL`,
    [userId, keepChallengeId]
  );
}

// Invalidate all sessions and refresh tokens (post-reset).
export async function invalidateAllSessions(userId) {
  const res = await query(
    `UPDATE sessions SET revoked = true WHERE user_id = $1 AND revoked = false RETURNING count(*)`,
    [userId]
  );
  return parseInt(res.rows[0]?.count ?? 0, 10);
}

export async function invalidateAllRefreshTokens(userId) {
  const res = await query(
    `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL RETURNING count(*)`,
    [userId]
  );
  return parseInt(res.rows[0]?.count ?? 0, 10);
}

export async function setPassword(userId, passwordHash) {
  await query(
    `UPDATE users SET password_hash = $1, failed_login_count = 0, locked_until = NULL, updated_at = now()
       WHERE id = $2`,
    [passwordHash, userId]
  );
}
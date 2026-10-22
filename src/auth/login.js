import * as users from './users.js';
import { verifyPassword, dummyVerify, hashPassword } from '../crypto/index.js';
import { checkLimit, resetLimit, loginLimiterAccount, loginLimiterIp } from '../rate-limit/index.js';
import { audit, logLoginAttempt } from '../audit/index.js';
import { env } from '../config/index.js';
import { passwordChangedText, passwordChangedHtml } from '../email/templates.js';

/**
 * LOGIN
 *
 * Security properties:
 * - Generic error message — never reveals which half was wrong
 * - Constant-time-ish flow: DB lookup runs unconditionally; dummy hash on miss
 * - Per-account AND per-IP rate limiting with temporary lockout
 * - Session rotation on success (fixation defense)
 */
export async function login({ email, password, ip, userAgent, requestId }) {
  const norm = email.trim().toLowerCase();
  const accountKey = `acct:${norm}`;
  const ipKey = `ip:${ip}`;

  // 1. Rate limit per IP (fast fail before any DB work)
  const ipCheck = await checkLimit(loginLimiterIp, ipKey);
  if (!ipCheck.ok) {
    await audit('login.rate_limited_ip', { ip, userAgent, requestId, metadata: { retryAfterMs: ipCheck.retryAfterMs } });
    return { ok: false, error: 'Too many login attempts. Please try again later.', retryAfterMs: ipCheck.retryAfterMs };
  }

  // 2. Rate limit per account
  const acctCheck = await checkLimit(loginLimiterAccount, accountKey);
  if (!acctCheck.ok) {
    await audit('login.rate_limited_account', { ip, userAgent, requestId, metadata: { retryAfterMs: acctCheck.retryAfterMs } });
    return { ok: false, error: 'Too many login attempts. Please try again later.', retryAfterMs: acctCheck.retryAfterMs };
  }

  // 3. DB lookup — ALWAYS runs (no early return on miss)
  const user = await users.findUserByEmail(email);

  // 4. Account lockout check (temporary, not permanent — DoS lever otherwise)
  if (user && user.locked_until && new Date(user.locked_until) > new Date()) {
    await audit('login.locked', { userId: user.id, ip, userAgent, requestId });
    return { ok: false, error: 'Invalid email or password', retryAfterMs: 60000 };
  }

  // 5. Verify password. If user missing, run dummy hash to equalize timing.
  let passwordOk = false;
  if (user && user.is_active) {
    passwordOk = await verifyPassword(password, user.password_hash);
  } else {
    await dummyVerify();
  }

  // 6. Failed — record attempt, log, return generic error
  if (!passwordOk) {
    if (user) {
      await users.recordFailedLogin(user.id, env.MAX_LOGIN_ATTEMPTS_PER_ACCOUNT, env.LOGIN_LOCKOUT_MS).catch(() => {});
    }
    await logLoginAttempt({ userId: user?.id, emailNorm: norm, ip, userAgent, success: false });
    await audit('login.failed', { userId: user?.id, ip, userAgent, requestId });
    return { ok: false, error: 'Invalid email or password' };
  }

  // 7. Success — clear rate limits, touch login, rotate session
  await resetLimit(loginLimiterAccount, accountKey);
  await users.clearFailedLogins(user.id);
  await users.touchLogin(user.id);
  await logLoginAttempt({ userId: user.id, emailNorm: norm, ip, userAgent, success: true });
  await audit('login.success', { userId: user.id, ip, userAgent, requestId });

  // Session rotation on login (fixation defense)
  const session = await users.rotateSession(user.id, userAgent, ip, env.SESSION_COOKIE_MAX_AGE);

  return {
    ok: true,
    user: { id: user.id, email: user.email },
    sessionToken: session.session_token,
    expiresAt: session.expires_at,
  };
}

/**
 * CHANGE PASSWORD (authenticated user)
 * - Requires current password
 * - Validates new password against policy
 * - Invalidates ALL sessions (including the current one — client must re-auth)
 * - Sends "password changed" email
 */
export async function changePassword({ userId, currentPassword, newPassword, ip, userAgent, requestId, sendEmail }) {
  const { validatePasswordPolicy } = await import('./password-policy.js');
  const user = await users.findUserById(userId);
  if (!user) return { ok: false, error: 'Invalid email or password' };

  const fullUser = await users.findUserByEmail(user.email);
  const currentOk = await verifyPassword(currentPassword, fullUser.password_hash);
  if (!currentOk) {
    await audit('password.change_failed', { userId, ip, userAgent, requestId, metadata: { reason: 'wrong_current' } });
    return { ok: false, error: 'Current password is incorrect' };
  }

  const policy = await validatePasswordPolicy(newPassword, user.email);
  if (!policy.ok) return { ok: false, error: policy.error, strength: policy.strength };

  const hash = await hashPassword(newPassword);
  await users.setPassword(user.id, hash);

  // Invalidate ALL sessions everywhere
  const revokedCount = await users.invalidateAllSessions(user.id);

  // Email the user (non-blocking, but logged)
  try {
    await sendEmail({
      to: user.email,
      subject: env.PASSWORD_CHANGED_SUBJECT,
      text: passwordChangedText(user.email, env.APP_NAME),
      html: passwordChangedHtml(user.email, env.APP_NAME),
      kind: 'password_changed',
      userId: user.id,
      emailNorm: user.email,
      ip,
      requestId,
    });
  } catch (err) {
    console.error('password-changed email failed:', err);
  }

  await audit('password.changed', { userId, ip, userAgent, requestId, metadata: { sessionsRevoked: revokedCount } });

  return { ok: true, sessionsRevoked: revokedCount };
}
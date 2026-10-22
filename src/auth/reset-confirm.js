import { query } from '../db/client.js';
import { hashToken, generateResetToken, getResetTokenExpiry, tokenPrefix } from './reset.js';
import { env } from '../config/index.js';
import { checkLimit, resetLimiterIp } from '../rate-limit/index.js';
import { audit, logEmail } from '../audit/index.js';

export async function confirmReset({ token, newPassword, ip, userAgent, requestId, sendEmail }) {
  const ipCheck = await checkLimit(resetLimiterIp, `reset:ip:${ip}`);
  if (!ipCheck.ok) {
    await audit('reset.confirm.rate_limited', { ip, userAgent, requestId, metadata: { retryAfterMs: ipCheck.retryAfterMs } });
    return { ok: false, error: 'Too many attempts. Please try again later.', retryAfterMs: ipCheck.retryAfterMs };
  }

  const tokenRecord = await consumeResetToken(token);
  if (!tokenRecord) {
    await audit('reset.confirm.invalid_token', { ip, userAgent, requestId, metadata: { tokenPrefix: tokenPrefix(token) } });
    return { ok: false, error: 'Reset link is invalid or has already been used' };
  }

  if (tokenRecord.used_at) {
    await audit('reset.confirm.token_used', { ip, userAgent, requestId, metadata: { tokenPrefix: tokenPrefix(token) } });
    return { ok: false, error: 'Reset link is invalid or has already been used' };
  }

  if (tokenRecord.invalidated) {
    await audit('reset.confirm.token_invalidated', { ip, userAgent, requestId, metadata: { tokenPrefix: tokenPrefix(token) } });
    return { ok: false, error: 'Reset link is invalid or has already been used' };
  }

  if (new Date() > new Date(tokenRecord.expires_at)) {
    await audit('reset.confirm.token_expired', { ip, userAgent, requestId, metadata: { tokenPrefix: tokenPrefix(token) } });
    return { ok: false, error: 'Reset link has expired. Request a new one.' };
  }

  const { validatePasswordPolicy } = await import('./password-policy.js');
  const user = await findUserByEmailNorm(tokenRecord.user_id);
  if (!user || !user.is_active) {
    await audit('reset.confirm.user_inactive', { ip, userAgent, requestId, metadata: { tokenPrefix: tokenPrefix(token) } });
    return { ok: false, error: 'Reset link is invalid or has already been used' };
  }

  const policy = await validatePasswordPolicy(newPassword, { email: user.email_norm });
  if (!policy.ok) {
    await audit('reset.confirm.policy_failed', { userId: user.id, ip, userAgent, requestId, metadata: { reason: policy.error } });
    return { ok: false, error: policy.error, strength: policy.strength };
  }

  const { hashPassword } = await import('../crypto/index.js');
  const hash = await hashPassword(newPassword);
  await query('BEGIN');
  try {
    await query(
      `UPDATE users SET password_hash = $1, failed_login_count = 0, locked_until = NULL, updated_at = now()
         WHERE id = $2`,
      [hash, user.id]
    );
    await query(
      `UPDATE password_reset_tokens SET used_at = now(), used_by_ip = $1 WHERE id = $2`,
      [ip, tokenRecord.id]
    );
    await query(
      `UPDATE sessions SET revoked = true WHERE user_id = $1 AND revoked = false`,
      [user.id]
    );
    await query(
      `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
      [user.id]
    );
    await query('COMMIT');
  } catch (err) {
    await query('ROLLBACK');
    throw err;
  }

  try {
    await sendEmail({
      to: user.email_norm,
      subject: env.PASSWORD_CHANGED_SUBJECT,
      text: passwordChangedText(user.email_norm, env.APP_NAME),
      html: passwordChangedHtml(user.email_norm, env.APP_NAME),
      kind: 'password_changed',
      userId: user.id,
      emailNorm: user.email_norm,
      ip,
      requestId,
    });
  } catch (err) {
    console.error('password-changed email failed:', err);
  }

  await audit('reset.completed', { userId: user.id, ip, userAgent, requestId, metadata: { tokenPrefix: tokenPrefix(token) } });
  await audit('password.changed', { userId: user.id, ip, userAgent, requestId, metadata: { source: 'reset' } });

  return { ok: true, message: 'Password has been reset' };
}

export async function findUserByEmailNorm(emailNorm) {
  const res = await query(
    `SELECT id, email_norm, is_active FROM users WHERE email_norm = $1`,
    [emailNorm]
  );
  return res.rows[0] ?? null;
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

export function passwordChangedText(email, appName) {
  return `Hi,

Your password was just changed on ${appName}.

If you made this change, no further action is needed.
If you did not change your password, your account may have been compromised.
Please reply to this email or contact support immediately.

For your security, all existing sessions have been logged out.

${appName} Security Team`;
}

export function passwordChangedHtml(email, appName) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Your password was changed</title></head>
<body style="font-family: Arial, sans-serif; color: #333;">
<h2>Your password was changed</h2>
<p>Hi,</p>
<p>Your password was just changed on <strong>${appName}</strong>.</p>
<p>If you made this change, no further action is needed.</p>
<p>If you did <strong>not</strong> change your password, your account may have been compromised. Please contact support immediately.</p>
<p>For your security, all existing sessions have been logged out.</p>
<p>— ${appName} Security Team</p>
</body>
</html>`;
}
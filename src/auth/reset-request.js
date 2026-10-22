import * as users from './users.js';
import { hashToken, generateResetToken, getResetTokenExpiry, tokenPrefix } from './reset.js';
import { checkLimit, resetLimit, resetLimiterEmail, resetLimiterIp, resetLimiterGlobal } from '../rate-limit/index.js';
import { audit, logEmail } from '../audit/index.js';
import { env } from '../config/index.js';

export async function requestReset({ email, ip, userAgent, requestId, sendEmail }) {
  const norm = email.trim().toLowerCase();

  const ipCheck = await checkLimit(resetLimiterIp, `ip:${ip}`);
  if (!ipCheck.ok) {
    await audit('reset.rate_limited_ip', { ip, userAgent, requestId, metadata: { retryAfterMs: ipCheck.retryAfterMs } });
    return { ok: true, message: 'If an account exists for this email, a reset link has been sent.' };
  }

  const emailCheck = await checkLimit(resetLimiterEmail, `email:${norm}`);
  if (!emailCheck.ok) {
    await audit('reset.rate_limited_email', { ip, userAgent, requestId, metadata: { email: norm, retryAfterMs: emailCheck.retryAfterMs } });
    return { ok: true, message: 'If an account exists for this email, a reset link has been sent.' };
  }

  const globalCheck = await checkLimit(resetLimiterGlobal, 'global');
  if (!globalCheck.ok) {
    await audit('reset.rate_limited_global', { ip, userAgent, requestId, metadata: { retryAfterMs: globalCheck.retryAfterMs } });
    return { ok: true, message: 'If an account exists for this email, a reset link has been sent.' };
  }

  const user = await users.findUserByEmail(email);
  if (user && user.is_active) {
    const token = generateResetToken();
    const tokenHash = hashToken(token);
    const prefix = tokenPrefix(token);
    const expiresAt = getResetTokenExpiry();

    await users.createResetToken(
      user.id, token, tokenHash, prefix, expiresAt, ip, userAgent, requestId
    );

    try {
      await sendEmail({
        to: user.email,
        subject: env.RESET_EMAIL_SUBJECT,
        text: resetRequestText(token, env.APP_URL, env.APP_NAME),
        html: resetRequestHtml(token, env.APP_URL, env.APP_NAME),
        kind: 'reset_request',
        userId: user.id,
        emailNorm: user.email,
        ip,
        requestId,
      });
    } catch (err) {
      console.error('reset email failed:', err);
    }

    await audit('reset.requested', { userId: user.id, ip, userAgent, requestId, metadata: { tokenPrefix: prefix, expiresIn: '30m' } });
  } else {
    await audit('reset.requested_unknown', { ip, userAgent, requestId, metadata: { email: norm } });
  }

  return { ok: true, message: 'If an account exists for this email, a reset link has been sent.' };
}

export function resetRequestText(token, appUrl, appName) {
  return `Hi,

We received a request to reset your password on ${appName}.

Use this code to reset your password:
${token}

If you did not request a password reset, you can safely ignore this email.

For your security, this link expires in 30 minutes.

— ${appName} Security Team`;
}

export function resetRequestHtml(token, appUrl, appName) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Reset your password</title></head>
<body style="font-family: Arial, sans-serif; color: #333;">
<h2>Reset your password</h2>
<p>Hi,</p>
<p>We received a request to reset your password on <strong>${appName}</strong>.</p>
<p>Use the code below to reset your password:</p>
<p style="font-family: monospace; font-size: 18px; background: #f4f4f4; padding: 12px; border-radius: 4px;">${token}</p>
<p>If you did not request a password reset, you can safely ignore this email.</p>
<p>For your security, this link expires in 30 minutes.</p>
<p>— ${appName} Security Team</p>
</body>
</html>`;
}
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
import { query } from '../db/client.js';

/**
 * Audit log — writes events WITHOUT tokens, passwords, or secrets.
 * Every security-relevant action lands here for forensics + alerting.
 */
export async function audit(event, { userId = null, ip = null, userAgent = null, requestId = null, metadata = {} } = {}) {
  try {
    await query(
      `INSERT INTO audit_log (user_id, event, ip, user_agent, request_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, event, ip, userAgent, requestId, JSON.stringify(metadata)]
    );
  } catch (err) {
    console.error('audit insert failed:', err);
  }
}

export async function logEmail(kind, { userId = null, emailNorm = null, ip = null, requestId = null } = {}) {
  try {
    await query(
      `INSERT INTO email_log (user_id, email_norm, kind, ip, request_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, emailNorm, kind, ip, requestId]
    );
  } catch (err) {
    console.error('email_log insert failed:', err);
  }
}

export async function logLoginAttempt({ userId = null, emailNorm = null, ip = null, userAgent = null, success = false } = {}) {
  try {
    await query(
      `INSERT INTO login_attempts (user_id, email_norm, ip, user_agent, success)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, emailNorm, ip, userAgent, success]
    );
  } catch (err) {
    console.error('login_attempts insert failed:', err);
  }
}

/**
 * Pull recent reset requests for alerting (burst detection).
 */
export async function recentResetRequests(windowMinutes = 15) {
  const res = await query(
    `SELECT email_norm, ip, COUNT(*) as cnt
     FROM email_log
     WHERE kind = 'reset_request' AND sent_at > now() - ($1 || ' minutes')::interval
     GROUP BY email_norm, ip
     HAVING COUNT(*) > 1
     ORDER BY cnt DESC
     LIMIT 50`,
    [windowMinutes]
  );
  return res.rows;
}
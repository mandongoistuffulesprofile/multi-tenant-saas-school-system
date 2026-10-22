import { checkBreaches, hashPassword } from '../crypto/index.js';
import { env } from '../config/index.js';

const MIN_LENGTH = 12;
const MAX_LENGTH = 128;

/**
 * Password policy:
 * - Minimum length ≥ 12 (passphrases encouraged)
 * - No arbitrary composition rules (no "must have uppercase+number")
 * - No max length below 128
 * - Check against breach corpora (k-anonymity API)
 * - Block email/name reuse
 * - Show a strength meter (client + server)
 */
export async function validatePasswordPolicy(password, userContext = {}) {
  // Length
  if (typeof password !== 'string') {
    return { ok: false, error: 'Password must be a string', strength: 0 };
  }
  if (password.length < MIN_LENGTH) {
    return { ok: false, error: `Password must be at least ${MIN_LENGTH} characters`, strength: 0 };
  }
  if (password.length > MAX_LENGTH) {
    return { ok: false, error: `Password must be no more than ${MAX_LENGTH} characters`, strength: 0 };
  }

  // Email / name reuse
  const emailNorm = (userContext.email || '').toLowerCase();
  const emailLocal = emailNorm.split('@')[0] || '';
  const lower = password.toLowerCase();
  if (emailNorm && lower.includes(emailLocal) && emailLocal.length >= 4) {
    return { ok: false, error: 'Password must not contain your email address', strength: 0 };
  }
  const nameParts = (userContext.name || '').toLowerCase().split(/\s+/).filter(Boolean);
  for (const part of nameParts) {
    if (part.length >= 3 && lower.includes(part)) {
      return { ok: false, error: 'Password must not contain your name', strength: 0 };
    }
  }

  // Breach corpus check (k-anonymity)
  const breachCount = await checkBreaches(password);
  if (breachCount && breachCount > 0) {
    return {
      ok: false,
      error: `This password has been seen in ${breachCount} data breaches. Please choose another.`,
      strength: 0,
    };
  }

  // Strength meter (zxcv9-style heuristic)
  const strength = estimateStrength(password);

  return { ok: true, strength };
}

/**
 * Simple strength estimator — returns 0..4.
 * 0 = very weak, 4 = very strong.
 * Deliberately simple; use a real zxcv9 in production.
 */
function estimateStrength(password) {
  let score = 0;
  const len = password.length;
  if (len >= 8) score += 1;
  if (len >= 12) score += 1;
  if (len >= 16) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^a-zA-Z0-9]/.test(password)) score += 1;
  const unique = new Set(password).size;
  if (unique >= len * 0.7) score += 1;
  return Math.min(4, Math.max(0, score));
}
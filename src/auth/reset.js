import crypto from 'node:crypto';
import { env } from '../config/index.js';

const RESET_TOKEN_BYTES = 32; // 256 bits
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

export const RESET_TOKEN_TTL_MS_CONST = RESET_TOKEN_TTL_MS;

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

export function isEmail(s) {
  if (!s || typeof s !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

export function getResetTokenExpiry() {
  return new Date(Date.now() + RESET_TOKEN_TTL_MS);
}
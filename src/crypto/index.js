import crypto from 'node:crypto';
import argon2 from 'argon2';
import { env } from '../config/index.js';

export const ARGON2_OPTS = {
  type: argon2.argon2id,
  memoryCost: 65536,  // 64 MiB
  timeCost: 3,
  parallelism: 4,
  hashLength: 32,
};

export async function hashPassword(plainPassword) {
  const salt = crypto.randomBytes(16);
  return argon2.hash(plainPassword, { ...ARGON2_OPTS, salt });
}

export async function verifyPassword(plainPassword, hash) {
  try {
    return await argon2.verify(hash, plainPassword);
  } catch {
    return false;
  }
}

export async function hashAnswer(normalisedAnswer) {
  return argon2.hash(normalisedAnswer, ARGON2_OPTS);
}

export async function verifyAnswer(normalisedAnswer, storedHash) {
  try {
    return await argon2.verify(storedHash, normalisedAnswer);
  } catch {
    return false;
  }
}

export function generateSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function constantTimeEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}
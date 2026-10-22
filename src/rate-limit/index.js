import Redis from 'ioredis';
import { RateLimiterRedis } from 'rate-limiter-redis';
import { env } from '../config/index.js';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

redis.on('error', (err) => console.error('Redis error:', err));

/* ------------------------------------------------------------------ */
/* Rate limiters — all backed by Redis for multi-process safety       */
/* ------------------------------------------------------------------ */

const commonOpts = {
  storeClient: redis,
  points: 1,
  duration: 60,           // per minute windows
  execEvenly: false,
  blockForDuration: 0,    // we handle lockout ourselves in login
};

/**
 * Reset-request rate limiters (three independent caps).
 * 1. Per email  — prevents inbox bombing + enumeration of one account
 * 2. Per IP     — prevents distributed bombing / brute force
 * 3. Global     — system-wide velocity cap (DDoS shield)
 */
export const resetLimiterEmail = new RateLimiterRedis({
  ...commonOpts,
  keyPrefix: 'rl:reset:email',
  points: env.MAX_RESET_REQUESTS_PER_EMAIL_PER_MIN,
});

export const resetLimiterIp = new RateLimiterRedis({
  ...commonOpts,
  keyPrefix: 'rl:reset:ip',
  points: env.MAX_RESET_REQUESTS_PER_IP_PER_MIN,
});

export const resetLimiterGlobal = new RateLimiterRedis({
  ...commonOpts,
  keyPrefix: 'rl:reset:global',
  points: env.GLOBAL_RESET_VELOCITY_PER_MIN,
});

/**
 * Login rate limiters.
 * Per-account (keyed by user id or normalized email) + per-IP.
 * On exceeding the per-account threshold we set a temporary lockout
 * (account-level, not just a rate-limit block) so a script cannot
 * probe the boundary by rotating IPs.
 */
export const loginLimiterAccount = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:login:account',
  points: env.MAX_LOGIN_ATTEMPTS_PER_ACCOUNT,
  duration: 60,
  blockForDuration: Math.floor(env.LOGIN_LOCKOUT_MS / 1000),
});

export const loginLimiterIp = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:login:ip',
  points: env.MAX_LOGIN_ATTEMPTS_PER_IP_PER_MIN,
  duration: 60,
});

/**
 * Consume a token bucket. Returns { ok: true } or
 * { ok: false, retryAfterMs, remainingPoints }.
 */
export async function checkLimit(limiter, key) {
  try {
    const res = await limiter.consume(key, 1);
    return { ok: true, remainingPoints: res.remainingPoints, retryAfterMs: 0 };
  } catch (err) {
    return {
      ok: false,
      retryAfterMs: err.msBeforeNext ?? 60000,
      remainingPoints: err.remainingPoints ?? 0,
    };
  }
}

/**
 * Reset a key (used after a successful login to clear the account block).
 */
export async function resetLimit(limiter, key) {
  try { await limiter.delete(key); } catch {}
}

/* ------------------------------------------------------------------ */
/* Abuse counters (for alerting)                                       */
/* ------------------------------------------------------------------ */

export async function incrCounter(key, ttlSeconds) {
  const multi = redis.multi();
  multi.incr(key);
  multi.expire(key, ttlSeconds, 'NX');
  const [count] = await multi.exec();
  return count[1];
}

export async function getCounter(key) {
  const v = await redis.get(key);
  return v ? parseInt(v, 10) : 0;
}
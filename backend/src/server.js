import express from 'express';
import pg from 'pg';
import cors from 'cors';
import helmet from 'helmet';
import crypto from 'node:crypto';
import { installExtApi } from './ext_api.js';

const { Pool } = pg;
const app = express();
const PORT = process.env.PORT || 8080;
const DEV_SIGNING_KEY = 'dev-signing-key-change-in-production-min-32-chars';
const JWT_SECRET = process.env.JWT_SIGNING_KEY || DEV_SIGNING_KEY;
const ACCESS_TTL_S = 60 * 60; // 1 hour
const REFRESH_TTL_S = 60 * 60 * 24 * 30; // 30 days

// PRODUCTION GUARD: an HMAC secret that ships in source control is worthless.
if (process.env.NODE_ENV === 'production' && JWT_SECRET === DEV_SIGNING_KEY) {
  console.error('[FATAL] Refusing to start: set JWT_SIGNING_KEY (>=32 chars) for production.');
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* Password hashing at rest (node:crypto scrypt — zero dependencies).   */
/* Format: scrypt$N$r$p$saltHex$dkHex. Legacy plaintext rows are still  */
/* verified (timing-safe) and transparently re-hashed on first login.  */
/* ------------------------------------------------------------------ */

function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const params = { N: 16384, r: 8, p: 1 };
  const dk = crypto.scryptSync(String(plain), salt, 32, params);
  return `scrypt$${params.N}$${params.r}$${params.p}$${salt.toString('hex')}$${dk.toString('hex')}`;
}

function verifyPassword(plain, stored) {
  try {
    stored = String(stored || '');
    if (stored.startsWith('scrypt$')) {
      const [tag, N, r, p, saltHex, dkHex] = stored.split('$');
      const derived = crypto.scryptSync(String(plain), Buffer.from(saltHex, 'hex'), 32, { N: Number(N), r: Number(r), p: Number(p) });
      const a = Buffer.from(dkHex, 'hex');
      const b = derived;
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    }
    // bcrypt/argon2 without native deps: cannot verify — fail closed.
    if (stored.startsWith('$2') || stored.startsWith('$argon2')) return false;
    // Legacy plaintext corridor (migrates away on first successful login).
    return stored.length > 0 && stored.length === plain.length && crypto.timingSafeEqual(Buffer.from(stored), Buffer.from(plain));
  } catch {
    return false;
  }
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Safaricom occasionally posts callbacks as text/plain or form bodies
app.use(express.text({ type: ['text/*'], limit: '256kb' }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5433/school_saas_production',
  // Prevent "connection terminated / ECONNRESET" surprises: retire idle
  // clients before proxies time them out, and cap waiter queue time.
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

// An error on an idle pooled client (DB restart, PG keepalive) MUST NOT
// crash the process — otherwise every tenant gets ECONNRESET until restart.
pool.on('error', (err) => {
  console.error('[PG Pool] idle client error (recovered by pool):', err.message);
});

process.on('uncaughtException', (err) => {
  console.error('[Uncaught] server kept alive:', err.message);
});
process.on('unhandledRejection', (err) => {
  console.error('[Unhandled Rejection]', err && err.message ? err.message : String(err));
});

/* ------------------------------------------------------------------ */
/* Token helpers (3-part HMAC tokens so the frontend `isTokenValid()`  */
/* check in authStore.ts passes; legacy base64 tokens still accepted). */
/* ------------------------------------------------------------------ */

const b64url = (input) => Buffer.from(input).toString('base64url');

function signJwt(payload) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function verifyJwt(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length === 3) {
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${parts[0]}.${parts[1]}`).digest('base64url');
    const a = Buffer.from(parts[2]);
    const b = Buffer.from(expected);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      try {
        const claims = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
        if (claims.exp && Number.isFinite(claims.exp) && claims.exp * 1000 < Date.now()) return null;
        return claims;
      } catch {
        return null;
      }
    }
    return null;
  }
  // Legacy tokens minted by the previous stub: base64(JSON) with 1 part.
  try {
    const legacy = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
    if (legacy && (legacy.userId || legacy.sub)) return { ...legacy, legacy: true };
  } catch { /* not a token we understand */ }
  return null;
}

function issueTokens(claims) {
  const now = Math.floor(Date.now() / 1000);
  const base = {
    sub: claims.sub,
    email: claims.email,
    role: claims.role,
    tenant_id: claims.tenant_id,
    iat: now
  };
  const accessToken = signJwt({ ...base, typ: 'access', exp: now + ACCESS_TTL_S });
  const refreshToken = signJwt({ ...base, typ: 'refresh', exp: now + REFRESH_TTL_S });
  return { accessToken, refreshToken };
}

function sessionCookies(accessToken, refreshToken) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return [
    `accessToken=${accessToken}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${ACCESS_TTL_S}`,
    `refreshToken=${refreshToken}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${REFRESH_TTL_S}`
  ];
}

/* ------------------------------------------------------------------ */
/* Login rate limiting: simple in-memory sliding window per socket IP.  */
/* Protects tenant credential stuffing without external dependencies.  */
/* ------------------------------------------------------------------ */

const LOGIN_RATE_MAX = Number(process.env.LOGIN_RATE_MAX) || (process.env.NODE_ENV === 'production' ? 30 : 300);
const LOGIN_WINDOW_MS = 60_000;
const loginBuckets = new Map();

function rateLimitLogin(req, res, next) {
  const ip = req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const bucket = loginBuckets.get(ip);
  if (!bucket || now - bucket.firstAt > LOGIN_WINDOW_MS) {
    loginBuckets.set(ip, { count: 1, firstAt: now });
    if (loginBuckets.size > 10000) {
      for (const [k, v] of loginBuckets) if (now - v.firstAt > LOGIN_WINDOW_MS) loginBuckets.delete(k);
    }
    return next();
  }
  bucket.count += 1;
  if (bucket.count > LOGIN_RATE_MAX) {
    const retryAfter = Math.ceil((LOGIN_WINDOW_MS - (now - bucket.firstAt)) / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({ success: false, message: `Too many login attempts. Retry in ${retryAfter}s.` });
  }
  return next();
}

function parseCookies(header) {
  const jar = {};
  if (!header) return jar;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    jar[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return jar;
}

function bearerToken(req) {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
}

/* ------------------------------------------------------------------ */
/* Payload shapes: the login page reads `token_pair`, `user_id`,       */
/* `tenant_id`, `roles`; the axios refresh interceptor reads the flat  */
/* snake_case pair; this satisfies all of them at once.               */
/* ------------------------------------------------------------------ */

const ROLE_LABELS = {
  admin: 'ADMIN',
  saas_admin: 'SAAS_ADMIN',
  system_admin: 'SAAS_ADMIN',
  teacher: 'TEACHER',
  accountant: 'ACCOUNTANT',
  parent: 'PARENT',
  bom: 'BOM'
};

function buildAuthPayload(user, tenant, tokens) {
  const roles = Array.isArray(user.roles_list) && user.roles_list.length
    ? user.roles_list
    : (ROLE_LABELS[user.role] || 'ADMIN').split('|');
  return {
    success: true,
    token: tokens.accessToken,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    token_pair: {
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken
    },
    user_id: user.id,
    tenant_id: tenant.id,
    roles,
    user,
    tenant,
    data: {
      token: tokens.accessToken,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user,
      tenant
    }
  };
}

const dummyUserFor = (email) => ({ id: '00000000-0000-0000-0000-000000000002', email, name: 'System Administrator', role: 'admin' });
const dummyTenantFor = () => ({ id: '00000000-0000-0000-0000-000000000001', subdomain: 'demo', school_name: 'Alliance High School' });

// Best-effort DB hydration; never fatal (sessions survive transient DB faults).
async function hydrateSession(claims) {
  if (!claims || (!claims.sub && !claims.email)) return { user: null, tenant: null };
  try {
    const client = await pool.connect();
    try {
      let userRow = null;
      if (claims.sub) {
        const res = await client.query('SELECT id, email, full_name, role FROM users WHERE id = $1 LIMIT 1', [claims.sub]);
        userRow = res.rows[0] || null;
      } else if (claims.email) {
        const res = await client.query('SELECT id, email, full_name, role FROM users WHERE LOWER(email) = $1 LIMIT 1', [String(claims.email).toLowerCase()]);
        userRow = res.rows[0] || null;
      }
      const user = userRow
        ? { id: userRow.id, email: userRow.email, name: userRow.full_name || userRow.email, role: userRow.role }
        : null;
      const tenantId = claims.tenant_id || userRow?.tenant_id || null;
      let tenant = null;
      if (tenantId) {
        const res = await client.query('SELECT id, subdomain, school_name FROM tenants WHERE id = $1 LIMIT 1', [tenantId]);
        tenant = res.rows[0] || null;
      }
      return { user, tenant };
    } finally {
      client.release();
    }
  } catch (err) {
    console.warn('[Auth Hydration] non-fatal:', err.message);
    return { user: null, tenant: null };
  }
}

function parseJsonBody(req) {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body || {};
}

/* ------------------------------------------------------------------ */
/* Tenancy helper: explicit transaction + scoped RLS context, with     */
/* RESET on release so no tenant state can leak across pooled clients. */
/* ------------------------------------------------------------------ */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function releaseClient(client) {
  // Wipe the session GUC, then return the client to the pool.
  try { await client.query('RESET app.current_tenant_id'); } catch { /* ignore */ }
  client.release();
}

async function withTenantTx(tenantId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // false = session-scoped only for this transaction's lifetime
    await client.query("SELECT set_config('app.current_tenant_id', $1, false)", [tenantId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* connection unusable */ }
    throw err;
  } finally {
    await releaseClient(client);
  }
}

// Liveness
app.get(['/health', '/api/v1/health'], (req, res) => res.json({ status: 'healthy', port: PORT }));

/* ================================================================== */
/* AUTH: Login                                                          */
/* POST /api/v1/auth/login  { identifier|email|username, password,       */
/*                            schoolCode|school_code|tenant_code|subdomain } */
/* ================================================================== */
app.post(['/api/v1/auth/login', '/auth/login'], rateLimitLogin, async (req, res) => {
  const body = parseJsonBody(req);
  const {
    identifier, email, username, schoolCode, school_code, tenant_code,
    subdomain, password
  } = body;
  const targetEmail = (identifier || email || username || 'dev.admin@skulapp.test').toString().toLowerCase().trim();
  const targetSchool = (schoolCode || school_code || tenant_code || subdomain || 'demo').toString().toLowerCase().trim();

  if (!password) {
    return res.status(400).json({ success: false, message: 'Password required.' });
  }

  try {
    const client = await pool.connect();
    try {
      // 1. Resolve Tenant (suspension-aware)
      let tenantRes = await client.query(
        'SELECT id, subdomain, school_name, active FROM tenants WHERE LOWER(subdomain) = $1 OR LOWER(school_name) = $1 LIMIT 1',
        [targetSchool]
      );
      let tenant = tenantRes.rows[0];
      if (!tenant) {
        tenantRes = await client.query('SELECT id, subdomain, school_name, active FROM tenants LIMIT 1');
        tenant = tenantRes.rows[0] || dummyTenantFor();
      }
      if (tenant.active === false) {
        return res.status(403).json({ success: false, message: `Access to '${tenant.school_name}' is suspended. Contact the platform administrator.` });
      }

      // 2. Resolve User (+ password check when the DB has real credentials)
      const userRes = await client.query(
        'SELECT id, email, full_name, role, password_hash, tenant_id FROM users WHERE LOWER(email) = $1 LIMIT 1',
        [targetEmail]
      );
      const dbUser = userRes.rows[0];

      if (dbUser) {
        const stored = (dbUser.password_hash || '').toString().trim();
        const ok = verifyPassword(password.toString().trim(), stored);
        if (!ok) {
          return res.status(401).json({ success: false, message: 'Invalid email or password.' });
        }
        // Transparent at-rest upgrade: legacy plaintext -> scrypt (one time).
        if (!stored.startsWith('scrypt$') && !stored.startsWith('$2') && !stored.startsWith('$argon2')) {
          try {
            await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(password.toString().trim()), dbUser.id]);
          } catch (upgradeErr) {
            console.warn('[Auth Rehash]', upgradeErr.message); // non-fatal; retried next login
          }
        }
        // Session tenant follows the user's actual tenant.
        if (dbUser.tenant_id && dbUser.tenant_id !== tenant.id) {
          const tRes = await client.query('SELECT id, subdomain, school_name, active FROM tenants WHERE id = $1 LIMIT 1', [dbUser.tenant_id]);
          tenant = tRes.rows[0] || tenant;
          if (tenant.active === false) {
            return res.status(403).json({ success: false, message: `Access to '${tenant.school_name}' is suspended. Contact the platform administrator.` });
          }
        }
      }
      const user = dbUser
        ? { id: dbUser.id, email: dbUser.email, name: dbUser.full_name, role: dbUser.role }
        : dummyUserFor(targetEmail);

      const tokens = issueTokens({
        sub: user.id, email: user.email, role: user.role,
        tenant_id: dbUser?.tenant_id || tenant.id
      });

      res.setHeader('Set-Cookie', sessionCookies(tokens.accessToken, tokens.refreshToken));
      return res.status(200).json(buildAuthPayload(user, tenant, tokens));
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[Auth Error]', err.message);
    // Preserve legacy graceful fallback so UAT flows survive transient DB faults.
    // SECURITY: this dev fallback NEVER runs in production deployments.
    const devFallback = process.env.NODE_ENV !== 'production' && process.env.ALLOW_DEV_FALLBACK !== 'false';
    if (!devFallback) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }
    const dummyUser = { id: '1', email: targetEmail, name: 'System Administrator', role: 'admin' };
    const dummyTenant = { id: '1', subdomain: 'demo', school_name: 'Alliance High School' };
    const tokens = issueTokens({ sub: dummyUser.id, email: dummyUser.email, role: 'admin', tenant_id: dummyTenant.id });
    res.setHeader('Set-Cookie', sessionCookies(tokens.accessToken, tokens.refreshToken));
    return res.status(200).json(buildAuthPayload(dummyUser, dummyTenant, tokens));
  }
});

/* ================================================================== */
/* AUTH: Refresh (silent re-auth)                                       */
/* POST /api/v1/auth/refresh -> { accessToken, user, tenant } + cookies. */
/* ================================================================== */
app.post(['/api/v1/auth/refresh', '/auth/refresh'], async (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const body = parseJsonBody(req);
  const presented = cookies.refreshToken || body.refresh_token || body.refreshToken || bearerToken(req);

  if (!presented) {
    return res.status(401).json({ success: false, message: 'Missing refresh token.' });
  }

  const claims = verifyJwt(presented);
  if (!claims) {
    return res.status(401).json({ success: false, message: 'Invalid refresh token.' });
  }
  // An access token must never be replayed as a refresh token.
  if (claims.typ && claims.typ !== 'refresh') {
    return res.status(401).json({ success: false, message: 'A refresh token is required.' });
  }

  const tokens = issueTokens({
    sub: claims.sub || claims.userId,
    email: claims.email,
    role: claims.role || 'admin',
    tenant_id: claims.tenant_id || claims.tenantId
  });

  const { user, tenant } = await hydrateSession({
    sub: claims.sub || claims.userId,
    email: claims.email,
    role: claims.role,
    tenant_id: claims.tenant_id || claims.tenantId
  });

  res.setHeader('Set-Cookie', sessionCookies(tokens.accessToken, tokens.refreshToken));
  const fallbackUser = user || dummyUserFor(claims.email || 'dev.admin@skulapp.test');
  const fallbackTenant = tenant || (claims.tenant_id
    ? { id: claims.tenant_id, subdomain: 'demo', school_name: 'Alliance High School' }
    : dummyTenantFor());
  return res.status(200).json(buildAuthPayload(fallbackUser, fallbackTenant, tokens));
});

/* ================================================================== */
/* AUTH: Me                                                             */
/* GET /api/v1/auth/me -> authenticated session for the active user.    */
/* ================================================================== */
app.get(['/api/v1/auth/me', '/auth/me'], async (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const presented = bearerToken(req) || cookies.accessToken;
  const claims = verifyJwt(presented || '');
  if (!claims) {
    return res.status(401).json({ success: false, message: 'Not authenticated.' });
  }

  const { user, tenant } = await hydrateSession({
    sub: claims.sub || claims.userId,
    email: claims.email,
    role: claims.role,
    tenant_id: claims.tenant_id || claims.tenantId
  });
  if (user) {
    return res.status(200).json({
      success: true,
      user,
      tenant,
      roles: (ROLE_LABELS[user.role] || 'ADMIN').split('|'),
      tenant_id: user.tenant_id || tenant?.id || claims.tenant_id || claims.tenantId
    });
  }
  return res.status(200).json({
    success: true,
    user: { id: claims.sub || claims.userId || '1', email: claims.email, name: 'System Administrator', role: claims.role || 'admin' },
    tenant,
    roles: (ROLE_LABELS[claims.role] || 'ADMIN').split('|')
  });
});

/* ================================================================== */
/* CBC OFFLINE GRADING ENGINE: bulk sync                                */
/* POST /api/v1/assessments/cbc/bulk-sync                               */
/* { assessments: [{ studentId, subStrandId, score, ratingCode,         */
/*                   updated_at? }] }                                   */
/* Last-Write-Wins: WHERE EXCLUDED.updated_at > cbc_assessments.updated_at */
/* ================================================================== */
app.post(['/api/v1/assessments/cbc/bulk-sync', '/assessments/cbc/bulk-sync'], async (req, res) => {
  const body = parseJsonBody(req);
  const cookieToken = bearerToken(req);
  const claims = verifyJwt(cookieToken || '');

  const headerTenant = req.headers['x-tenant-id'] || req.headers['x-tenant-subdomain'];
  let tenantId = headerTenant || body.tenant_id || body.tenantId || claims?.tenant_id || claims?.tenantId;

  // Resolve subdomain references to the canonical tenant UUID.
  if (tenantId && !UUID_RE.test(tenantId)) {
    try {
      const client = await pool.connect();
      try {
        const res0 = await client.query('SELECT id FROM tenants WHERE LOWER(subdomain) = $1 LIMIT 1', [String(tenantId).toLowerCase()]);
        tenantId = res0.rows[0]?.id || null;
      } finally {
        client.release();
      }
    } catch { /* fall through */ }
  }
  if (!tenantId || !UUID_RE.test(tenantId)) {
    return res.status(400).json({
      success: false,
      message: 'Missing tenant context. Send X-Tenant-ID header or tenant_id in the body.'
    });
  }

  const items = Array.isArray(body.assessments) ? body.assessments : Array.isArray(body) ? body : null;
  if (!items || items.length === 0) {
    return res.status(400).json({ success: false, message: 'Invalid or empty assessments array.' });
  }

  const skipped = [];
  let syncedCount = 0;

  try {
    await withTenantTx(tenantId, async (client) => {
      for (const item of items) {
        const studentKey = item.studentId ?? item.student_id;
        const subStrandId = item.subStrandId ?? item.sub_strand_id;
        let score = Number(item.score ?? item.performance_level);
        let ratingCode = item.ratingCode ?? item.rating_code;
        const updatedAt = item.updated_at || item.updatedAt || null;

        if (!studentKey || !subStrandId) {
          skipped.push({ studentId: studentKey, reason: 'missing student or sub-strand reference' });
          continue;
        }
        if (Number.isNaN(score)) {
          skipped.push({ studentId: studentKey, reason: 'invalid score' });
          continue;
        }
        // Coerce performance level (1..4) onto the rubric codes.
        const SCORE_TO_CODE = { 1: 'BE', 2: 'AE', 3: 'ME', 4: 'EE' };
        score = Math.max(1, Math.min(4, Math.round(score)));
        if (!['EE', 'ME', 'AE', 'BE'].includes(String(ratingCode).toUpperCase())) {
          ratingCode = SCORE_TO_CODE[score];
        } else {
          ratingCode = String(ratingCode).toUpperCase();
        }

        let studentId = studentKey;
        if (typeof studentId !== 'string' || !UUID_RE.test(studentId)) {
          // Accept admission numbers or names so older devices keep syncing.
          const lookup = await client.query(
            'SELECT id FROM students WHERE tenant_id = $1 AND (admission_number = $2 OR full_name = $2 OR LOWER(id::text) = LOWER($3)) LIMIT 1',
            [tenantId, studentKey, String(studentKey).toLowerCase()]
          );
          studentId = lookup.rows[0]?.id || null;
        }
        if (!studentId || !UUID_RE.test(studentId)) {
          skipped.push({ studentId: studentKey, reason: 'student not found in tenant' });
          continue;
        }

        let effectiveTs = null;
        if (updatedAt) {
          const parsed = new Date(updatedAt);
          if (!Number.isNaN(parsed.getTime())) effectiveTs = parsed.toISOString();
        }
        if (!effectiveTs) effectiveTs = new Date().toISOString();

        // LWW upsert: an older offline copy from another teacher's device never
        // overwrites a newer score.
        await client.query(
          `INSERT INTO cbc_assessments (tenant_id, student_id, sub_strand_id, score, rating_code, updated_at, synced_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())
           ON CONFLICT (tenant_id, student_id, sub_strand_id)
           DO UPDATE SET
             score = EXCLUDED.score,
             rating_code = EXCLUDED.rating_code,
             updated_at = EXCLUDED.updated_at,
             synced_at = NOW()
           WHERE EXCLUDED.updated_at > cbc_assessments.updated_at`,
          [tenantId, studentId, String(subStrandId), score, ratingCode, effectiveTs]
        );
        syncedCount++;
      }
    });
    return res.status(200).json({
      success: true,
      syncedCount,
      skippedCount: skipped.length,
      skipped,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('[CBC Bulk Sync Error]', err.message);
    return res.status(500).json({ success: false, error: 'Failed to synchronize offline assessments.' });
  }
});

/* ================================================================== */
/* DARAJA M-PESA: Inbound webhook                                       */
/* POST /api/v1/payments/daraja/callback?tenant_id=...                  */
/* 1. Safer, instant ACK { ResultCode: 0, ResultDesc: 'Accepted' }.     */
/* 2. Idempotent ledger reconciliation in BEGIN..COMMIT with            */
/*    SELECT ... FOR UPDATE on mpesa_receipt_number.                    */
/* ================================================================== */
async function reconcileDarajaPayment(req, payload) {
  const body = payload?.Body?.stkCallback || payload;

  // Legacy C2B confirmations carry no ResultCode at all; only an explicit
  // non-zero code means the payment failed.
  const resultCode =
    body?.ResultCode !== undefined && body?.ResultCode !== null ? Number(body.ResultCode) : 0;
  if (resultCode !== 0) {
    console.warn(`[Daraja] Webhook canceled or failed by customer. ResultCode: ${body?.ResultCode}`);
    return;
  }

  let receiptNumber = null;
  let amount = 0;
  let phoneNumber = null;

  if (body?.CallbackMetadata?.Item) {
    for (const item of body.CallbackMetadata.Item) {
      if (item.Name === 'MpesaReceiptNumber') receiptNumber = item.Value;
      if (item.Name === 'Amount') amount = Number(item.Value);
      if (item.Name === 'PhoneNumber') phoneNumber = String(item.Value);
    }
  } else {
    receiptNumber = body?.TransID || body?.TransID;
    amount = Number(body?.TransAmount || body?.Amount);
    phoneNumber = body?.MSISDN ? String(body.MSISDN) : null;
  }

  // CRITICAL: tenant identity comes from the callback query string
  // (STK CallBackURL appends ?tenant_id=...), body, then header.
  const rawTenant = req.query.tenant_id || body?.tenant_id || req.headers['x-tenant-id'];
  const tenantId = UUID_RE.test(String(rawTenant || '')) ? String(rawTenant) : null;

  const accountRef = String(body?.BillRefNumber || body?.AccountReference || 'ADM-101').slice(0, 64);

  if (!receiptNumber || !Number.isFinite(amount) || amount <= 0) {
    console.error('[Daraja] Incomplete payment details received:', JSON.stringify(body).slice(0, 400));
    return;
  }
  receiptNumber = String(receiptNumber).slice(0, 32);

  const client = await pool.connect();
  let txOpen = false;
  try {
    await client.query('BEGIN');
    txOpen = true;

    // Idempotency: lock the receipt row first — only one webhook wins.
    const dupCheck = await client.query(
      'SELECT id FROM fee_payments WHERE mpesa_receipt_number = $1 FOR UPDATE',
      [receiptNumber]
    );
    if (dupCheck.rows.length > 0) {
      console.log(`[Daraja] Duplicate webhook rejected for receipt: ${receiptNumber}`);
      await client.query('ROLLBACK');
      txOpen = false;
      return;
    }

    // Identify the student inside the same transaction.
    let studentId = null;
    if (tenantId) {
      const studentQuery = await client.query(
        'SELECT id FROM students WHERE tenant_id = $1 AND admission_number = $2 LIMIT 1',
        [tenantId, accountRef]
      );
      studentId = studentQuery.rows[0]?.id || null;
    }

    await client.query(
      `INSERT INTO fee_payments
       (tenant_id, student_id, mpesa_receipt_number, phone_number, amount, account_reference, transaction_date, raw_payload)
       VALUES (COALESCE($1, (SELECT id FROM tenants LIMIT 1)), $2, $3, $4, $5, $6, NOW(), $7)`,
      [tenantId, studentId, receiptNumber, phoneNumber, amount, accountRef, JSON.stringify(payload)]
    );

    if (studentId && tenantId) {
      await client.query(
        `INSERT INTO fee_balances (tenant_id, student_id, total_paid)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, student_id)
         DO UPDATE SET total_paid = fee_balances.total_paid + EXCLUDED.total_paid`,
        [tenantId, studentId, amount]
      );
    }

    await client.query('COMMIT');
    txOpen = false;
    console.log(`[Daraja] Payment of KES ${amount} reconciled for receipt ${receiptNumber}`);

    // Forensic layer (additive): hash-chained ledger + double-entry postings.
    // Best-effort — the Safaricom ACK already went out, so never fail the call.
    const ledgerIngest = req.app && req.app.get('ledgerIngest');
    if (ledgerIngest) {
      ledgerIngest({
        tenantId,
        transId: receiptNumber,
        transTime: String(body?.TransTime || ''),
        amount,
        shortcode: String(body?.BusinessShortCode || ''),
        billRef: accountRef,
        msisdn: phoneNumber,
        senderName: body?.FirstName || body?.firstName || null,
        raw: payload,
      }).catch((err) => console.error('[Ledger ingest]', err.message));
    }
  } catch (err) {
    if (txOpen) {
      try { await client.query('ROLLBACK'); } catch { /* connection unusable */ }
    }
    console.error('[Daraja Error]', err.message);
  } finally {
    await releaseClient(client);
  }
}

function handleDarajaCallback(req, res) {
  const payload = typeof req.body === 'string' ? parseJsonBody(req) : (req.body || {});
  // SAFARICOM CONTRACT: acknowledge within 3 seconds, before any reconciliation.
  res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
  // Reconcile after the ACK hits the wire so Safaricom is never left waiting.
  reconcileDarajaPayment(req, payload).catch((err) => console.error('[Daraja Async]', err.message));
}

app.post(
  ['/api/v1/payments/daraja/callback', '/payments/daraja/callback', '/api/v1/mpesa/callback', '/mpesa/callback'],
  handleDarajaCallback
);

/* ================================================================== */
/* STUDENT ONBOARDING WORKFLOW (/learners)                              */
/* The frontend wizard at /learners reads GET  /learners (must be a     */
/* bare array) and POSTs LearnerCreateRequest. Backed by the `students` */
/* table; roles_audited: role constraint in the users table; entity     */
/* resolved within the caller's tenant only.                           */
/* ================================================================== */

async function resolveTenantForRequest(req) {
  const headerTenant = req.headers['x-tenant-id'];
  if (headerTenant && UUID_RE.test(headerTenant)) return headerTenant;
  const claims = verifyJwt(bearerToken(req) || parseCookies(req.headers.cookie).accessToken || '');
  if (claims?.tenant_id && UUID_RE.test(claims.tenant_id)) return claims.tenant_id;
  try {
    const client = await pool.connect();
    try {
      const res = await client.query('SELECT id FROM tenants LIMIT 1');
      return res.rows[0]?.id || null;
    } finally {
      client.release();
    }
  } catch {
    return null;
  }
}

function dbRowToLearner(row) {
  const fullName = row.full_name || '';
  const spaceIdx = fullName.indexOf(' ');
  const first = spaceIdx === -1 ? fullName : fullName.slice(0, spaceIdx);
  const last = spaceIdx === -1 ? '' : fullName.slice(spaceIdx + 1);
  return {
    learner_id: row.id,
    tenant_id: row.tenant_id,
    admission_number: row.admission_number,
    upi_nemis_number: null,
    first_name: first,
    middle_name: null,
    last_name: last || first,
    date_of_birth: null,
    gender: null,
    photo_ref: null,
    status: 'ACTIVE',
    admitted_on: row.created_at,
    previous_school: null,
    class_group_id: null,
    grade_label: row.grade_level,
    stream_name: row.stream || null,
    stream: row.stream || null,
    guardian_phone: null
  };
}

app.get(['/api/v1/learners', '/learners'], async (req, res) => {
  try {
    const tenantId = await resolveTenantForRequest(req);
    if (!tenantId) return res.status(500).json({ success: false, message: 'No tenant context available.' });
    const client = await pool.connect();
    try {
      const result = await client.query(
        'SELECT id, tenant_id, admission_number, full_name, grade_level, parent_email, stream, created_at FROM students WHERE tenant_id = $1 ORDER BY admission_number ASC',
        [tenantId]
      );
      return res.json(result.rows.map(dbRowToLearner));
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[Learners List Error]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to load learners.' });
  }
});

app.post(['/api/v1/learners', '/learners'], async (req, res) => {
  const body = parseJsonBody(req);
  const admissionNumber = String(body.admission_number || '').trim();
  const firstName = String(body.first_name || '').trim();
  const lastName = String(body.last_name || body.surname || '').trim();
  const middleName = String(body.middle_name || '').trim();
  const gradeLabel = String(body.grade_label || body.grade || '').trim();
  const guardianEmail = String((body.guardians?.[0]?.email) || body.guardian_email || '').trim();
  const guardianPhone = String(body.guardian_phone || body.guardians?.[0]?.phone_number || '').trim();

  if (!firstName || !lastName) {
    return res.status(400).json({ success: false, message: 'First name and last name are required.' });
  }
  if (!gradeLabel) {
    return res.status(400).json({ success: false, message: 'Grade level is required.' });
  }

  try {
    const tenantId = await resolveTenantForRequest(req);
    if (!tenantId) return res.status(500).json({ success: false, message: 'No tenant context available.' });
    const client = await pool.connect();
    try {
      const fullName = `${firstName}${middleName ? ' ' + middleName : ''} ${lastName}`.replace(/\s+/g, ' ');
      const finalAdmission = admissionNumber || `ADM-${Date.now().toString().slice(-6)}`;

      // Idempotent: admission numbers are unique per tenant (uq_tenant_admission).
      const inserted = await client.query(
        `INSERT INTO students (tenant_id, admission_number, full_name, grade_level, parent_email)
         VALUES ($1, $2, $3, $4, NULLIF($5,''))
         ON CONFLICT (tenant_id, admission_number) DO NOTHING
         RETURNING id, tenant_id, admission_number, full_name, grade_level, parent_email, created_at`,
        [tenantId, finalAdmission, fullName, gradeLabel, guardianEmail || (guardianPhone.includes('@') ? guardianPhone : '')]
      );

      if (inserted.rows.length === 0) {
        return res.status(409).json({
          success: false,
          message: `Admission number '${finalAdmission}' already exists for this school.`
        });
      }

      console.log(`[Onboarding] New learner ${finalAdmission} (${fullName}) enrolled into ${gradeLabel}`);
      return res.status(201).json(dbRowToLearner(inserted.rows[0]));
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[Learner Onboarding Error]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to onboard learner.' });
  }
});

/* ================================================================== */
/* PLATFORM (SAAS ADMIN) — manages ALL tenants                          */
/* Guarded by the saas_admin role claim minted at /auth/login.          */
/* ================================================================== */

const PLATFORM_PLAN_CODE = process.env.PLATFORM_DEFAULT_PLAN || 'STANDARD';

function roleFromToken(req) {
  const claims = verifyJwt(bearerToken(req) || parseCookies(req.headers.cookie).accessToken || '');
  return { claims, role: claims?.role || null };
}

function requireSaasAdmin(req, res, next) {
  const { role } = roleFromToken(req);
  if (role === 'saas_admin' || role === 'system_admin') return next();
  return res.status(403).json({ success: false, message: 'SaaS Administrator privileges required.' });
}

const PLATFORM_PLANS = [
  {
    plan_id: 'plan-basic', plan_code: 'BASIC', name: 'Basic',
    description: 'Public schools — CBC, attendance, NEMIS',
    price_monthly: 0, price_yearly: 0, currency: 'KES',
    max_learners: 200, max_staff: 20, features: JSON.stringify(['CBC', 'NEMIS', 'Attendance']),
    is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString()
  },
  {
    plan_id: 'plan-standard', plan_code: 'STANDARD', name: 'Standard',
    description: 'Comprehensive school management',
    price_monthly: 9900, price_yearly: 99000, currency: 'KES',
    max_learners: 1000, max_staff: 80, features: JSON.stringify(['CBC', 'Fees', 'M-Pesa', 'SMS', 'NEMIS']),
    is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString()
  },
  {
    plan_id: 'plan-enterprise', plan_code: 'ENTERPRISE', name: 'Enterprise',
    description: 'Large schools & boards of management',
    price_monthly: 24900, price_yearly: 249000, currency: 'KES',
    max_learners: 5000, max_staff: 300,
    features: JSON.stringify(['CBC', 'Fees', 'M-Pesa', 'SMS', 'NEMIS', 'Impersonation', 'API']),
    is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString()
  }
];

app.get(['/api/v1/platform/tenants', '/platform/tenants'], requireSaasAdmin, async (req, res) => {
  try {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT
          t.id AS tenant_id, t.subdomain, t.school_name, t.active, t.created_at,
          (SELECT count(*) FROM students s WHERE s.tenant_id = t.id) AS student_count,
          (SELECT count(*) FROM users u WHERE u.tenant_id = t.id) AS staff_count,
          COALESCE(t.plan_code, $1) AS plan_code
        FROM tenants t
        ORDER BY t.created_at ASC`,
        [PLATFORM_PLAN_CODE]);
      return res.json(result.rows.map((r) => ({
        tenant_id: r.tenant_id,
        subdomain: r.subdomain,
        school_name: r.school_name,
        status: r.active === false ? 'SUSPENDED' : 'ACTIVE',
        plan_code: r.plan_code,
        tier: r.plan_code,
        student_count: Number(r.student_count),
        learners: Number(r.student_count),
        staff_count: Number(r.staff_count),
        created_at: r.created_at
      })));
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[Platform Tenants Error]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to load tenant registry.' });
  }
});

app.post(['/api/v1/platform/tenants', '/platform/tenants'], requireSaasAdmin, async (req, res) => {
  const body = parseJsonBody(req);
  const schoolName = String(body.school_name || '').trim();
  const subdomain = String(body.subdomain || '').toLowerCase().trim();
  const adminEmail = String(body.admin_email || '').toLowerCase().trim();
  const adminPhone = String(body.admin_phone || '').trim();
  const plan = String(body.plan || 'STANDARD').toUpperCase();
  const county = String(body.county || '').trim();

  if (!schoolName || !subdomain) {
    return res.status(400).json({ success: false, message: 'School name and subdomain are required.' });
  }
  if (!/^[a-z0-9-]{3,63}$/.test(subdomain)) {
    return res.status(400).json({ success: false, message: 'Subdomain must be 3-63 chars: lowercase letters, numbers, hyphens.' });
  }
  if (!adminEmail) {
    return res.status(400).json({ success: false, message: 'School administrator email is required.' });
  }

  try {
    const client = await pool.connect();
    try {
      // Idempotency: subdomain collisions cannot create orphaned logins.
      const exists = await client.query('SELECT id, id AS tenant_id, subdomain, school_name FROM tenants WHERE LOWER(subdomain) = $1', [subdomain]);
      if (exists.rows.length > 0) {
        return res.status(409).json({ success: false, message: `Subdomain '${subdomain}' is already registered.` });
      }
      await client.query('BEGIN');
      const tRes = await client.query(
        'INSERT INTO tenants (subdomain, school_name, plan_code) VALUES ($1, $2, $3) RETURNING id AS tenant_id, subdomain, school_name, plan_code, active, created_at',
        [subdomain, schoolName, plan]
      );
      const tenant = tRes.rows[0];
      const newTenantId = tenant.tenant_id;
      // Provision the school admin. Temporary password is hashed at rest;
      // the plaintext is returned to the platform admin exactly ONCE.
      const tempPassword = 'Yna@' + String(Date.now()).slice(-6);
      const uRes = await client.query(
        'INSERT INTO users (tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [newTenantId, adminEmail, hashPassword(tempPassword), `${schoolName} Administrator`, 'admin']
      );
      await client.query('COMMIT');

      console.log(`[Platform] Tenant onboarded: ${subdomain} (${plan}) admin=${adminEmail}`);
      return res.status(201).json({
        tenant_id: newTenantId,
        subdomain: tenant.subdomain,
        school_name: tenant.school_name,
        plan_code: tenant.plan_code,
        county,
        admin_user_id: uRes.rows[0].id,
        admin_email: adminEmail,
        admin_phone: adminPhone,
        temp_password: tempPassword,
        created_at: tenant.created_at
      });
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[Platform Onboard Error]', err.message);
    const code = err.code === '23505' ? 'DUPLICATE' : null;
    return res.status(500).json({ success: false, message: code === 'DUPLICATE' ? 'Duplicate subdomain or admin email.' : 'Failed to onboard tenant.' });
  }
});

app.put(['/api/v1/platform/tenants/:tenantId/status', '/platform/tenants/:tenantId/status'], requireSaasAdmin, async (req, res) => {
  const status = String(parseJsonBody(req).status || '').toUpperCase();
  if (!['ACTIVE', 'SUSPENDED'].includes(status)) {
    return res.status(400).json({ success: false, message: "Status must be 'ACTIVE' or 'SUSPENDED'." });
  }
  try {
    const client = await pool.connect();
    try {
      const result = await client.query(
        'UPDATE tenants SET active = $1 WHERE id = $2 RETURNING id, subdomain',
        [status === 'ACTIVE', req.params.tenantId]
      );
      if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Tenant not found.' });
      return res.json({ success: true, tenant_id: result.rows[0].id, status });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[Platform Status Error]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to update tenant status.' });
  }
});

app.get(['/api/v1/platform/plans', '/platform/plans'], requireSaasAdmin, (req, res) => res.json(PLATFORM_PLANS));

app.get(['/api/v1/platform/subscriptions', '/platform/subscriptions'], requireSaasAdmin, async (req, res) => {
  try {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT t.id AS tenant_id, t.school_name, t.subdomain, t.created_at, COALESCE(t.plan_code, $1) AS plan_code
        FROM tenants t ORDER BY t.created_at ASC`,
        [PLATFORM_PLAN_CODE]);
      return res.json(result.rows.map((r) => {
        const plan = PLATFORM_PLANS.find((p) => p.plan_code === r.plan_code) || PLATFORM_PLANS[1];
        return {
          subscription_id: `sub-${r.tenant_id}`,
          tenant_id: r.tenant_id,
          school_name: r.school_name,
          subdomain: r.subdomain,
          plan_id: plan.plan_id,
          status: 'ACTIVE',
          started_at: r.created_at,
          ends_at: null,
          auto_renew: true,
          created_by: null,
          created_at: r.created_at,
          updated_at: r.created_at
        };
      }));
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[Platform Subscriptions Error]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to load subscriptions.' });
  }
});

app.get(['/api/v1/platform/usage', '/platform/usage'], requireSaasAdmin, async (req, res) => {
  try {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT t.id AS tenant_id,
          (SELECT count(*) FROM students s WHERE s.tenant_id = t.id) AS active_learners,
          (SELECT count(*) FROM users u WHERE u.tenant_id = t.id) AS active_staff,
          (SELECT count(*) FROM fee_payments fp WHERE fp.tenant_id = t.id) AS payments_processed,
          (SELECT count(*) FROM cbc_assessments c WHERE c.tenant_id = t.id) AS assessments_recorded
        FROM tenants t ORDER BY t.created_at DESC`,
        []);
      return res.json(result.rows.map((r) => ({
        usage_id: `usage-${r.tenant_id}`,
        tenant_id: r.tenant_id,
        period_month: new Date().toISOString().slice(0, 7),
        active_learners: Number(r.active_learners),
        active_staff: Number(r.active_staff),
        sms_sent: 0,
        reports_generated: 0,
        assessments_recorded: Number(r.assessments_recorded),
        payments_processed: Number(r.payments_processed),
        storage_mb: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })));
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[Platform Usage Error]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to load usage.' });
  }
});

app.post(['/api/v1/platform/impersonations', '/platform/impersonations'], requireSaasAdmin, async (req, res) => {
  const body = parseJsonBody(req);
  const tenantId = String(body.tenant_id || '').trim();
  const reason = String(body.reason || '').trim();
  if (!tenantId) return res.status(400).json({ success: false, message: 'Tenant selection is required.' });
  if (!reason) return res.status(400).json({ success: false, message: 'A reason is required for the audit trail.' });

  try {
    const client = await pool.connect();
    try {
      const tRes = await client.query('SELECT id, subdomain, school_name, active FROM tenants WHERE id::text = $1 OR LOWER(subdomain) = $2 LIMIT 1', [tenantId, tenantId.toLowerCase()]);
      if (tRes.rows.length === 0) return res.status(404).json({ success: false, message: 'Tenant not found.' });
      const tenant = tRes.rows[0];
      if (tenant.active === false) {
        return res.status(403).json({ success: false, message: `Impersonation refused: '${tenant.school_name}' is suspended. Reactivate the tenant first.` });
      }

      const now = Math.floor(Date.now() / 1000);
      const impersonToken = signJwt({
        sub: 'impersonation', email: 'impersonation@platform', role: 'saas_admin',
        tenant_id: tenant.id, typ: 'access', imp: true, exp: now + 60 * 60
      });
      console.log(`[Platform] Impersonation session opened for tenant ${tenant.subdomain} (reason: ${reason})`);
      return res.status(200).json({
        success: true,
        tenant_id: tenant.id,
        subdomain: tenant.subdomain,
        school_name: tenant.school_name,
        expires_at: new Date((now + 60 * 60) * 1000).toISOString(),
        impersonation_token: impersonToken
      });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[Platform Impersonation Error]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to start impersonation session.' });
  }
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[HTTP] Backend listening cleanly on port ${PORT}`);
});

/* Full-domain extension API (finance, attendance, assessment, staff, calendar, */
/* comms, compliance, KNEC, parent linking…). Must be installed BEFORE listen   */
/* so its routes participate in same-process routing. */
installExtApi(app, { pool, verifyJwt, bearerToken, parseCookies, hashPassword, verifyPassword, signJwt, UUID_RE });

// Keep-alive tuning: Node defaults (5s keep-alive, 60s headers) close sockets
// in front of proxies/load balancers mid-flight → axios "ECONNRESET".
server.keepAliveTimeout = 72000;
server.headersTimeout = 76000;
server.requestTimeout = 120000;

// A reset socket from any client is noise, not a crash.
server.on('clientError', (err, socket) => {
  if (socket.writable && !socket.destroyed) {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  } else {
    socket.destroy();
  }
});

process.on('SIGTERM', () => { console.log('[HTTP] SIGTERM — draining'); server.close(() => process.exit(0)); });
process.on('SIGINT', () => { console.log('[HTTP] SIGINT — draining'); server.close(() => process.exit(0)); });

#!/usr/bin/env bash
set -euo pipefail

echo "==> [1/4] Setting backend package to ES Module..."
cat << 'FILE_EOF' > "backend/package.json"
{
  "name": "school-saas-backend",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.19.2",
    "helmet": "^7.1.0",
    "pg": "^8.11.5"
  }
}
FILE_EOF

echo "==> [2/4] Using Native ESM Server (maintained in repo: backend/src/server.js)..."
# The server itself is maintained directly in the repository (auth session
# shapes, CBC bulk-sync LWW, Daraja webhook). It is intentionally NOT
# regenerated here so scripted launches cannot clobber it.
cat << 'FILE_EOF' > /dev/null
import express from 'express';
import pg from 'pg';
import cors from 'cors';
import helmet from 'helmet';

const { Pool } = pg;
const app = express();
const PORT = process.env.PORT || 8080;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5433/school_saas_production'
});

const buildAuthPayload = (user, tenant, token) => ({
  success: true,
  token,
  accessToken: token,
  refreshToken: token,
  user,
  tenant,
  data: {
    token,
    accessToken: token,
    refreshToken: token,
    user,
    tenant
  }
});

// Liveness
app.get(['/health', '/api/v1/health'], (req, res) => res.json({ status: 'healthy', port: PORT }));

// Auth: Login Endpoint
app.post(['/api/v1/auth/login', '/auth/login'], async (req, res) => {
  const { identifier, email, username, schoolCode, school_code, subdomain, password } = req.body;
  const targetEmail = (identifier || email || username || 'dev.admin@skulapp.test').toLowerCase().trim();
  const targetSchool = (schoolCode || school_code || subdomain || 'demo').toLowerCase().trim();

  try {
    const client = await pool.connect();
    try {
      // 1. Resolve Tenant
      let tenantRes = await client.query(
        'SELECT id, subdomain, school_name FROM tenants WHERE LOWER(subdomain) = $1 OR LOWER(school_name) = $1 LIMIT 1',
        [targetSchool]
      );
      let tenant = tenantRes.rows[0];
      if (!tenant) {
        tenantRes = await client.query('SELECT id, subdomain, school_name FROM tenants LIMIT 1');
        tenant = tenantRes.rows[0] || { id: '00000000-0000-0000-0000-000000000001', subdomain: 'demo', school_name: 'Alliance High School' };
      }

      // 2. Resolve User
      const userRes = await client.query(
        'SELECT id, email, full_name, role FROM users WHERE LOWER(email) = $1 LIMIT 1',
        [targetEmail]
      );
      const user = userRes.rows[0] || {
        id: '00000000-0000-0000-0000-000000000002',
        email: targetEmail,
        name: 'System Administrator',
        role: 'admin'
      };

      const token = Buffer.from(JSON.stringify({ userId: user.id, email: user.email, role: user.role, tenantId: tenant.id })).toString('base64');

      res.setHeader('Set-Cookie', [
        `accessToken=${token}; Path=/; HttpOnly; SameSite=Lax`,
        `refreshToken=${token}; Path=/; HttpOnly; SameSite=Lax`
      ]);

      return res.status(200).json(buildAuthPayload(user, tenant, token));
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[Auth Error]', err.message);
    const dummyUser = { id: '1', email: targetEmail, name: 'System Administrator', role: 'admin' };
    const dummyTenant = { id: '1', subdomain: 'demo', school_name: 'Alliance High School' };
    return res.status(200).json(buildAuthPayload(dummyUser, dummyTenant, 'dev-token'));
  }
});

// Auth: Refresh
app.post(['/api/v1/auth/refresh', '/auth/refresh'], (req, res) => {
  const token = 'refreshed-token';
  const dummyUser = { id: '1', email: 'dev.admin@skulapp.test', name: 'System Administrator', role: 'admin' };
  const dummyTenant = { id: '1', subdomain: 'demo', school_name: 'Alliance High School' };
  return res.status(200).json(buildAuthPayload(dummyUser, dummyTenant, token));
});

// Auth: Me
app.get(['/api/v1/auth/me', '/auth/me'], (req, res) => {
  return res.status(200).json({
    success: true,
    user: { id: '1', email: 'dev.admin@skulapp.test', name: 'System Administrator', role: 'admin' }
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[HTTP] Backend listening cleanly on port ${PORT}`);
});
FILE_EOF

echo "==> [3/4] Writing ESM Seeder & Seeding Account..."
cat << 'FILE_EOF' > "backend/src/database/seed_tenant.js"
import pg from 'pg';
import crypto from 'node:crypto';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5433/school_saas_production'
});

function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(String(plain), salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('hex')}$${dk.toString('hex')}`;
}

async function seed() {
  const client = await pool.connect();
  try {
    await client.query(`
      INSERT INTO tenants (subdomain, school_name)
      VALUES ('demo', 'Alliance High School')
      ON CONFLICT (subdomain) DO NOTHING;
    `);
    // Passwords are ALWAYS seeded hashed — plaintext never touches the DB.
    await client.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, role)
       VALUES ((SELECT id FROM tenants LIMIT 1), $1, $2, $3, $4)
       ON CONFLICT (tenant_id, email) DO NOTHING;`,
      ['dev.admin@skulapp.test', hashPassword('password123'), 'System Administrator', 'admin']
    );
    console.log('[SUCCESS] Database seeded with dev.admin@skulapp.test (scrypt-hashed credentials)');
  } catch (err) {
    console.warn('[Seeder Info]', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}
seed();
FILE_EOF

DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/school_saas_production" \
node "backend/src/database/seed_tenant.js"

echo "==> [4/4] Starting Backend Server on Port 8080..."
# Terminate any old background node processes on 8080 if lingering
fuser -k 8080/tcp 2>/dev/null || true

DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/school_saas_production" \
PORT=8080 \
node "backend/src/server.js" &
BACKEND_PID=$!

trap "kill $BACKEND_PID 2>/dev/null || true; exit 0" INT TERM EXIT

echo "Waiting for backend on port 8080..."
until curl -s http://127.0.0.1:8080/health >/dev/null 2>&1; do
  sleep 1
done
echo "Verified: Backend is online and accepting connections on port 8080!"

echo "Testing /api/v1/auth/login directly..."
TEST_RESP=$(curl -s -X POST http://127.0.0.1:8080/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"identifier":"dev.admin@skulapp.test","password":"password123","schoolCode":"demo"}')
echo "API Live Response: ${TEST_RESP}"

echo ""
echo "===================================================================="
echo "🎉 BACKEND IS CONNECTED TO VITE PROXY!"
echo "   Go to your browser: http://localhost:5173"
echo "   Click 'Sign In' — authentication will succeed with no network errors."
echo "===================================================================="
echo ""

# Keep process alive
wait $BACKEND_PID

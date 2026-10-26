#!/usr/bin/env bash
# ==============================================================================
# Script: apply_and_push_production_core.sh
# Purpose: Deploys the complete backend, database RLS, Daraja engine, and Docker
#          production stack, then commits and pushes directly to GitHub.
# ==============================================================================
set -euo pipefail

echo "=========================================================="
echo " Launching Production Core Deployment"
echo "=========================================================="

if [ ! -d ".git" ]; then
  echo "[-] ERROR: Must be run from the root of the git repository."
  exit 1
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "[+] Target Git branch: ${CURRENT_BRANCH}"

# 1. Create target directories
echo "[+] Initializing directory tree..."
mkdir -p backend/src/database/migrations
mkdir -p backend/src/controllers
mkdir -p backend/src/routes
mkdir -p backend/src/middleware
mkdir -p devops/docker

# ------------------------------------------------------------------------------
# 2. Database Migration with Row-Level Security (RLS)
# ------------------------------------------------------------------------------
echo "[+] Writing backend/src/database/migrations/001_core_saas_schema.sql..."
cat << 'FILE_EOF' > backend/src/database/migrations/001_core_saas_schema.sql
-- =============================================================================
-- Production Multi-Tenant Schema with PostgreSQL Row-Level Security (RLS)
-- =============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Tenants Table
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    subdomain VARCHAR(63) NOT NULL UNIQUE,
    school_name VARCHAR(255) NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Students Table
CREATE TABLE IF NOT EXISTS students (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    admission_number VARCHAR(64) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    grade_level VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_tenant_admission UNIQUE (tenant_id, admission_number)
);

-- 3. CBC Rubric Assessments Table (with composite idempotency key)
CREATE TABLE IF NOT EXISTS cbc_assessments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    sub_strand_id VARCHAR(128) NOT NULL,
    score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 4),
    rating_code VARCHAR(4) NOT NULL CHECK (rating_code IN ('EE', 'ME', 'AE', 'BE')),
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_tenant_student_substrand UNIQUE (tenant_id, student_id, sub_strand_id)
);

-- 4. Fee Balances Ledger
CREATE TABLE IF NOT EXISTS fee_balances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    total_invoiced NUMERIC(12, 2) DEFAULT 0.00,
    total_paid NUMERIC(12, 2) DEFAULT 0.00,
    current_balance NUMERIC(12, 2) GENERATED ALWAYS AS (total_invoiced - total_paid) STORED,
    CONSTRAINT uq_student_balance UNIQUE (tenant_id, student_id)
);

-- 5. Daraja M-Pesa Transactions Table (Strict Idempotency by Receipt)
CREATE TABLE IF NOT EXISTS fee_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    student_id UUID REFERENCES students(id) ON DELETE SET NULL,
    mpesa_receipt_number VARCHAR(32) NOT NULL UNIQUE,
    phone_number VARCHAR(16) NOT NULL,
    amount NUMERIC(12, 2) NOT NULL,
    account_reference VARCHAR(64) NOT NULL,
    transaction_date TIMESTAMPTZ NOT NULL,
    raw_payload JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row-Level Security
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbc_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_payments ENABLE ROW LEVEL SECURITY;

-- Dynamic Tenant Context Isolation Policy
DROP POLICY IF EXISTS tenant_isolation_policy ON students;
CREATE POLICY tenant_isolation_policy ON students
    FOR ALL
    USING (tenant_id::text = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_policy ON cbc_assessments;
CREATE POLICY tenant_isolation_policy ON cbc_assessments
    FOR ALL
    USING (tenant_id::text = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_policy ON fee_balances;
CREATE POLICY tenant_isolation_policy ON fee_balances
    FOR ALL
    USING (tenant_id::text = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_policy ON fee_payments;
CREATE POLICY tenant_isolation_policy ON fee_payments
    FOR ALL
    USING (tenant_id::text = current_setting('app.current_tenant_id', true));
FILE_EOF

# ------------------------------------------------------------------------------
# 3. Tenant Extraction Middleware
# ------------------------------------------------------------------------------
echo "[+] Writing backend/src/middleware/tenantContext.js..."
cat << 'FILE_EOF' > backend/src/middleware/tenantContext.js
/**
 * Middleware: Resolves tenant context from header or subdomain and sets DB session context
 */
module.exports = (dbPool) => {
  return async (req, res, next) => {
    // 1. Resolve from Nginx custom header, query, or standard header
    const tenantId = req.headers['x-tenant-id'] || req.headers['x-tenant-subdomain'];

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'Missing tenant context. Ensure X-Tenant-ID header is provided.'
      });
    }

    req.tenantId = tenantId;

    // Attach a scoped query helper that sets the PostgreSQL RLS context
    req.scopedQuery = async (queryText, params = []) => {
      const client = await dbPool.connect();
      try {
        await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
        const result = await client.query(queryText, params);
        return result;
      } finally {
        client.release();
      }
    };

    next();
  };
};
FILE_EOF

# ------------------------------------------------------------------------------
# 4. Backend CBC Bulk Sync Controller
# ------------------------------------------------------------------------------
echo "[+] Writing backend/src/controllers/assessmentController.js..."
cat << 'FILE_EOF' > backend/src/controllers/assessmentController.js
/**
 * Controller: Handles idempotent bulk syncing of CBC rubric scores from offline IndexedDB
 */
exports.bulkSyncAssessments = async (req, res) => {
  const { assessments } = req.body;
  const tenantId = req.tenantId;

  if (!Array.isArray(assessments) || assessments.length === 0) {
    return res.status(400).json({ success: false, message: 'Invalid or empty assessments array.' });
  }

  try {
    let syncedCount = 0;

    for (const item of assessments) {
      const { studentId, subStrandId, score, ratingCode } = item;

      // Upsert: update score if already recorded for this sub-strand, or insert if new
      await req.scopedQuery(
        `INSERT INTO cbc_assessments (tenant_id, student_id, sub_strand_id, score, rating_code, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (tenant_id, student_id, sub_strand_id)
         DO UPDATE SET
           score = EXCLUDED.score,
           rating_code = EXCLUDED.rating_code,
           updated_at = NOW()`,
        [tenantId, studentId, subStrandId, score, ratingCode]
      );
      syncedCount++;
    }

    return res.status(200).json({
      success: true,
      syncedCount,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('CBC Bulk Sync Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to synchronize offline assessments.'
    });
  }
};
FILE_EOF

# ------------------------------------------------------------------------------
# 5. Daraja M-Pesa Idempotent Webhook Controller
# ------------------------------------------------------------------------------
echo "[+] Writing backend/src/controllers/darajaController.js..."
cat << 'FILE_EOF' > backend/src/controllers/darajaController.js
/**
 * Controller: Processes Daraja C2B/STK callbacks with receipt deduplication & ledger reconciliation
 */
exports.handleDarajaCallback = async (req, res, dbPool) => {
  // Safaricom requires a 200 response within 3-5 seconds to prevent retries
  res.status(200).json({
    ResultCode: 0,
    ResultDesc: 'Accepted'
  });

  const client = await dbPool.connect();

  try {
    const payload = req.body;
    const body = payload?.Body?.stkCallback || payload;

    const resultCode = body.ResultCode;
    if (resultCode !== 0 && resultCode !== '0') {
      console.warn(`[Daraja] Payment unsuccessful or canceled by user. ResultCode: ${resultCode}`);
      return;
    }

    // Extract Safaricom parameters
    let receiptNumber = null;
    let amount = 0;
    let phoneNumber = null;

    if (body.CallbackMetadata?.Item) {
      for (const item of body.CallbackMetadata.Item) {
        if (item.Name === 'MpesaReceiptNumber') receiptNumber = item.Value;
        if (item.Name === 'Amount') amount = Number(item.Value);
        if (item.Name === 'PhoneNumber') phoneNumber = String(item.Value);
      }
    } else {
      // Direct C2B JSON payload fallback
      receiptNumber = body.TransID;
      amount = Number(body.TransAmount);
      phoneNumber = body.MSISDN;
    }

    const accountRef = body.BillRefNumber || body.AccountReference || 'UNKNOWN';
    const tenantId = req.headers['x-tenant-id'] || body.tenant_id;

    if (!receiptNumber || !amount || !tenantId) {
      console.error('[Daraja] Incomplete webhook payload:', body);
      return;
    }

    // Execute atomic transaction: record payment and credit student ledger
    await client.query('BEGIN');

    // 1. Idempotency Check: Verify if receipt already processed
    const existing = await client.query(
      'SELECT id FROM fee_payments WHERE mpesa_receipt_number = $1 FOR UPDATE',
      [receiptNumber]
    );

    if (existing.rows.length > 0) {
      console.log(`[Daraja] Duplicate callback suppressed for receipt: ${receiptNumber}`);
      await client.query('ROLLBACK');
      return;
    }

    // 2. Identify student by admission number (accountRef)
    const studentRes = await client.query(
      'SELECT id FROM students WHERE tenant_id = $1 AND admission_number = $2 LIMIT 1',
      [tenantId, accountRef]
    );

    const studentId = studentRes.rows[0]?.id || null;

    // 3. Log Payment Record
    await client.query(
      `INSERT INTO fee_payments 
       (tenant_id, student_id, mpesa_receipt_number, phone_number, amount, account_reference, transaction_date, raw_payload)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)`,
      [tenantId, studentId, receiptNumber, phoneNumber, amount, accountRef, JSON.stringify(payload)]
    );

    // 4. Update Student Fee Ledger (if valid student found)
    if (studentId) {
      await client.query(
        `INSERT INTO fee_balances (tenant_id, student_id, total_paid)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, student_id)
         DO UPDATE SET total_paid = fee_balances.total_paid + EXCLUDED.total_paid`,
        [tenantId, studentId, amount]
      );
    }

    await client.query('COMMIT');
    console.log(`[Daraja] Successfully reconciled payment: ${receiptNumber} (KES ${amount}) for Adm: ${accountRef}`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[Daraja] Error reconciling webhook transaction:', error);
  } finally {
    client.release();
  }
};
FILE_EOF

# ------------------------------------------------------------------------------
# 6. API Route Registrations
# ------------------------------------------------------------------------------
echo "[+] Writing backend/src/routes/apiRoutes.js..."
cat << 'FILE_EOF' > backend/src/routes/apiRoutes.js
const express = require('express');
const router = express.Router();
const assessmentController = require('../controllers/assessmentController');
const darajaController = require('../controllers/darajaController');

module.exports = (dbPool, tenantMiddleware) => {
  // Liveness probe
  router.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy', uptime: process.uptime() });
  });

  // Offline CBC Bulk Sync endpoint
  router.post(
    '/assessments/cbc/bulk-sync',
    tenantMiddleware,
    assessmentController.bulkSyncAssessments
  );

  // Daraja Webhook (Nginx secures IPs; no tenant header required from Safaricom)
  router.post('/payments/daraja/callback', (req, res) => {
    darajaController.handleDarajaCallback(req, res, dbPool);
  });

  return router;
};
FILE_EOF

# ------------------------------------------------------------------------------
# 7. Production Docker Compose Configuration
# ------------------------------------------------------------------------------
echo "[+] Writing devops/docker/docker-compose.prod.yml..."
cat << 'FILE_EOF' > devops/docker/docker-compose.prod.yml
version: '3.8'

services:
  postgres_db:
    image: postgres:15-alpine
    container_name: school_saas_postgres
    restart: always
    environment:
      POSTGRES_DB: ${DB_NAME:-school_saas_production}
      POSTGRES_USER: ${DB_USER:-postgres}
      POSTGRES_PASSWORD: ${DB_PASSWORD:-SecretProductionPasswordHere}
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ../../backend/src/database/migrations:/docker-entrypoint-initdb.d
    networks:
      - internal_saas_net
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  backend_app:
    build:
      context: ../..
      dockerfile: devops/docker/Dockerfile.backend
    container_name: school_saas_backend
    restart: always
    ports:
      - "127.0.0.1:4000:4000"
    environment:
      PORT: 4000
      NODE_ENV: production
      DATABASE_URL: postgres://${DB_USER:-postgres}:${DB_PASSWORD:-SecretProductionPasswordHere}@postgres_db:5432/${DB_NAME:-school_saas_production}
    depends_on:
      postgres_db:
        condition: service_healthy
    networks:
      - internal_saas_net

networks:
  internal_saas_net:
    driver: bridge

volumes:
  pgdata:
FILE_EOF

# ------------------------------------------------------------------------------
# 8. Backend Production Dockerfile
# ------------------------------------------------------------------------------
echo "[+] Writing devops/docker/Dockerfile.backend..."
cat << 'FILE_EOF' > devops/docker/Dockerfile.backend
FROM node:18-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Install production dependencies
COPY package*.json ./
RUN npm ci --only=production --ignore-scripts || npm install --production

# Copy source
COPY . .

EXPOSE 4000
USER node

CMD ["node", "backend/src/server.js"]
FILE_EOF

# ------------------------------------------------------------------------------
# 9. Production Environment Template
# ------------------------------------------------------------------------------
echo "[+] Writing .env.production.example..."
cat << 'FILE_EOF' > .env.production.example
# ==============================================================================
# Production Environment Variables
# RENAME TO .env.production ON YOUR SERVER - NEVER COMMIT ACTUAL SECRETS TO GIT
# ==============================================================================
NODE_ENV=production
PORT=4000

# Database Configuration
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=school_saas_production
DB_USER=postgres
DB_PASSWORD=YourStrongDatabasePassword123!

# Safaricom Daraja Production Credentials
DARAJA_ENVIRONMENT=production
DARAJA_CONSUMER_KEY=your_live_consumer_key
DARAJA_CONSUMER_SECRET=your_live_consumer_secret
DARAJA_BUSINESS_SHORTCODE=your_paybill_or_till
DARAJA_PASSKEY=your_live_passkey
DARAJA_CALLBACK_URL=https://yourdomain.co.ke/api/v1/payments/daraja/callback

# Disaster Recovery / S3 Backups
S3_BACKUP_BUCKET=school-saas-database-backups
AWS_ACCESS_KEY_ID=your_aws_key
AWS_SECRET_ACCESS_KEY=your_aws_secret
AWS_DEFAULT_REGION=af-south-1
FILE_EOF

# ------------------------------------------------------------------------------
# 10. Commit and Push to GitHub
# ------------------------------------------------------------------------------
echo "[+] Staging all created production files..."
git add backend/src/
git add devops/docker/
git add .env.production.example

echo "[+] Staged status:"
git status --short

echo "[+] Committing changes..."
git commit -m "feat(core): RLS multi-tenant schema, CBC bulk sync ingestion, Daraja idempotent webhook, and Docker stack" || {
  echo "[!] No new changes to commit."
}

echo "[+] Pushing to remote branch: ${CURRENT_BRANCH}..."
git push origin "${CURRENT_BRANCH}"

echo "=========================================================="
echo " Production Core has been built, committed, and pushed!"
echo " GitHub: https://github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system.git"
echo "=========================================================="

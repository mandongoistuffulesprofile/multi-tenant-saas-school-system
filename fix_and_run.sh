#!/usr/bin/env bash
# ==============================================================================
# Self-Contained Fix & Dev Runner (Handles spaces in folder paths & missing files)
# ==============================================================================
set -euo pipefail

PROJECT_DIR="$(pwd)"
echo "==> Working in: ${PROJECT_DIR}"

# 1. Ensure all directories exist
mkdir -p "backend/src/database/migrations"
mkdir -p "backend/src/controllers"
mkdir -p "backend/src/routes"
mkdir -p "backend/src/middleware"
mkdir -p "backend/src/services"
mkdir -p "frontend/src/components"
mkdir -p "frontend/src/utils"
mkdir -p "frontend/src/services"

# 2. Write Database Migration SQL
echo "==> Creating database schema migration..."
cat << 'FILE_EOF' > "backend/src/database/migrations/001_core_saas_schema.sql"
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    subdomain VARCHAR(63) NOT NULL UNIQUE,
    school_name VARCHAR(255) NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS students (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    admission_number VARCHAR(64) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    grade_level VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_tenant_admission UNIQUE (tenant_id, admission_number)
);

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

CREATE TABLE IF NOT EXISTS fee_balances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    total_invoiced NUMERIC(12, 2) DEFAULT 0.00,
    total_paid NUMERIC(12, 2) DEFAULT 0.00,
    current_balance NUMERIC(12, 2) GENERATED ALWAYS AS (total_invoiced - total_paid) STORED,
    CONSTRAINT uq_student_balance UNIQUE (tenant_id, student_id)
);

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
FILE_EOF

# 3. Write Tenant Seeder Script
echo "==> Creating backend/src/database/seed_tenant.js..."
cat << 'FILE_EOF' > "backend/src/database/seed_tenant.js"
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/school_saas_production'
});

async function seed() {
  const subdomain = process.argv[2] || 'demo';
  const schoolName = process.argv[3] || 'Demo Academy Kenya';

  console.log(`[*] Seeding school: ${schoolName} (${subdomain})...`);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const tenantRes = await client.query(
      `INSERT INTO tenants (subdomain, school_name)
       VALUES ($1, $2)
       ON CONFLICT (subdomain) DO UPDATE SET school_name = EXCLUDED.school_name
       RETURNING id`,
      [subdomain, schoolName]
    );
    const tenantId = tenantRes.rows[0].id;

    const sampleStudents = [
      { adm: 'ADM-101', name: 'Achieng Otieno', grade: 'Grade 4' },
      { adm: 'ADM-102', name: 'Brian Kiprop', grade: 'Grade 4' },
      { adm: 'ADM-103', name: 'Faith Wanjiku', grade: 'Grade 4' },
      { adm: 'ADM-104', name: 'David Mutua', grade: 'Grade 4' }
    ];

    for (const student of sampleStudents) {
      const sRes = await client.query(
        `INSERT INTO students (tenant_id, admission_number, full_name, grade_level)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, admission_number) DO UPDATE SET full_name = EXCLUDED.full_name
         RETURNING id`,
        [tenantId, student.adm, student.name, student.grade]
      );
      const studentId = sRes.rows[0].id;

      await client.query(
        `INSERT INTO fee_balances (tenant_id, student_id, total_invoiced, total_paid)
         VALUES ($1, $2, 25000.00, 5000.00)
         ON CONFLICT (tenant_id, student_id) DO NOTHING`,
        [tenantId, studentId]
      );
    }

    await client.query('COMMIT');
    console.log(`[SUCCESS] Seeded 4 CBC students under tenant '${subdomain}' (ID: ${tenantId})`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[-] Seeder error:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
FILE_EOF

# 4. Ensure backend dependencies exist in root
echo "==> Ensuring required backend packages are installed..."
if [ ! -f "package.json" ]; then
  npm init -y >/dev/null 2>&1
fi

if [ ! -d "node_modules/pg" ] || [ ! -d "node_modules/express" ]; then
  echo "Installing express, pg, cors, helmet..."
  npm install --silent pg express cors helmet
fi

# 5. Start / Resume PostgreSQL Container
echo "==> Starting PostgreSQL container..."
docker run --name school_saas_dev_db \
  -e POSTGRES_DB=school_saas_production \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  -d postgres:15-alpine >/dev/null 2>&1 || docker start school_saas_dev_db >/dev/null

echo "Waiting for PostgreSQL database container to respond..."
until docker exec school_saas_dev_db pg_isready -U postgres >/dev/null 2>&1; do
  sleep 1
done
echo "PostgreSQL is ready."

# 6. Apply schema to database
echo "==> Applying SQL schema..."
docker exec -i school_saas_dev_db psql -U postgres -d school_saas_production \
  < "backend/src/database/migrations/001_core_saas_schema.sql" >/dev/null 2>&1 || true

# 7. Run Seeder
echo "==> Executing Seeder..."
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/school_saas_production" \
node "backend/src/database/seed_tenant.js" demo "Demo Academy Kenya"

# 8. Start Backend in Background
echo "==> Starting Backend API (port 4000)..."
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/school_saas_production" \
PORT=4000 \
node --watch "backend/src/server.js" &
BACKEND_PID=$!

trap "kill $BACKEND_PID 2>/dev/null || true; exit 0" INT TERM EXIT

echo ""
echo "===================================================================="
echo "🎉 BACKEND AND DATABASE ARE READY!"
echo "   API Health Check: http://localhost:4000/healthz"
echo "===================================================================="
echo ""

# 9. Start Frontend Dev Server
if [ -d "frontend" ]; then
  cd "frontend"
  if [ ! -d "node_modules" ] && [ -f "package.json" ]; then
    echo "Installing frontend dependencies..."
    npm install --silent
  fi
  echo "==> Launching Frontend..."
  npm run dev || npm start
else
  echo "Backend is running on http://localhost:4000. Press Ctrl+C to stop."
  wait $BACKEND_PID
fi

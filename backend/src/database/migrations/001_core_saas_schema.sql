CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Tenants Table
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    subdomain VARCHAR(63) NOT NULL UNIQUE,
    school_name VARCHAR(255) NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Users & Roles Table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role VARCHAR(32) NOT NULL CHECK (role IN ('admin', 'teacher', 'accountant', 'parent')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_tenant_user_email UNIQUE (tenant_id, email)
);

-- 3. Students Roster
CREATE TABLE IF NOT EXISTS students (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    admission_number VARCHAR(64) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    grade_level VARCHAR(32) NOT NULL,
    parent_email VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_tenant_admission UNIQUE (tenant_id, admission_number)
);

-- 4. CBC Rubric Assessments
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

-- 5. Student Fee Ledgers
CREATE TABLE IF NOT EXISTS fee_balances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    total_invoiced NUMERIC(12, 2) DEFAULT 0.00,
    total_paid NUMERIC(12, 2) DEFAULT 0.00,
    current_balance NUMERIC(12, 2) GENERATED ALWAYS AS (total_invoiced - total_paid) STORED,
    CONSTRAINT uq_student_balance UNIQUE (tenant_id, student_id)
);

-- 6. M-Pesa Daraja Transactions
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

-- Row-Level Security
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbc_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_policy ON users;
CREATE POLICY tenant_isolation_policy ON users FOR ALL
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_policy ON students;
CREATE POLICY tenant_isolation_policy ON students FOR ALL
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_policy ON cbc_assessments;
CREATE POLICY tenant_isolation_policy ON cbc_assessments FOR ALL
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_policy ON fee_balances;
CREATE POLICY tenant_isolation_policy ON fee_balances FOR ALL
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_policy ON fee_payments;
CREATE POLICY tenant_isolation_policy ON fee_payments FOR ALL
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

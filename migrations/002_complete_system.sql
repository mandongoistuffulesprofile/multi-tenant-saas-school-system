-- ============================================================================
-- FULL SYSTEM SCHEMA: MULTI-TENANCY, RLS, CBC, & FINANCIAL ALLOCATION
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "citext";

CREATE OR REPLACE FUNCTION current_tenant() RETURNS UUID AS $$
BEGIN
    RETURN NULLIF(current_setting('app.current_tenant_id', true), '')::UUID;
END;
$$ LANGUAGE plpgsql STABLE;

-- 1. TENANTS & RBAC USERS
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    subdomain VARCHAR(63) NOT NULL UNIQUE,
    shortcode VARCHAR(16) NOT NULL DEFAULT '',
    passkey TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email CITEXT NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(32) NOT NULL CHECK (role IN ('super_admin', 'school_admin', 'teacher', 'accountant', 'parent')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT users_tenant_email_key UNIQUE (tenant_id, email)
);
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_users ON users;
CREATE POLICY rls_users ON users USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant());

-- 2. ACADEMIC STRUCTURE & STUDENTS
CREATE TABLE IF NOT EXISTS academic_terms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(64) NOT NULL, -- e.g., '2026 Term 1'
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_current BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE academic_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE academic_terms FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_academic_terms ON academic_terms;
CREATE POLICY rls_academic_terms ON academic_terms USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant());

CREATE TABLE IF NOT EXISTS students (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    admission_number VARCHAR(64) NOT NULL,
    first_name VARCHAR(128) NOT NULL,
    last_name VARCHAR(128) NOT NULL,
    grade_level VARCHAR(32) NOT NULL, -- PP1, PP2, Grade 1 to Grade 9
    parent_phone VARCHAR(15) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT students_admission_key UNIQUE (tenant_id, admission_number)
);
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE students FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_students ON students;
CREATE POLICY rls_students ON students USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant());

-- 3. FINANCIAL ENGINE: INVOICES, DARAJA TRANSACTIONS, ALLOCATIONS
CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    term_id UUID NOT NULL REFERENCES academic_terms(id) ON DELETE RESTRICT,
    title VARCHAR(255) NOT NULL,
    total_cents BIGINT NOT NULL CHECK (total_cents >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_invoices ON invoices;
CREATE POLICY rls_invoices ON invoices USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant());

CREATE TABLE IF NOT EXISTS mpesa_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    trans_id VARCHAR(64) NOT NULL UNIQUE, -- Safaricom TransID (QX...)
    trans_time TIMESTAMPTZ NOT NULL,
    trans_amount_cents BIGINT NOT NULL CHECK (trans_amount_cents > 0),
    msisdn VARCHAR(15) NOT NULL,
    bill_ref_number VARCHAR(64) NOT NULL,
    raw_payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE mpesa_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mpesa_transactions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_mpesa_transactions ON mpesa_transactions;
CREATE POLICY rls_mpesa_transactions ON mpesa_transactions USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant());

CREATE TABLE IF NOT EXISTS fee_allocations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    mpesa_transaction_id UUID REFERENCES mpesa_transactions(id) ON DELETE RESTRICT,
    allocated_cents BIGINT NOT NULL CHECK (allocated_cents > 0),
    allocated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE fee_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_allocations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_fee_allocations ON fee_allocations;
CREATE POLICY rls_fee_allocations ON fee_allocations USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant());

-- 4. CBC CURRICULUM & ASSESSMENT EVENTS
CREATE TABLE IF NOT EXISTS cbc_assessment_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    learning_area VARCHAR(128) NOT NULL, -- e.g. 'Mathematics'
    strand VARCHAR(128) NOT NULL,
    sub_strand VARCHAR(128) NOT NULL,
    performance_level INT NOT NULL CHECK (performance_level BETWEEN 1 AND 4), -- 1:BE, 2:AE, 3:ME, 4:EE
    recorded_by UUID NOT NULL REFERENCES users(id),
    sync_id UUID NOT NULL DEFAULT uuid_generate_v4() UNIQUE,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE cbc_assessment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbc_assessment_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_cbc_assessment ON cbc_assessment_events;
CREATE POLICY rls_cbc_assessment ON cbc_assessment_events USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant());

-- 5. ANALYTICAL VIEWS
CREATE OR REPLACE VIEW v_student_fee_balances AS
SELECT 
    s.tenant_id,
    s.id AS student_id,
    s.admission_number,
    COALESCE(SUM(DISTINCT inv.total_cents), 0) AS total_invoiced_cents,
    COALESCE(SUM(alloc.allocated_cents), 0) AS total_paid_cents,
    COALESCE(SUM(DISTINCT inv.total_cents), 0) - COALESCE(SUM(alloc.allocated_cents), 0) AS balance_due_cents
FROM students s
LEFT JOIN invoices inv ON inv.student_id = s.id AND inv.tenant_id = s.tenant_id
LEFT JOIN fee_allocations alloc ON alloc.invoice_id = inv.id AND alloc.tenant_id = s.tenant_id
GROUP BY s.tenant_id, s.id, s.admission_number;

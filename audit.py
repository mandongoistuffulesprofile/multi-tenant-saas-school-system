#!/usr/bin/env python3
import os
import sys
import subprocess
import traceback

def create_file(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(content.strip() + "\n")
    print(f"  [+] Created: {path}")

def main():
    print("=" * 70)
    print(" KENYAN SAAS SCHOOL SYSTEM - AUDIT & PATCH RUNNER")
    print("=" * 70)

    # 1. Migration: migrations/slice0/001_foundation.sql
    migration_sql = """-- ============================================================================
-- SLICE 0: FOUNDATION SCHEMA WITH STRICT RLS & FINANCIAL IDEMPOTENCY
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "citext";

CREATE OR REPLACE FUNCTION current_tenant() RETURNS UUID AS $$
BEGIN
    RETURN NULLIF(current_setting('app.current_tenant_id', true), '')::UUID;
END;
$$ LANGUAGE plpgsql STABLE;

-- 1. Tenants (Schools)
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    subdomain VARCHAR(63) NOT NULL UNIQUE,
    curriculum VARCHAR(32) NOT NULL DEFAULT 'CBC',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Users & RBAC
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email CITEXT NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(32) NOT NULL CHECK (role IN ('super_admin', 'school_admin', 'teacher', 'accountant', 'parent')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT users_tenant_email_unique UNIQUE (tenant_id, email)
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_users ON users
    USING (tenant_id = current_tenant())
    WITH CHECK (tenant_id = current_tenant());

-- 3. Students
CREATE TABLE IF NOT EXISTS students (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    admission_number VARCHAR(64) NOT NULL,
    first_name VARCHAR(128) NOT NULL,
    last_name VARCHAR(128) NOT NULL,
    grade_level VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT students_tenant_admission_unique UNIQUE (tenant_id, admission_number)
);

ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE students FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_students ON students
    USING (tenant_id = current_tenant())
    WITH CHECK (tenant_id = current_tenant());

-- 4. Financial: Invoices (Immutable Billings)
CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    term VARCHAR(32) NOT NULL,
    total_amount_cents BIGINT NOT NULL CHECK (total_amount_cents >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_invoices ON invoices
    USING (tenant_id = current_tenant())
    WITH CHECK (tenant_id = current_tenant());

-- 5. Financial: M-Pesa Transactions (Strict Idempotency Table)
CREATE TABLE IF NOT EXISTS mpesa_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    trans_id VARCHAR(64) NOT NULL UNIQUE,
    trans_time TIMESTAMPTZ NOT NULL,
    trans_amount_cents BIGINT NOT NULL CHECK (trans_amount_cents > 0),
    msisdn VARCHAR(15) NOT NULL,
    bill_ref_number VARCHAR(64) NOT NULL,
    raw_payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE mpesa_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mpesa_transactions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_mpesa ON mpesa_transactions
    USING (tenant_id = current_tenant())
    WITH CHECK (tenant_id = current_tenant());

-- 6. Financial: Fee Allocations
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

CREATE POLICY tenant_isolation_fee_allocations ON fee_allocations
    USING (tenant_id = current_tenant())
    WITH CHECK (tenant_id = current_tenant());

-- 7. CBC Assessment Events (Event-Based History)
CREATE TABLE IF NOT EXISTS cbc_assessment_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    learning_area VARCHAR(128) NOT NULL,
    strand VARCHAR(128) NOT NULL,
    sub_strand VARCHAR(128) NOT NULL,
    performance_level INT NOT NULL CHECK (performance_level BETWEEN 1 AND 4),
    recorded_by UUID NOT NULL REFERENCES users(id),
    sync_id UUID NOT NULL DEFAULT uuid_generate_v4() UNIQUE,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE cbc_assessment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbc_assessment_events FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_cbc ON cbc_assessment_events
    USING (tenant_id = current_tenant())
    WITH CHECK (tenant_id = current_tenant());

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_students_tenant ON students(tenant_id);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant ON invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_mpesa_tenant ON mpesa_transactions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_allocations_tenant ON fee_allocations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cbc_tenant_student ON cbc_assessment_events(tenant_id, student_id);
"""

    # 2. Go Tenant Boundary: backend/internal/database/tenant_tx.go
    tenant_tx_go = """package database

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/google/uuid"
)

// WithTenantTx wraps DB queries in SET LOCAL app.current_tenant_id so connection pools never leak state
func WithTenantTx(ctx context.Context, db *sql.DB, tenantID uuid.UUID, fn func(tx *sql.Tx) error) error {
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}

	defer tx.Rollback()

	setQuery := fmt.Sprintf("SET LOCAL app.current_tenant_id = '%s'", tenantID.String())
	if _, err := tx.ExecContext(ctx, setQuery); err != nil {
		return fmt.Errorf("failed to set tenant context: %w", err)
	}

	if err := fn(tx); err != nil {
		return err
	}

	return tx.Commit()
}
"""

    # Write files
    print("\n--> Writing architectural files...")
    create_file("migrations/slice0/001_foundation.sql", migration_sql)
    create_file("backend/internal/database/tenant_tx.go", tenant_tx_go)

    print("\n--> Checking Git status...")
    try:
        subprocess.run(["git", "status", "--short"], check=True)
    except Exception as e:
        print(f"Git check skipped: {e}")

    print("\n" + "=" * 70)
    print("✔ ALL FILES GENERATED CLEANLY WITHOUT CRASHING")
    print("=" * 70)

if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("\n[!] An error occurred during execution:\n")
        traceback.print_exc()
    finally:
        # This keeps the terminal window open guaranteed
        input("\n>>> Execution finished. Press [Enter] to exit...")

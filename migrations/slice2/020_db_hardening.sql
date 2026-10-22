-- Migration 020: Database hardening (security + performance)
-- Creates least-privilege roles, forces RLS intent via non-owner app role,
-- adds pg_trgm search support, and composite/covering indexes for hot queries.
--
-- SECURITY MODEL
--   skulapp_migrator : owns schema objects, runs DDL (deploy-time only)
--   skulapp_writer   : app write role — INSERT/UPDATE/DELETE on tenant tables,
--                      SELECT on reference tables. NON-OWNER => RLS enforced.
--   skulapp_reader   : app read-only role — SELECT on all tables (analytics)
--   skulapp_app      : the role the API connects as (writer + reader grants)
--   The bootstrap user `skulapp` retains table ownership (migrator). The API
--   must NOT connect as `skulapp` (owners bypass RLS).

-- 1. Extension for trigram search on learner names / admission numbers.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Least-privilege roles (passwords must be rotated via secrets manager in prod).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skulapp_migrator') THEN
    CREATE ROLE skulapp_migrator LOGIN PASSWORD 'skulapp_migrator_change_in_prod';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skulapp_writer') THEN
    CREATE ROLE skulapp_writer LOGIN PASSWORD 'skulapp_writer_change_in_prod';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skulapp_reader') THEN
    CREATE ROLE skulapp_reader LOGIN PASSWORD 'skulapp_reader_change_in_prod';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skulapp_app') THEN
    CREATE ROLE skulapp_app LOGIN PASSWORD 'skulapp_app_change_in_prod';
  END IF;
END $$;

-- Migrator owns schema objects and bypasses RLS so DDL + seed data can run.
-- Granted only at deploy time; never used by application traffic.
ALTER ROLE skulapp_migrator BYPASSRLS;

-- 3. Database / schema access.
GRANT CONNECT ON DATABASE skulapp TO skulapp_app, skulapp_writer, skulapp_reader, skulapp_migrator;
GRANT USAGE ON SCHEMA public TO skulapp_app, skulapp_writer, skulapp_reader, skulapp_migrator;

-- 4. Role membership: app = writer + reader (single connection role for the API).
GRANT skulapp_writer TO skulapp_app;
GRANT skulapp_reader TO skulapp_app;

-- 5. Table privileges. App roles are non-owners so RLS policies are enforced.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO skulapp_writer;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO skulapp_reader;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO skulapp_writer, skulapp_reader;

-- Default privileges for tables created by the migrator going forward.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE TO skulapp_writer;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT TO skulapp_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO skulapp_writer, skulapp_reader;

-- 6. Reference (global) tables: app may read, only migrator writes via migrations.
--    (fee_categories, grades are seed reference data; app reads only.)
GRANT SELECT ON fee_categories TO skulapp_writer, skulapp_reader;
GRANT SELECT ON grades TO skulapp_writer, skulapp_reader;

-- 7. Composite / covering indexes for hot list queries.
--    learners: list by tenant + status, trigram search on name/admission.
CREATE INDEX IF NOT EXISTS idx_learners_tenant_status
  ON learners (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_learners_search_trgm
  ON learners USING gin (((first_name || ' ' || last_name) gin_trgm_ops));
CREATE INDEX IF NOT EXISTS idx_learners_admission_tenant
  ON learners (tenant_id, admission_number);

--    invoices: list by tenant ordered by created_at DESC (pagination).
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_created_desc
  ON invoices (tenant_id, created_at DESC);

--    invoice_lines: lookup by tenant + invoice (covering join).
CREATE INDEX IF NOT EXISTS idx_invoice_lines_tenant_invoice
  ON invoice_lines (tenant_id, invoice_id);

--    payments: list by tenant ordered by received_at DESC (pagination).
CREATE INDEX IF NOT EXISTS idx_payments_tenant_received_desc
  ON payments (tenant_id, received_at DESC);

--    mpesa_transactions: reconciliation list by tenant.
CREATE INDEX IF NOT EXISTS idx_mpesa_txns_tenant_created_desc
  ON mpesa_transactions (tenant_id, created_at DESC);

--    receipt_sequences: look up by tenant + period.
CREATE INDEX IF NOT EXISTS idx_receipt_sequences_tenant_period
  ON receipt_sequences (tenant_id, current_period);

--    fee_structures: list by tenant ordered by grade (join to fee_categories).
CREATE INDEX IF NOT EXISTS idx_fee_structures_tenant_grade
  ON fee_structures (tenant_id, grade_id);

--    covering index for allocation update path (invoice_id + tenant_id).
CREATE INDEX IF NOT EXISTS idx_invoices_id_tenant_amounts
  ON invoices (invoice_id, tenant_id)
  INCLUDE (amount_paid, amount_outstanding, status, updated_at);

-- 8. audit_events partitioned table: hot lookup by tenant within time window.
CREATE INDEX IF NOT EXISTS idx_audit_events_tenant_created
  ON audit_events (tenant_id, created_at);

-- 9. RLS is ENABLED on all tenant tables (see earlier migrations). App role
--    skulapp_app is a non-owner, so policies are enforced. FORCE ROW LEVEL
--    SECURITY is applied below (section 11) so owners are also subject to RLS;
--    skulapp_migrator holds BYPASSRLS so deploy/seed work continues to work.

-- 10. Grant the migrator ownership of tables it creates/maintains.
--     The bootstrap user `skulapp` currently owns all tables; it may transfer
--     ownership to skulapp_migrator during a supervised deploy.

-- 11. FORCE ROW LEVEL SECURITY on every tenant-scoped table.
--     Forces RLS to apply to table owners as well; skulapp_migrator holds
--     BYPASSRLS so migrations and seed inserts continue to work.
--     Application role skulapp_app is a non-owner, so RLS is always enforced.
ALTER TABLE schools FORCE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE devices FORCE ROW LEVEL SECURITY;
ALTER TABLE otp_challenges FORCE ROW LEVEL SECURITY;
ALTER TABLE guardian_claim_codes FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
ALTER TABLE outbox FORCE ROW LEVEL SECURITY;

ALTER TABLE school_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE school_payment_channels FORCE ROW LEVEL SECURITY;
ALTER TABLE school_finance_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE academic_years FORCE ROW LEVEL SECURITY;
ALTER TABLE terms FORCE ROW LEVEL SECURITY;
ALTER TABLE exam_windows FORCE ROW LEVEL SECURITY;
ALTER TABLE streams FORCE ROW LEVEL SECURITY;
ALTER TABLE class_groups FORCE ROW LEVEL SECURITY;
ALTER TABLE staff_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE teaching_assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE learners FORCE ROW LEVEL SECURITY;
ALTER TABLE guardians FORCE ROW LEVEL SECURITY;
ALTER TABLE learner_guardians FORCE ROW LEVEL SECURITY;
ALTER TABLE enrolments FORCE ROW LEVEL SECURITY;
ALTER TABLE learner_status_history FORCE ROW LEVEL SECURITY;
ALTER TABLE transfers FORCE ROW LEVEL SECURITY;
ALTER TABLE import_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE import_rows FORCE ROW LEVEL SECURITY;

ALTER TABLE fee_structures FORCE ROW LEVEL SECURITY;
ALTER TABLE learner_fee_options FORCE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
ALTER TABLE invoice_lines FORCE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;
ALTER TABLE payment_allocations FORCE ROW LEVEL SECURITY;
ALTER TABLE credits FORCE ROW LEVEL SECURITY;
ALTER TABLE adjustments FORCE ROW LEVEL SECURITY;
ALTER TABLE refunds FORCE ROW LEVEL SECURITY;
ALTER TABLE mpesa_transactions FORCE ROW LEVEL SECURITY;
ALTER TABLE mpesa_stk_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE receipt_sequences FORCE ROW LEVEL SECURITY;
ALTER TABLE capitation_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_runs FORCE ROW LEVEL SECURITY;

-- Global reference tables have no tenant_id and no RLS; not FORCED here:
--   fee_categories, grades

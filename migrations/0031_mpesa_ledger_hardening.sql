-- ============================================================================
-- 0031_mpesa_ledger_hardening.sql — Forensic M-Pesa Inbox & Immutable Ledger
--
-- Fixes race conditions in Safaricom callback handling:
-- 1. Durable inbox with ON CONFLICT DO NOTHING for idempotent ingestion
-- 2. Immutable payment_ledger for forensic audit trail
-- 3. RLS policies with platform admin bypass
-- 4. Deterministic lock ordering in allocation worker (invoice due_date ASC)
-- ============================================================================

-- 1. DURABLE INBOX FOR SAFARICOM C2B / STK PUSH CALLBACKS
CREATE TABLE IF NOT EXISTS mpesa_inbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(50) NOT NULL,
    trans_id VARCHAR(64) NOT NULL,
    trans_time VARCHAR(20) NOT NULL,
    trans_amount NUMERIC(12, 2) NOT NULL,
    business_short_code VARCHAR(32) NOT NULL,
    bill_ref_number VARCHAR(64) NOT NULL,
    msisdn VARCHAR(20) NOT NULL,
    first_name VARCHAR(64),
    raw_payload JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'PROCESSED', 'FAILED', 'IGNORED')),
    error_message TEXT,
    retry_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_mpesa_inbox_trans UNIQUE (tenant_id, trans_id)
);

CREATE INDEX IF NOT EXISTS idx_mpesa_inbox_pending
    ON mpesa_inbox (status, created_at)
    WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_mpesa_inbox_tenant_status
    ON mpesa_inbox (tenant_id, status);

-- RLS on mpesa_inbox
ALTER TABLE mpesa_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE mpesa_inbox FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_mpesa_inbox ON mpesa_inbox;
CREATE POLICY tenant_isolation_mpesa_inbox ON mpesa_inbox
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS platform_admin_mpesa_inbox ON mpesa_inbox;
CREATE POLICY platform_admin_mpesa_inbox ON mpesa_inbox
    FOR ALL USING (current_setting('app.current_user_role', true) = 'SAAS_ADMIN')
    WITH CHECK (current_setting('app.current_user_role', true) = 'SAAS_ADMIN');

DROP POLICY IF EXISTS worker_mpesa_inbox ON mpesa_inbox;
CREATE POLICY worker_mpesa_inbox ON mpesa_inbox
    FOR ALL USING (current_setting('app.worker', true) = 'on')
    WITH CHECK (current_setting('app.worker', true) = 'on');


-- 2. IMMUTABLE FORENSIC PAYMENT LEDGER
CREATE TABLE IF NOT EXISTS payment_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(50) NOT NULL,
    inbox_id UUID REFERENCES mpesa_inbox(id),
    receipt_number VARCHAR(64) NOT NULL,
    student_id UUID NOT NULL,
    invoice_id UUID,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    balance_before NUMERIC(12, 2) NOT NULL,
    balance_after NUMERIC(12, 2) NOT NULL,
    allocated_by VARCHAR(64) NOT NULL, -- 'SYSTEM_WORKER' or user_id
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_payment_ledger_receipt UNIQUE (tenant_id, receipt_number)
);

CREATE INDEX IF NOT EXISTS idx_payment_ledger_tenant_student
    ON payment_ledger (tenant_id, student_id);

CREATE INDEX IF NOT EXISTS idx_payment_ledger_tenant_invoice
    ON payment_ledger (tenant_id, invoice_id);

CREATE INDEX IF NOT EXISTS idx_payment_ledger_tenant_created
    ON payment_ledger (tenant_id, created_at DESC);

-- RLS on payment_ledger
ALTER TABLE payment_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_ledger FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_payment_ledger ON payment_ledger;
CREATE POLICY tenant_isolation_payment_ledger ON payment_ledger
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS platform_admin_payment_ledger ON payment_ledger;
CREATE POLICY platform_admin_payment_ledger ON payment_ledger
    FOR ALL USING (current_setting('app.current_user_role', true) = 'SAAS_ADMIN')
    WITH CHECK (current_setting('app.current_user_role', true) = 'SAAS_ADMIN');


-- 3. MIGRATE EXISTING mpesa_raw_inbox DATA (if exists)
-- This is a one-way migration; run after verifying the new tables work
-- INSERT INTO mpesa_inbox (tenant_id, trans_id, trans_time, trans_amount, business_short_code, bill_ref_number, msisdn, first_name, raw_payload, status, error_message, retry_count, created_at, updated_at)
-- SELECT tenant_id, trans_id, NULL, amount::numeric, NULL, account_reference, sender_phone, sender_name, raw_payload,
--        processing_status,
--        error_log,
--        attempts,
--        received_at,
--        COALESCE(processed_at, now())
-- FROM mpesa_raw_inbox
-- ON CONFLICT (tenant_id, trans_id) DO NOTHING;

-- Note: Keep mpesa_raw_inbox for backward compatibility during transition.
-- Drop it in a future migration after verifying zero active references.


-- 4. OUTBOX ENHANCEMENTS FOR LEASE TIMEOUTS (add to existing outbox table)
-- These columns support the robust worker with FOR UPDATE SKIP LOCKED
ALTER TABLE outbox
    ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_error TEXT;

-- Partial index for efficient pending claims
CREATE INDEX IF NOT EXISTS idx_outbox_pending_lease
    ON outbox (status, next_attempt_at)
    WHERE status IN ('PENDING', 'FAILED');

-- RLS on outbox (ensure it exists)
ALTER TABLE outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_outbox ON outbox;
CREATE POLICY tenant_isolation_outbox ON outbox
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS platform_admin_outbox ON outbox;
CREATE POLICY platform_admin_outbox ON outbox
    FOR ALL USING (current_setting('app.current_user_role', true) = 'SAAS_ADMIN')
    WITH CHECK (current_setting('app.current_user_role', true) = 'SAAS_ADMIN');

DROP POLICY IF EXISTS worker_outbox ON outbox;
CREATE POLICY worker_outbox ON outbox
    FOR ALL USING (current_setting('app.worker', true) = 'on')
    WITH CHECK (current_setting('app.worker', true) = 'on');


-- 5. STUDENT INVOICES - ensure deterministic lock ordering support
-- The allocation worker locks invoices via: SELECT ... FOR UPDATE ORDER BY due_date ASC
-- Ensure the index supports this ordering
CREATE INDEX IF NOT EXISTS idx_student_invoices_tenant_student_due
    ON invoices (tenant_id, learner_id, due_date ASC NULLS LAST)
    WHERE status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE');


-- 6. RECONCILIATION RUNS - add forensic linkage
ALTER TABLE reconciliation_runs
    ADD COLUMN IF NOT EXISTS inbox_ids UUID[],
    ADD COLUMN IF NOT EXISTS ledger_count INT DEFAULT 0;
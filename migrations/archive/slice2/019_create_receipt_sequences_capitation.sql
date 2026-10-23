-- Migration 019: Create receipt sequences, capitation receipts, reconciliation runs (M10)
CREATE TABLE IF NOT EXISTS receipt_sequences (
    sequence_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    prefix VARCHAR(20) NOT NULL DEFAULT 'RCP',
    last_number INTEGER NOT NULL DEFAULT 0,
    reset_frequency VARCHAR(20) DEFAULT 'YEARLY', -- YEARLY, TERM, NEVER
    current_period VARCHAR(20) NOT NULL, -- e.g. "2026" or "2026-T1"
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, current_period)
);

CREATE INDEX IF NOT EXISTS idx_receipt_sequences_tenant ON receipt_sequences(tenant_id);

-- RLS for receipt_sequences
ALTER TABLE receipt_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY receipt_sequences_isolation ON receipt_sequences
    FOR ALL USING (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS capitation_receipts (
    receipt_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    receipt_number VARCHAR(50) NOT NULL,
    capitation_period VARCHAR(20) NOT NULL, -- e.g. "2026-T1", "2026-FY"
    learner_count INTEGER NOT NULL DEFAULT 0,
    amount_per_learner NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    currency VARCHAR(3) DEFAULT 'KES',
    received_at DATE,
    reference VARCHAR(100), -- government reference
    status VARCHAR(20) NOT NULL DEFAULT 'RECEIVED', -- RECEIVED, ALLOCATED, RECONCILED
    allocated_to_invoices BOOLEAN DEFAULT FALSE,
    raw_payload JSONB DEFAULT '{}',
    created_by UUID REFERENCES users(user_id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, receipt_number)
);

CREATE INDEX IF NOT EXISTS idx_capitation_receipts_tenant ON capitation_receipts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_capitation_receipts_period ON capitation_receipts(capitation_period);
CREATE INDEX IF NOT EXISTS idx_capitation_receipts_status ON capitation_receipts(status);

-- RLS for capitation_receipts
ALTER TABLE capitation_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY capitation_receipts_isolation ON capitation_receipts
    FOR ALL USING (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS reconciliation_runs (
    run_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    run_date DATE NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    total_expected NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_received NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_outstanding NUMERIC(12,2) NOT NULL DEFAULT 0,
    unmatched_transactions INTEGER DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS', -- IN_PROGRESS, COMPLETED, EXCEPTION
    exception_count INTEGER DEFAULT 0,
    created_by UUID REFERENCES users(user_id),
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_runs_tenant ON reconciliation_runs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_runs_date ON reconciliation_runs(run_date);
CREATE INDEX IF NOT EXISTS idx_reconciliation_runs_status ON reconciliation_runs(status);

-- RLS for reconciliation_runs
ALTER TABLE reconciliation_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_runs_isolation ON reconciliation_runs
    FOR ALL USING (tenant_id = current_tenant_id());

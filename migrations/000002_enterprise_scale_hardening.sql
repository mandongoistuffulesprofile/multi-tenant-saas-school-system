-- =============================================================================
-- SLICE 0 FOUNDATION SCALE HARDENING: DARAJA STAGING & CBC CQRS PROJECTION
-- =============================================================================

-- 1. Daraja M-Pesa Append-Only Staging Inbox (Eliminates Webhook Timeouts & Double Spend)
CREATE TABLE IF NOT EXISTS mpesa_raw_inbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    trans_id VARCHAR(32) NOT NULL,
    sender_phone VARCHAR(20) NOT NULL,
    sender_name VARCHAR(128) NOT NULL,
    amount NUMERIC(12,2) NOT NULL,
    account_reference VARCHAR(64) NOT NULL,
    raw_payload JSONB NOT NULL,
    processing_status VARCHAR(20) DEFAULT 'PENDING' CHECK (processing_status IN ('PENDING', 'PROCESSED', 'FAILED', 'MANUAL_REVIEW')),
    error_log TEXT,
    received_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    processed_at TIMESTAMPTZ,
    CONSTRAINT uq_mpesa_trans_id UNIQUE (tenant_id, trans_id)
);

CREATE INDEX IF NOT EXISTS idx_mpesa_inbox_pending ON mpesa_raw_inbox(tenant_id, processing_status) WHERE processing_status = 'PENDING';

-- 2. Sibling Account Linkages Table (For Multi-Student Split Allocations)
CREATE TABLE IF NOT EXISTS student_sibling_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    family_reference_phone VARCHAR(20) NOT NULL,
    student_ids UUID[] NOT NULL,
    guardian_name VARCHAR(128) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_sibling_phone ON student_sibling_groups(tenant_id, family_reference_phone);

-- 3. CBC Assessment Events (Immutable Write Path)
CREATE TABLE IF NOT EXISTS cbc_assessment_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    student_id UUID NOT NULL,
    learning_area VARCHAR(64) NOT NULL,
    strand VARCHAR(64) NOT NULL,
    substrand VARCHAR(64) NOT NULL,
    rubric_level VARCHAR(4) NOT NULL CHECK (rubric_level IN ('EE', 'ME', 'AE', 'BE')),
    recorded_by UUID NOT NULL,
    term_id VARCHAR(16) NOT NULL,
    academic_year INT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);

-- 4. CBC Student Term Summary (CQRS Read-Model Projection)
CREATE TABLE IF NOT EXISTS cbc_student_term_summary (
    tenant_id UUID NOT NULL,
    student_id UUID NOT NULL,
    term_id VARCHAR(16) NOT NULL,
    academic_year INT NOT NULL,
    learning_area VARCHAR(64) NOT NULL,
    substrand VARCHAR(64) NOT NULL,
    latest_rubric_level VARCHAR(4) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    PRIMARY KEY (tenant_id, student_id, term_id, academic_year, learning_area, substrand)
);

-- Trigger Function: Automatic Materialized Update on Assessment Insertion
CREATE OR REPLACE FUNCTION fn_project_cbc_event_to_summary()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO cbc_student_term_summary (
        tenant_id, student_id, term_id, academic_year, learning_area, substrand, latest_rubric_level, updated_at
    )
    VALUES (
        NEW.tenant_id, NEW.student_id, NEW.term_id, NEW.academic_year, NEW.learning_area, NEW.substrand, NEW.rubric_level, NEW.created_at
    )
    ON CONFLICT (tenant_id, student_id, term_id, academic_year, learning_area, substrand)
    DO UPDATE SET
        latest_rubric_level = EXCLUDED.latest_rubric_level,
        updated_at = EXCLUDED.updated_at;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cbc_event_projection ON cbc_assessment_events;
CREATE TRIGGER trg_cbc_event_projection
AFTER INSERT ON cbc_assessment_events
FOR EACH ROW EXECUTE FUNCTION fn_project_cbc_event_to_summary();

-- Enable Forced Row Level Security on all tables
ALTER TABLE mpesa_raw_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE mpesa_raw_inbox FORCE ROW LEVEL SECURITY;

ALTER TABLE student_sibling_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_sibling_groups FORCE ROW LEVEL SECURITY;

ALTER TABLE cbc_assessment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbc_assessment_events FORCE ROW LEVEL SECURITY;

ALTER TABLE cbc_student_term_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbc_student_term_summary FORCE ROW LEVEL SECURITY;

-- ============================================================================
-- BATCH A: AUDIT LOGS & STK PUSH LOGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(64) NOT NULL, -- e.g., 'FEE_WAIVER_APPLIED', 'STUDENT_DELETED'
    resource_type VARCHAR(64) NOT NULL, -- e.g., 'student', 'invoice', 'assessment'
    resource_id VARCHAR(64) NOT NULL,
    ip_address VARCHAR(45) NOT NULL DEFAULT '',
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_audit_logs ON audit_logs;
CREATE POLICY rls_audit_logs ON audit_logs
    USING (tenant_id = current_tenant())
    WITH CHECK (tenant_id = current_tenant());

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON audit_logs(tenant_id, created_at DESC);

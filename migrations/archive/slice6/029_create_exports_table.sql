-- Migration 029: Create exports table (M15)
CREATE TABLE IF NOT EXISTS exports (
    export_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    export_type VARCHAR(30) NOT NULL, -- LEARNERS, STAFF, PAYMENTS, ASSESSMENTS, REPORTS, ATTENDANCE, FINANCE
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING, GENERATING, COMPLETED, FAILED
    file_ref VARCHAR(255),
    file_name VARCHAR(255),
    file_size INTEGER,
    record_count INTEGER DEFAULT 0,
    parameters JSONB DEFAULT '{}',
    error_message TEXT,
    created_by UUID REFERENCES users(user_id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_exports_tenant ON exports(tenant_id);
CREATE INDEX IF NOT EXISTS idx_exports_type ON exports(export_type);
CREATE INDEX IF NOT EXISTS idx_exports_status ON exports(status);
CREATE INDEX IF NOT EXISTS idx_exports_created ON exports(created_at);

-- RLS for exports
ALTER TABLE exports ENABLE ROW LEVEL SECURITY;
CREATE POLICY exports_isolation ON exports
    FOR ALL USING (tenant_id = current_tenant_id());

-- Migration 025: Create consent records and access logs (M12)
-- consent_notices: global consent notice templates
CREATE TABLE IF NOT EXISTS consent_notices (
    notice_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    notice_code VARCHAR(50) NOT NULL UNIQUE, -- DATA_PROCESSING, SMS_COMMUNICATION, PHOTO_USE, BIOMETRIC_USE
    title VARCHAR(150) NOT NULL,
    content_text TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    is_active BOOLEAN DEFAULT TRUE,
    requires_renewal BOOLEAN DEFAULT FALSE,
    renewal_period_days INTEGER,
    created_by UUID REFERENCES users(user_id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_consent_notices_code ON consent_notices(notice_code);
CREATE INDEX IF NOT EXISTS idx_consent_notices_active ON consent_notices(is_active);

-- consent_records: tenant-scoped consent given by users/parents
CREATE TABLE IF NOT EXISTS consent_records (
    consent_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    notice_id UUID NOT NULL REFERENCES consent_notices(notice_id) ON DELETE CASCADE,
    notice_version INTEGER NOT NULL,
    granted BOOLEAN NOT NULL DEFAULT FALSE,
    granted_at TIMESTAMP WITH TIME ZONE,
    revoked_at TIMESTAMP WITH TIME ZONE,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, user_id, notice_id, notice_version)
);

CREATE INDEX IF NOT EXISTS idx_consent_records_tenant ON consent_records(tenant_id);
CREATE INDEX IF NOT EXISTS idx_consent_records_user ON consent_records(user_id);
CREATE INDEX IF NOT EXISTS idx_consent_records_notice ON consent_records(notice_id);

-- RLS for consent_records
ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY consent_records_isolation ON consent_records
    FOR ALL USING (tenant_id = current_tenant_id());

-- access_logs: audit of data access
CREATE TABLE IF NOT EXISTS access_logs (
    log_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL, -- VIEW, EXPORT, PRINT, DOWNLOAD, SEND
    resource_type VARCHAR(50) NOT NULL, -- learner, report_card, assessment_result, payment
    resource_id UUID NOT NULL,
    ip_address INET,
    user_agent TEXT,
    accessed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_access_logs_tenant ON access_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_access_logs_user ON access_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_access_logs_resource ON access_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_access_logs_accessed ON access_logs(accessed_at);

-- RLS for access_logs
ALTER TABLE access_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY access_logs_isolation ON access_logs
    FOR ALL USING (tenant_id = current_tenant_id());

-- dsr_requests: data subject requests (ODPC compliance)
CREATE TABLE IF NOT EXISTS dsr_requests (
    request_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    request_type VARCHAR(30) NOT NULL, -- ACCESS, RECTIFICATION, ERASURE, PORTABILITY, OBJECTION
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING, IN_PROGRESS, COMPLETED, REJECTED
    description TEXT,
    response_data JSONB DEFAULT '{}',
    responded_by UUID REFERENCES users(user_id),
    responded_at TIMESTAMP WITH TIME ZONE,
    due_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dsr_requests_tenant ON dsr_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dsr_requests_user ON dsr_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_dsr_requests_status ON dsr_requests(status);

-- RLS for dsr_requests
ALTER TABLE dsr_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY dsr_requests_isolation ON dsr_requests
    FOR ALL USING (tenant_id = current_tenant_id());

-- breach_register: data breach incidents
CREATE TABLE IF NOT EXISTS breach_register (
    breach_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    breach_title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    discovered_at TIMESTAMP WITH TIME ZONE NOT NULL,
    reported_to_authority BOOLEAN DEFAULT FALSE,
    authority_reported_at TIMESTAMP WITH TIME ZONE,
    affected_data_subjects INTEGER DEFAULT 0,
    severity VARCHAR(20) NOT NULL DEFAULT 'LOW', -- LOW, MEDIUM, HIGH, CRITICAL
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN', -- OPEN, INVESTIGATING, RESOLVED, CLOSED
    resolution_notes TEXT,
    reported_by UUID REFERENCES users(user_id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_breach_register_tenant ON breach_register(tenant_id);
CREATE INDEX IF NOT EXISTS idx_breach_register_status ON breach_register(status);
CREATE INDEX IF NOT EXISTS idx_breach_register_severity ON breach_register(severity);

-- RLS for breach_register
ALTER TABLE breach_register ENABLE ROW LEVEL SECURITY;
CREATE POLICY breach_register_isolation ON breach_register
    FOR ALL USING (tenant_id = current_tenant_id());

-- retention_policies: data retention rules
CREATE TABLE IF NOT EXISTS retention_policies (
    policy_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    resource_type VARCHAR(50) NOT NULL,
    retention_days INTEGER NOT NULL,
    action_after_retention VARCHAR(30) NOT NULL, -- ARCHIVE, DELETE, ANONYMIZE
    is_active BOOLEAN DEFAULT TRUE,
    created_by UUID REFERENCES users(user_id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, resource_type)
);

CREATE INDEX IF NOT EXISTS idx_retention_policies_tenant ON retention_policies(tenant_id);

-- RLS for retention_policies
ALTER TABLE retention_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY retention_policies_isolation ON retention_policies
    FOR ALL USING (tenant_id = current_tenant_id());

-- dpia_records: data protection impact assessments
CREATE TABLE IF NOT EXISTS dpia_records (
    dpia_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    processing_activity VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    risk_level VARCHAR(20) NOT NULL DEFAULT 'LOW', -- LOW, MEDIUM, HIGH
    mitigation_measures TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT', -- DRAFT, REVIEWED, APPROVED
    assessed_by UUID REFERENCES users(user_id),
    assessed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    review_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dpia_records_tenant ON dpia_records(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dpia_records_status ON dpia_records(status);

-- RLS for dpia_records
ALTER TABLE dpia_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY dpia_records_isolation ON dpia_records
    FOR ALL USING (tenant_id = current_tenant_id());

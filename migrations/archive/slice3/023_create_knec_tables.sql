-- Migration 023: Create KNEC tables (M7)

-- knec_tools: global reference of KNEC assessment tools
CREATE TABLE IF NOT EXISTS knec_tools (
    tool_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tool_code VARCHAR(50) NOT NULL UNIQUE, -- e.g. "KEMIA", "MLA", "KPSEA"
    name VARCHAR(150) NOT NULL,
    description TEXT,
    grade_id VARCHAR(20) NOT NULL REFERENCES grades(grade_id) ON DELETE CASCADE,
    assessment_year INTEGER NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_knec_tools_code ON knec_tools(tool_code);
CREATE INDEX IF NOT EXISTS idx_knec_tools_grade ON knec_tools(grade_id);
CREATE INDEX IF NOT EXISTS idx_knec_tools_year ON knec_tools(assessment_year);

-- knec_submission_status: tenant-scoped KNEC submission tracking
CREATE TABLE IF NOT EXISTS knec_submission_status (
    submission_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    tool_id UUID NOT NULL REFERENCES knec_tools(tool_id) ON DELETE CASCADE,
    academic_year_id UUID NOT NULL REFERENCES academic_years(year_id) ON DELETE CASCADE,
    grade_id VARCHAR(20) NOT NULL REFERENCES grades(grade_id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING, EXPORTED, SUBMITTED, CONFIRMED, REJECTED
    export_ref VARCHAR(100), -- KNEC portal reference
    exported_at TIMESTAMP WITH TIME ZONE,
    confirmed_at TIMESTAMP WITH TIME ZONE,
    export_payload JSONB DEFAULT '{}',
    variance_report JSONB DEFAULT '{}',
    created_by UUID REFERENCES users(user_id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, tool_id, academic_year_id, grade_id)
);

CREATE INDEX IF NOT EXISTS idx_knec_submission_status_tenant ON knec_submission_status(tenant_id);
CREATE INDEX IF NOT EXISTS idx_knec_submission_status_tool ON knec_submission_status(tool_id);
CREATE INDEX IF NOT EXISTS idx_knec_submission_status_status ON knec_submission_status(status);

-- RLS for knec_submission_status
ALTER TABLE knec_submission_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY knec_submission_status_isolation ON knec_submission_status
    FOR ALL USING (tenant_id = current_tenant_id());

-- knec_export_batches: batch export jobs for KNEC
CREATE TABLE IF NOT EXISTS knec_export_batches (
    batch_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    tool_id UUID NOT NULL REFERENCES knec_tools(tool_id) ON DELETE CASCADE,
    batch_reference VARCHAR(100) NOT NULL,
    learner_count INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING, GENERATING, GENERATED, UPLOADED, FAILED
    file_ref VARCHAR(255), -- S3 object key for export file
    error_message TEXT,
    created_by UUID REFERENCES users(user_id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_knec_export_batches_tenant ON knec_export_batches(tenant_id);
CREATE INDEX IF NOT EXISTS idx_knec_export_batches_tool ON knec_export_batches(tool_id);
CREATE INDEX IF NOT EXISTS idx_knec_export_batches_status ON knec_export_batches(status);
CREATE INDEX IF NOT EXISTS idx_knec_export_batches_ref ON knec_export_batches(batch_reference);

-- RLS for knec_export_batches
ALTER TABLE knec_export_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY knec_export_batches_isolation ON knec_export_batches
    FOR ALL USING (tenant_id = current_tenant_id());

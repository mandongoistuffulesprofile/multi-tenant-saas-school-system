-- Migration 022: Create evidence, competency, remarks, sync, weighting tables (M6)

-- evidence_files: attachments for assessment results
CREATE TABLE IF NOT EXISTS evidence_files (
    evidence_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    result_id UUID NOT NULL REFERENCES assessment_results(result_id) ON DELETE CASCADE,
    file_ref VARCHAR(255) NOT NULL, -- S3 object key
    file_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_size INTEGER NOT NULL,
    uploaded_by UUID REFERENCES users(user_id),
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_evidence_files_tenant ON evidence_files(tenant_id);
CREATE INDEX IF NOT EXISTS idx_evidence_files_result ON evidence_files(result_id);

-- RLS for evidence_files
ALTER TABLE evidence_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY evidence_files_isolation ON evidence_files
    FOR ALL USING (tenant_id = current_tenant_id());

-- competency_ratings: competency-level ratings per sub-strand
CREATE TABLE IF NOT EXISTS competency_ratings (
    rating_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    result_id UUID NOT NULL REFERENCES assessment_results(result_id) ON DELETE CASCADE,
    competency_code VARCHAR(20) NOT NULL, -- e.g. "CRITICAL_THINKING", "COMMUNICATION"
    rating_level VARCHAR(20) NOT NULL, -- e.g. "EXCEEDS", "MEETS", "APPROACHING", "BELOW"
    rated_by UUID REFERENCES users(user_id),
    rated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(result_id, competency_code)
);

CREATE INDEX IF NOT EXISTS idx_competency_ratings_tenant ON competency_ratings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_competency_ratings_result ON competency_ratings(result_id);

-- RLS for competency_ratings
ALTER TABLE competency_ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY competency_ratings_isolation ON competency_ratings
    FOR ALL USING (tenant_id = current_tenant_id());

-- learner_remarks: teacher comments per learner per event
CREATE TABLE IF NOT EXISTS learner_remarks (
    remark_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    event_id UUID NOT NULL REFERENCES assessment_events(event_id) ON DELETE CASCADE,
    learner_id UUID NOT NULL REFERENCES learners(learner_id) ON DELETE CASCADE,
    remark_text TEXT NOT NULL,
    remark_type VARCHAR(20) NOT NULL DEFAULT 'GENERAL', -- GENERAL, STRENGTH, IMPROVEMENT, CONCERN
    created_by UUID REFERENCES users(user_id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(event_id, learner_id)
);

CREATE INDEX IF NOT EXISTS idx_learner_remarks_tenant ON learner_remarks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_learner_remarks_event ON learner_remarks(event_id);
CREATE INDEX IF NOT EXISTS idx_learner_remarks_learner ON learner_remarks(learner_id);

-- RLS for learner_remarks
ALTER TABLE learner_remarks ENABLE ROW LEVEL SECURITY;
CREATE POLICY learner_remarks_isolation ON learner_remarks
    FOR ALL USING (tenant_id = current_tenant_id());

-- sync_log: offline sync session tracking
CREATE TABLE IF NOT EXISTS sync_log (
    sync_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
    sync_type VARCHAR(20) NOT NULL, -- PUSH, PULL
    items_sent INTEGER DEFAULT 0,
    items_received INTEGER DEFAULT 0,
    conflicts INTEGER DEFAULT 0,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS', -- IN_PROGRESS, COMPLETED, FAILED
    error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_log_tenant ON sync_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sync_log_device ON sync_log(device_id);
CREATE INDEX IF NOT EXISTS idx_sync_log_status ON sync_log(status);

-- RLS for sync_log
ALTER TABLE sync_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY sync_log_isolation ON sync_log
    FOR ALL USING (tenant_id = current_tenant_id());

-- sync_conflicts: unresolved offline sync conflicts
CREATE TABLE IF NOT EXISTS sync_conflicts (
    conflict_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    entity_type VARCHAR(50) NOT NULL, -- assessment_results, learner_remarks, etc.
    entity_id UUID NOT NULL,
    client_version INTEGER NOT NULL,
    server_version INTEGER NOT NULL,
    client_values JSONB NOT NULL DEFAULT '{}',
    server_values JSONB NOT NULL DEFAULT '{}',
    resolved BOOLEAN DEFAULT FALSE,
    resolution_values JSONB DEFAULT '{}',
    resolved_by UUID REFERENCES users(user_id),
    resolved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sync_conflicts_tenant ON sync_conflicts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_entity ON sync_conflicts(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_resolved ON sync_conflicts(resolved);

-- RLS for sync_conflicts
ALTER TABLE sync_conflicts ENABLE ROW LEVEL SECURITY;
CREATE POLICY sync_conflicts_isolation ON sync_conflicts
    FOR ALL USING (tenant_id = current_tenant_id());

-- weighting_profiles: global weighting for composite scores (e.g. KPSEA)
CREATE TABLE IF NOT EXISTS weighting_profiles (
    profile_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    grade_id VARCHAR(20) NOT NULL REFERENCES grades(grade_id) ON DELETE CASCADE,
    weights JSONB NOT NULL DEFAULT '{}', -- {"G4": 0.20, "G5": 0.20, "G6": 0.20, "EXAM": 0.40}
    is_default BOOLEAN DEFAULT FALSE,
    created_by UUID REFERENCES users(user_id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_weighting_profiles_grade ON weighting_profiles(grade_id);
CREATE INDEX IF NOT EXISTS idx_weighting_profiles_default ON weighting_profiles(is_default);

-- Insert default KPSEA weighting profile for Grade 6
INSERT INTO weighting_profiles (name, description, grade_id, weights, is_default)
SELECT 'KPSEA Composite', 'KPSEA composite: G4 0.20 + G5 0.20 + G6 0.20 + Exam 0.40', g.grade_id,
       '{"G4": 0.20, "G5": 0.20, "G6": 0.20, "EXAM": 0.40}'::JSONB, TRUE
FROM grades g WHERE g.grade_id = 'G6'
ON CONFLICT DO NOTHING;

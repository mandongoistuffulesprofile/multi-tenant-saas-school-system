-- Migration 021: Create assessment tables (M6)
-- Assessment model: event-based history per plan §2

-- assessment_events: defines an assessment occasion
CREATE TABLE IF NOT EXISTS assessment_events (
    event_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    term_id UUID NOT NULL REFERENCES terms(term_id) ON DELETE CASCADE,
    grade_id VARCHAR(20) NOT NULL REFERENCES grades(grade_id) ON DELETE CASCADE,
    learning_area_id UUID NOT NULL REFERENCES learning_areas(area_id) ON DELETE CASCADE,
    assessment_type VARCHAR(30) NOT NULL, -- CAT, MIDTERM, ENDTERM, PROJECT, ORAL, PRACTICAL
    scoring_mode VARCHAR(20) NOT NULL, -- LEVEL, POINTS, PERCENTAGE, RAW
    assessment_window VARCHAR(20) NOT NULL, -- WINDOW_1, WINDOW_2, WINDOW_3
    weighting_profile_id UUID REFERENCES weighting_profiles(profile_id),
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT', -- DRAFT, ACTIVE, MODERATED, LOCKED
    max_score NUMERIC(12,2),
    created_by UUID REFERENCES users(user_id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_assessment_events_tenant ON assessment_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_assessment_events_term ON assessment_events(term_id);
CREATE INDEX IF NOT EXISTS idx_assessment_events_grade ON assessment_events(grade_id);
CREATE INDEX IF NOT EXISTS idx_assessment_events_area ON assessment_events(learning_area_id);
CREATE INDEX IF NOT EXISTS idx_assessment_events_status ON assessment_events(status);
CREATE INDEX IF NOT EXISTS idx_assessment_events_unique ON assessment_events(tenant_id, term_id, grade_id, learning_area_id, assessment_type, assessment_window);

-- RLS for assessment_events
ALTER TABLE assessment_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY assessment_events_isolation ON assessment_events
    FOR ALL USING (tenant_id = current_tenant_id());

-- assessment_results: one result per (event, learner, sub_strand)
CREATE TABLE IF NOT EXISTS assessment_results (
    result_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    event_id UUID NOT NULL REFERENCES assessment_events(event_id) ON DELETE CASCADE,
    learner_id UUID NOT NULL REFERENCES learners(learner_id) ON DELETE CASCADE,
    sub_strand_id UUID REFERENCES sub_strands(sub_strand_id) ON DELETE SET NULL,
    level_code VARCHAR(10), -- e.g. "EXCEEDS", "MEETS", "APPROACHING", "BELOW"
    points NUMERIC(12,2),
    raw_score NUMERIC(12,2),
    max_score NUMERIC(12,2),
    teacher_id UUID REFERENCES users(user_id),
    remarks TEXT,
    client_uuid UUID, -- idempotency key from client
    version INTEGER DEFAULT 1,
    state VARCHAR(20) NOT NULL DEFAULT 'DRAFT', -- DRAFT, SUBMITTED, MODERATED, LOCKED
    device_id UUID REFERENCES devices(device_id) ON DELETE SET NULL,
    client_ts TIMESTAMP WITH TIME ZONE,
    server_ts TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(event_id, learner_id, sub_strand_id)
);

CREATE INDEX IF NOT EXISTS idx_assessment_results_tenant ON assessment_results(tenant_id);
CREATE INDEX IF NOT EXISTS idx_assessment_results_event ON assessment_results(event_id);
CREATE INDEX IF NOT EXISTS idx_assessment_results_learner ON assessment_results(learner_id);
CREATE INDEX IF NOT EXISTS idx_assessment_results_client_uuid ON assessment_results(client_uuid);
CREATE INDEX IF NOT EXISTS idx_assessment_results_state ON assessment_results(state);

-- RLS for assessment_results
ALTER TABLE assessment_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY assessment_results_isolation ON assessment_results
    FOR ALL USING (tenant_id = current_tenant_id());

-- assessment_result_history: append-only history of result changes
CREATE TABLE IF NOT EXISTS assessment_result_history (
    history_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    result_id UUID NOT NULL REFERENCES assessment_results(result_id) ON DELETE CASCADE,
    event_id UUID NOT NULL REFERENCES assessment_events(event_id) ON DELETE CASCADE,
    learner_id UUID NOT NULL REFERENCES learners(learner_id) ON DELETE CASCADE,
    sub_strand_id UUID REFERENCES sub_strands(sub_strand_id) ON DELETE SET NULL,
    level_code VARCHAR(10),
    points NUMERIC(12,2),
    raw_score NUMERIC(12,2),
    max_score NUMERIC(12,2),
    state VARCHAR(20) NOT NULL,
    changed_by UUID REFERENCES users(user_id),
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    change_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_assessment_result_history_tenant ON assessment_result_history(tenant_id);
CREATE INDEX IF NOT EXISTS idx_assessment_result_history_result ON assessment_result_history(result_id);
CREATE INDEX IF NOT EXISTS idx_assessment_result_history_changed ON assessment_result_history(changed_at);

-- RLS for assessment_result_history
ALTER TABLE assessment_result_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY assessment_result_history_isolation ON assessment_result_history
    FOR ALL USING (tenant_id = current_tenant_id());

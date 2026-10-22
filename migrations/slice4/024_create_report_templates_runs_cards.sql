-- Migration 024: Create report templates, runs, cards (M8)
-- report_templates: global templates (no tenant_id) - school-specific overrides via tenant_id
CREATE TABLE IF NOT EXISTS report_templates (
    template_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) REFERENCES schools(tenant_id) ON DELETE CASCADE,
    template_name VARCHAR(150) NOT NULL,
    template_type VARCHAR(30) NOT NULL, -- TERMLY, ANNUAL, KPSEA, PROGRESS
    grade_band VARCHAR(20) NOT NULL, -- LOWER_PRIMARY, UPPER_PRIMARY
    is_default BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    template_config JSONB NOT NULL DEFAULT '{}',
    created_by UUID REFERENCES users(user_id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, template_name)
);

CREATE INDEX IF NOT EXISTS idx_report_templates_tenant ON report_templates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_report_templates_type ON report_templates(template_type);
CREATE INDEX IF NOT EXISTS idx_report_templates_default ON report_templates(is_default);

-- RLS for report_templates
ALTER TABLE report_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY report_templates_isolation ON report_templates
    FOR ALL USING (tenant_id = current_tenant_id() OR tenant_id IS NULL);

-- report_runs: generation jobs
CREATE TABLE IF NOT EXISTS report_runs (
    run_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    template_id UUID NOT NULL REFERENCES report_templates(template_id) ON DELETE CASCADE,
    academic_year_id UUID NOT NULL REFERENCES academic_years(year_id) ON DELETE CASCADE,
    term_id UUID REFERENCES terms(term_id) ON DELETE CASCADE,
    grade_id VARCHAR(20) REFERENCES grades(grade_id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING, GENERATING, COMPLETED, FAILED
    learner_count INTEGER DEFAULT 0,
    generated_count INTEGER DEFAULT 0,
    error_message TEXT,
    file_ref VARCHAR(255),
    created_by UUID REFERENCES users(user_id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_report_runs_tenant ON report_runs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_report_runs_status ON report_runs(status);
CREATE INDEX IF NOT EXISTS idx_report_runs_template ON report_runs(template_id);

-- RLS for report_runs
ALTER TABLE report_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY report_runs_isolation ON report_runs
    FOR ALL USING (tenant_id = current_tenant_id());

-- report_cards: individual learner report cards
CREATE TABLE IF NOT EXISTS report_cards (
    card_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    run_id UUID NOT NULL REFERENCES report_runs(run_id) ON DELETE CASCADE,
    learner_id UUID NOT NULL REFERENCES learners(learner_id) ON DELETE CASCADE,
    card_number VARCHAR(50) NOT NULL,
    academic_year_id UUID NOT NULL REFERENCES academic_years(year_id) ON DELETE CASCADE,
    term_id UUID REFERENCES terms(term_id) ON DELETE CASCADE,
    grade_id VARCHAR(20) NOT NULL REFERENCES grades(grade_id) ON DELETE CASCADE,
    overall_grade VARCHAR(10),
    total_score NUMERIC(12,2),
    max_score NUMERIC(12,2),
    percentage NUMERIC(5,2),
    position INTEGER,
    comment TEXT,
    head_teacher_comment TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT', -- DRAFT, PUBLISHED, WITHHELD
    pdf_ref VARCHAR(255),
    published_at TIMESTAMP WITH TIME ZONE,
    published_by UUID REFERENCES users(user_id),
    created_by UUID REFERENCES users(user_id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, run_id, learner_id)
);

CREATE INDEX IF NOT EXISTS idx_report_cards_tenant ON report_cards(tenant_id);
CREATE INDEX IF NOT EXISTS idx_report_cards_run ON report_cards(run_id);
CREATE INDEX IF NOT EXISTS idx_report_cards_learner ON report_cards(learner_id);
CREATE INDEX IF NOT EXISTS idx_report_cards_status ON report_cards(status);
CREATE INDEX IF NOT EXISTS idx_report_cards_card_number ON report_cards(card_number);

-- RLS for report_cards
ALTER TABLE report_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY report_cards_isolation ON report_cards
    FOR ALL USING (tenant_id = current_tenant_id());

-- report_card_comments: teacher comments per learning area
CREATE TABLE IF NOT EXISTS report_card_comments (
    comment_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    card_id UUID NOT NULL REFERENCES report_cards(card_id) ON DELETE CASCADE,
    learning_area_id UUID NOT NULL REFERENCES learning_areas(area_id) ON DELETE CASCADE,
    comment_text TEXT NOT NULL,
    teacher_id UUID REFERENCES users(user_id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(card_id, learning_area_id)
);

CREATE INDEX IF NOT EXISTS idx_report_card_comments_tenant ON report_card_comments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_report_card_comments_card ON report_card_comments(card_id);

-- RLS for report_card_comments
ALTER TABLE report_card_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY report_card_comments_isolation ON report_card_comments
    FOR ALL USING (tenant_id = current_tenant_id());

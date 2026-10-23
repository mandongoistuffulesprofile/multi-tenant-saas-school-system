-- Migration 015: Create fee categories and fee structures (M10)
-- fee_categories: global reference table (no tenant_id)
CREATE TABLE IF NOT EXISTS fee_categories (
    category_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(30) NOT NULL UNIQUE, -- TUITION, MEALS, TRANSPORT, UNIFORM, EXAM, ACTIVITY, BOARDING, OTHER
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_tuition BOOLEAN DEFAULT FALSE,
    is_optional BOOLEAN DEFAULT FALSE,
    requires_consent BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_fee_categories_code ON fee_categories(code);

-- Insert default fee categories
INSERT INTO fee_categories (code, name, description, is_tuition, is_optional, requires_consent) VALUES
    ('TUITION', 'Tuition', 'Regular tuition fees', TRUE, FALSE, FALSE),
    ('MEALS', 'Meals', 'School meals / feeding program', FALSE, TRUE, TRUE),
    ('TRANSPORT', 'Transport', 'School transport / bus fees', FALSE, TRUE, TRUE),
    ('UNIFORM', 'Uniform', 'School uniform', FALSE, TRUE, FALSE),
    ('EXAM', 'Examination', 'Internal examination fees', FALSE, FALSE, FALSE),
    ('ACTIVITY', 'Activity', 'Co-curricular activities', FALSE, TRUE, TRUE),
    ('BOARDING', 'Boarding', 'Boarding / accommodation fees', FALSE, TRUE, FALSE),
    ('OTHER', 'Other', 'Miscellaneous fees', FALSE, TRUE, TRUE)
ON CONFLICT (code) DO NOTHING;

-- fee_structures: tenant-scoped, defines fees per grade/category per academic year
CREATE TABLE IF NOT EXISTS fee_structures (
    structure_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    academic_year_id UUID NOT NULL REFERENCES academic_years(year_id) ON DELETE CASCADE,
    grade_id VARCHAR(20) NOT NULL REFERENCES grades(grade_id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES fee_categories(category_id) ON DELETE CASCADE,
    amount_per_term NUMERIC(12,2) NOT NULL DEFAULT 0,
    amount_per_year NUMERIC(12,2) NOT NULL DEFAULT 0,
    currency VARCHAR(3) DEFAULT 'KES',
    is_mandatory BOOLEAN DEFAULT TRUE,
    payment_frequency VARCHAR(20) DEFAULT 'PER_TERM', -- PER_TERM, PER_YEAR, ONCE
    due_day INTEGER DEFAULT 5, -- day of month when due
    created_by UUID REFERENCES users(user_id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, academic_year_id, grade_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_fee_structures_tenant ON fee_structures(tenant_id);
CREATE INDEX IF NOT EXISTS idx_fee_structures_grade ON fee_structures(grade_id);
CREATE INDEX IF NOT EXISTS idx_fee_structures_category ON fee_structures(category_id);
CREATE INDEX IF NOT EXISTS idx_fee_structures_year ON fee_structures(academic_year_id);

-- RLS for fee_structures
ALTER TABLE fee_structures ENABLE ROW LEVEL SECURITY;
CREATE POLICY fee_structures_isolation ON fee_structures
    FOR ALL USING (tenant_id = current_tenant_id());

-- learner_fee_options: tenant-scoped, per-learner optional fee selections
CREATE TABLE IF NOT EXISTS learner_fee_options (
    option_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    learner_id UUID NOT NULL REFERENCES learners(learner_id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES fee_categories(category_id) ON DELETE CASCADE,
    structure_id UUID NOT NULL REFERENCES fee_structures(structure_id) ON DELETE CASCADE,
    opted_in BOOLEAN DEFAULT FALSE,
    opted_at TIMESTAMP WITH TIME ZONE,
    opted_by UUID REFERENCES users(user_id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, learner_id, category_id, structure_id)
);

CREATE INDEX IF NOT EXISTS idx_learner_fee_options_tenant ON learner_fee_options(tenant_id);
CREATE INDEX IF NOT EXISTS idx_learner_fee_options_learner ON learner_fee_options(learner_id);

-- RLS for learner_fee_options
ALTER TABLE learner_fee_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY learner_fee_options_isolation ON learner_fee_options
    FOR ALL USING (tenant_id = current_tenant_id());

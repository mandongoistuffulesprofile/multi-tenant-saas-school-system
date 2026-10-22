-- Migration Slice 1: People & Structure
-- Extends schools table and creates calendar, staff, learner tables

-- Extend schools table with additional fields (M2)
ALTER TABLE schools ADD COLUMN IF NOT EXISTS knec_code VARCHAR(50);
ALTER TABLE schools ADD COLUMN IF NOT EXISTS kemis_code VARCHAR(50);
ALTER TABLE schools ADD COLUMN IF NOT EXISTS school_type VARCHAR(30) DEFAULT 'PRIVATE'; -- PUBLIC, PRIVATE, SNE
ALTER TABLE schools ADD COLUMN IF NOT EXISTS funding_mode VARCHAR(30) DEFAULT 'CUSTOM'; -- PUBLIC, PRIVATE, CUSTOM
ALTER TABLE schools ADD COLUMN IF NOT EXISTS county VARCHAR(100);
ALTER TABLE schools ADD COLUMN IF NOT EXISTS sub_county VARCHAR(100);
ALTER TABLE schools ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS logo_ref VARCHAR(255);
ALTER TABLE schools ADD COLUMN IF NOT EXISTS stamp_ref VARCHAR(255);
ALTER TABLE schools ADD COLUMN IF NOT EXISTS head_signature_ref VARCHAR(255);
ALTER TABLE schools ADD COLUMN IF NOT EXISTS default_locale VARCHAR(10) DEFAULT 'en';
ALTER TABLE schools ADD COLUMN IF NOT EXISTS hosts_junior BOOLEAN DEFAULT FALSE;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS license_tier VARCHAR(30) DEFAULT 'STANDARD';
ALTER TABLE schools ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_schools_county ON schools(county);
CREATE INDEX IF NOT EXISTS idx_schools_type ON schools(school_type);

-- school_settings table (tenant-scoped key-value config)
CREATE TABLE IF NOT EXISTS school_settings (
    setting_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    setting_key VARCHAR(100) NOT NULL,
    setting_value JSONB NOT NULL DEFAULT '{}',
    version INTEGER DEFAULT 1,
    updated_by UUID REFERENCES users(user_id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, setting_key)
);

CREATE INDEX IF NOT EXISTS idx_school_settings_tenant ON school_settings(tenant_id);

-- school_payment_channels table (M2, D-02 decided: one school, many channels)
CREATE TABLE IF NOT EXISTS school_payment_channels (
    channel_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    channel_type VARCHAR(20) NOT NULL, -- PAYBILL, TILL, BANK
    shortcode_or_account VARCHAR(50) NOT NULL,
    label VARCHAR(100) NOT NULL,
    environment VARCHAR(20) DEFAULT 'sandbox', -- sandbox, production
    is_default BOOLEAN DEFAULT FALSE,
    status VARCHAR(20) DEFAULT 'ACTIVE', -- ACTIVE, DISABLED
    reference_format VARCHAR(30) DEFAULT 'ADMISSION_NO', -- ADMISSION_NO, ADMISSION_NO+SUFFIX
    routed_fee_categories JSONB DEFAULT '[]', -- ["TUITION", "MEALS", ...]
    secret_refs JSONB DEFAULT '{}', -- write-only references to secret manager
    channel_token VARCHAR(100) UNIQUE NOT NULL, -- path token for webhook URLs
    c2b_registered BOOLEAN DEFAULT FALSE,
    c2b_registered_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_school_payment_channels_tenant ON school_payment_channels(tenant_id);
CREATE INDEX IF NOT EXISTS idx_school_payment_channels_shortcode ON school_payment_channels(shortcode_or_account);
CREATE INDEX IF NOT EXISTS idx_school_payment_channels_token ON school_payment_channels(channel_token);

-- school_finance_settings table (M2, D-03 decided: finance switches per school)
CREATE TABLE IF NOT EXISTS school_finance_settings (
    setting_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    tuition_invoicing BOOLEAN DEFAULT FALSE,
    optional_services BOOLEAN DEFAULT FALSE,
    capitation_tracking BOOLEAN DEFAULT FALSE,
    allowed_fee_categories JSONB DEFAULT '[]',
    arrears_reminders BOOLEAN DEFAULT TRUE,
    report_withholding BOOLEAN DEFAULT FALSE, -- D-04: default off
    gate_arrears_denial BOOLEAN DEFAULT FALSE, -- D-04: default off
    preset_label VARCHAR(30) DEFAULT 'CUSTOM', -- PUBLIC, PRIVATE, CUSTOM (label only)
    updated_by UUID REFERENCES users(user_id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_school_finance_settings_tenant ON school_finance_settings(tenant_id);

-- M3: academic_years
CREATE TABLE IF NOT EXISTS academic_years (
    year_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    year_label VARCHAR(20) NOT NULL, -- e.g., "2026"
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_current BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, year_label)
);

CREATE INDEX IF NOT EXISTS idx_academic_years_tenant ON academic_years(tenant_id);
CREATE INDEX IF NOT EXISTS idx_academic_years_current ON academic_years(tenant_id, is_current);

-- M3: terms
CREATE TABLE IF NOT EXISTS terms (
    term_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    year_id UUID NOT NULL REFERENCES academic_years(year_id) ON DELETE CASCADE,
    term_number INTEGER NOT NULL, -- 1, 2, 3
    term_label VARCHAR(50) NOT NULL, -- e.g., "Term 1"
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    midterm_start DATE,
    midterm_end DATE,
    is_current BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, year_id, term_number)
);

CREATE INDEX IF NOT EXISTS idx_terms_tenant ON terms(tenant_id);
CREATE INDEX IF NOT EXISTS idx_terms_year ON terms(year_id);
CREATE INDEX IF NOT EXISTS idx_terms_current ON terms(tenant_id, is_current);

-- M3: exam_windows
CREATE TABLE IF NOT EXISTS exam_windows (
    window_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    exam_type VARCHAR(30) NOT NULL, -- KPSEA, KJSEA, INTERNAL, OTHER
    window_label VARCHAR(100) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_exam_windows_tenant ON exam_windows(tenant_id);
CREATE INDEX IF NOT EXISTS idx_exam_windows_type ON exam_windows(exam_type);

-- M3: grades (global reference, no tenant_id)
CREATE TABLE IF NOT EXISTS grades (
    grade_id VARCHAR(20) PRIMARY KEY,
    grade_label VARCHAR(50) NOT NULL, -- PP1, PP2, G1, G2, ... G9
    level_band VARCHAR(20) NOT NULL, -- EYE, LOWER_PRIMARY, UPPER_PRIMARY, JSS
    lessons_per_week INTEGER NOT NULL
);

INSERT INTO grades (grade_id, grade_label, level_band, lessons_per_week) VALUES
('PP1', 'PP1', 'EYE', 25),
('PP2', 'PP2', 'EYE', 25),
('G1', 'Grade 1', 'LOWER_PRIMARY', 31),
('G2', 'Grade 2', 'LOWER_PRIMARY', 31),
('G3', 'Grade 3', 'LOWER_PRIMARY', 31),
('G4', 'Grade 4', 'UPPER_PRIMARY', 35),
('G5', 'Grade 5', 'UPPER_PRIMARY', 35),
('G6', 'Grade 6', 'UPPER_PRIMARY', 35),
('G7', 'Grade 7', 'JSS', 45),
('G8', 'Grade 8', 'JSS', 45),
('G9', 'Grade 9', 'JSS', 45)
ON CONFLICT (grade_id) DO NOTHING;

-- M3: streams
CREATE TABLE IF NOT EXISTS streams (
    stream_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    stream_name VARCHAR(50) NOT NULL, -- e.g., "Blue", "West", "Alpha"
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, stream_name)
);

CREATE INDEX IF NOT EXISTS idx_streams_tenant ON streams(tenant_id);

-- M3: class_groups
CREATE TABLE IF NOT EXISTS class_groups (
    class_group_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    year_id UUID NOT NULL REFERENCES academic_years(year_id) ON DELETE CASCADE,
    grade_id VARCHAR(20) NOT NULL REFERENCES grades(grade_id),
    stream_id UUID NOT NULL REFERENCES streams(stream_id) ON DELETE CASCADE,
    class_teacher_id UUID REFERENCES users(user_id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, year_id, grade_id, stream_id)
);

CREATE INDEX IF NOT EXISTS idx_class_groups_tenant ON class_groups(tenant_id);
CREATE INDEX IF NOT EXISTS idx_class_groups_year ON class_groups(year_id);
CREATE INDEX IF NOT EXISTS idx_class_groups_grade ON class_groups(grade_id);
CREATE INDEX IF NOT EXISTS idx_class_groups_teacher ON class_groups(class_teacher_id);

-- M3: staff_profiles
CREATE TABLE IF NOT EXISTS staff_profiles (
    profile_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    membership_id UUID NOT NULL REFERENCES tenant_memberships(membership_id) ON DELETE CASCADE,
    tsc_number VARCHAR(50), -- encrypted, optional
    national_id VARCHAR(50), -- encrypted, optional
    subjects JSONB DEFAULT '[]', -- array of subject IDs
    employment_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_staff_profiles_membership ON staff_profiles(membership_id);

-- M3: teaching_assignments
CREATE TABLE IF NOT EXISTS teaching_assignments (
    assignment_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    staff_membership_id UUID NOT NULL REFERENCES tenant_memberships(membership_id) ON DELETE CASCADE,
    class_group_id UUID NOT NULL REFERENCES class_groups(class_group_id) ON DELETE CASCADE,
    subject_id VARCHAR(50) NOT NULL, -- references cbc_learning_areas.subject_id
    academic_year_id UUID NOT NULL REFERENCES academic_years(year_id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, staff_membership_id, class_group_id, subject_id, academic_year_id)
);

CREATE INDEX IF NOT EXISTS idx_teaching_assignments_tenant ON teaching_assignments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_teaching_assignments_staff ON teaching_assignments(staff_membership_id);
CREATE INDEX IF NOT EXISTS idx_teaching_assignments_class ON teaching_assignments(class_group_id);

-- M4: learners
CREATE TABLE IF NOT EXISTS learners (
    learner_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    admission_number VARCHAR(50) NOT NULL,
    upi_nemis_number VARCHAR(50),
    first_name VARCHAR(100) NOT NULL,
    middle_name VARCHAR(100),
    last_name VARCHAR(100) NOT NULL,
    date_of_birth DATE,
    gender VARCHAR(20),
    birth_cert_no_enc TEXT, -- encrypted
    sne_enc TEXT, -- encrypted: Special Needs Education status
    photo_ref VARCHAR(255),
    status VARCHAR(30) DEFAULT 'ACTIVE', -- ACTIVE, TRANSFERRED_OUT, COMPLETED, WITHDRAWN, SUSPENDED
    admitted_on DATE,
    previous_school VARCHAR(150),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_tenant_admission_no UNIQUE(tenant_id, admission_number)
);

CREATE INDEX IF NOT EXISTS idx_learners_tenant ON learners(tenant_id);
CREATE INDEX IF NOT EXISTS idx_learners_admission ON learners(admission_number);
CREATE INDEX IF NOT EXISTS idx_learners_status ON learners(status);
CREATE INDEX IF NOT EXISTS idx_learners_upi ON learners(upi_nemis_number);

-- M4: guardians
CREATE TABLE IF NOT EXISTS guardians (
    guardian_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone_number VARCHAR(20) NOT NULL,
    alt_phone VARCHAR(20),
    id_no_enc TEXT, -- encrypted
    email VARCHAR(100),
    language VARCHAR(10) DEFAULT 'en',
    user_id UUID REFERENCES users(user_id), -- linked portal account
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_guardians_tenant ON guardians(tenant_id);
CREATE INDEX IF NOT EXISTS idx_guardians_phone ON guardians(phone_number);
CREATE INDEX IF NOT EXISTS idx_guardians_user ON guardians(user_id);

-- M4: learner_guardians
CREATE TABLE IF NOT EXISTS learner_guardians (
    link_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    learner_id UUID NOT NULL REFERENCES learners(learner_id) ON DELETE CASCADE,
    guardian_id UUID NOT NULL REFERENCES guardians(guardian_id) ON DELETE CASCADE,
    relationship VARCHAR(50) NOT NULL, -- father, mother, guardian, etc.
    is_primary_payer BOOLEAN DEFAULT FALSE,
    is_emergency_contact BOOLEAN DEFAULT FALSE,
    can_collect BOOLEAN DEFAULT FALSE,
    can_view_fees BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(learner_id, guardian_id)
);

CREATE INDEX IF NOT EXISTS idx_learner_guardians_learner ON learner_guardians(learner_id);
CREATE INDEX IF NOT EXISTS idx_learner_guardians_guardian ON learner_guardians(guardian_id);

-- M4: enrolments
CREATE TABLE IF NOT EXISTS enrolments (
    enrolment_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    learner_id UUID NOT NULL REFERENCES learners(learner_id) ON DELETE CASCADE,
    class_group_id UUID NOT NULL REFERENCES class_groups(class_group_id) ON DELETE CASCADE,
    year_id UUID NOT NULL REFERENCES academic_years(year_id) ON DELETE CASCADE,
    status VARCHAR(30) DEFAULT 'ACTIVE', -- ACTIVE, COMPLETED, WITHDRAWN, TRANSFERRED_OUT
    started_on DATE NOT NULL,
    ended_on DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, learner_id, year_id)
);

CREATE INDEX IF NOT EXISTS idx_enrolments_tenant ON enrolments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_enrolments_learner ON enrolments(learner_id);
CREATE INDEX IF NOT EXISTS idx_enrolments_class ON enrolments(class_group_id);
CREATE INDEX IF NOT EXISTS idx_enrolments_year ON enrolments(year_id);

-- M4: learner_status_history
CREATE TABLE IF NOT EXISTS learner_status_history (
    history_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    learner_id UUID NOT NULL REFERENCES learners(learner_id) ON DELETE CASCADE,
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    previous_status VARCHAR(30),
    new_status VARCHAR(30) NOT NULL,
    reason TEXT,
    changed_by UUID REFERENCES users(user_id),
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_learner_status_history_learner ON learner_status_history(learner_id);
CREATE INDEX IF NOT EXISTS idx_learner_status_history_tenant ON learner_status_history(tenant_id);

-- M4: transfers
CREATE TABLE IF NOT EXISTS transfers (
    transfer_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    learner_id UUID NOT NULL REFERENCES learners(learner_id) ON DELETE CASCADE,
    transfer_type VARCHAR(20) NOT NULL, -- transfer_out, transfer_in
    reason TEXT,
    destination_school VARCHAR(150),
    source_school VARCHAR(150),
    transfer_date DATE NOT NULL,
    created_by UUID REFERENCES users(user_id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_transfers_tenant ON transfers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_transfers_learner ON transfers(learner_id);

-- M4: import_batches
CREATE TABLE IF NOT EXISTS import_batches (
    batch_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    import_type VARCHAR(30) NOT NULL, -- learners, guardians, opening_balances
    file_name VARCHAR(255) NOT NULL,
    total_rows INTEGER DEFAULT 0,
    success_rows INTEGER DEFAULT 0,
    error_rows INTEGER DEFAULT 0,
    status VARCHAR(30) DEFAULT 'PENDING', -- PENDING, VALIDATED, COMMITTED, FAILED
    error_report_ref VARCHAR(255),
    created_by UUID REFERENCES users(user_id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    committed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_import_batches_tenant ON import_batches(tenant_id);
CREATE INDEX IF NOT EXISTS idx_import_batches_status ON import_batches(status);

-- M4: import_rows
CREATE TABLE IF NOT EXISTS import_rows (
    row_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    batch_id UUID NOT NULL REFERENCES import_batches(batch_id) ON DELETE CASCADE,
    row_number INTEGER NOT NULL,
    raw_data JSONB NOT NULL,
    is_valid BOOLEAN DEFAULT FALSE,
    error_message TEXT,
    committed BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_import_rows_batch ON import_rows(batch_id);
CREATE INDEX IF NOT EXISTS idx_import_rows_valid ON import_rows(is_valid);

-- RLS for all new tables
ALTER TABLE school_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_payment_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_finance_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE academic_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE streams ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE teaching_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE learners ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardians ENABLE ROW LEVEL SECURITY;
ALTER TABLE learner_guardians ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrolments ENABLE ROW LEVEL SECURITY;
ALTER TABLE learner_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_rows ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY school_settings_isolation ON school_settings
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true));

CREATE POLICY school_payment_channels_isolation ON school_payment_channels
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true));

CREATE POLICY school_finance_settings_isolation ON school_finance_settings
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true));

CREATE POLICY academic_years_isolation ON academic_years
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true));

CREATE POLICY terms_isolation ON terms
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true));

CREATE POLICY exam_windows_isolation ON exam_windows
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true));

CREATE POLICY streams_isolation ON streams
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true));

CREATE POLICY class_groups_isolation ON class_groups
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true));

CREATE POLICY staff_profiles_isolation ON staff_profiles
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM tenant_memberships tm
            WHERE tm.membership_id = staff_profiles.membership_id
            AND tm.tenant_id = current_setting('app.current_tenant_id', true)
        )
    );

CREATE POLICY teaching_assignments_isolation ON teaching_assignments
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true));

CREATE POLICY learners_isolation ON learners
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true));

CREATE POLICY guardians_isolation ON guardians
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true));

CREATE POLICY learner_guardians_isolation ON learner_guardians
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM learners l
            WHERE l.learner_id = learner_guardians.learner_id
            AND l.tenant_id = current_setting('app.current_tenant_id', true)
        )
    );

CREATE POLICY enrolments_isolation ON enrolments
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true));

CREATE POLICY learner_status_history_isolation ON learner_status_history
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true));

CREATE POLICY transfers_isolation ON transfers
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true));

CREATE POLICY import_batches_isolation ON import_batches
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true));

CREATE POLICY import_rows_isolation ON import_rows
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM import_batches ib
            WHERE ib.batch_id = import_rows.batch_id
            AND ib.tenant_id = current_setting('app.current_tenant_id', true)
        )
    );

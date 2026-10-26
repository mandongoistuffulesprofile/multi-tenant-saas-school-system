/* Domain schema (idempotent). Kept as one string so bootstrap is atomic. */
export const SCHEMA = `
    ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number VARCHAR(32);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS tsc_number VARCHAR(32);
    ALTER TABLE students ADD COLUMN IF NOT EXISTS stream VARCHAR(64);
    ALTER TABLE students ADD COLUMN IF NOT EXISTS status VARCHAR(16) DEFAULT 'ACTIVE';
    ALTER TABLE students ADD COLUMN IF NOT EXISTS guardian_name VARCHAR(191);
    ALTER TABLE students ADD COLUMN IF NOT EXISTS guardian_phone VARCHAR(32);
    ALTER TABLE students ADD COLUMN IF NOT EXISTS guardian_email VARCHAR(191);
    ALTER TABLE students ADD COLUMN IF NOT EXISTS upi_nemis_number VARCHAR(64);
    ALTER TABLE students ADD COLUMN IF NOT EXISTS photo_ref VARCHAR(128);
    DO $$ BEGIN
      ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
      ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check_ext;
      ALTER TABLE users ADD CONSTRAINT users_role_check_ext CHECK (
        role IN ('admin','teacher','accountant','parent','saas_admin','bom','system_admin','head','deputy','bursar','clerk'));
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    CREATE TABLE IF NOT EXISTS calendar_years (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      year_label VARCHAR(32) NOT NULL, year INTEGER,
      status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
      starts_at DATE, ends_at DATE, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS calendar_terms (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      year_id UUID REFERENCES calendar_years(id) ON DELETE CASCADE,
      term_label VARCHAR(64) NOT NULL, term_number INTEGER DEFAULT 1,
      starts_at DATE, ends_at DATE, status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS exam_windows (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      term_id UUID REFERENCES calendar_terms(id) ON DELETE CASCADE,
      window_label VARCHAR(64) NOT NULL, starts_at DATE, ends_at DATE,
      status VARCHAR(16) NOT NULL DEFAULT 'PLANNED',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now());

    CREATE TABLE IF NOT EXISTS fee_categories (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      code VARCHAR(32), name VARCHAR(128) NOT NULL, description VARCHAR(255),
      is_tuition BOOLEAN NOT NULL DEFAULT false, is_optional BOOLEAN NOT NULL DEFAULT false,
      requires_consent BOOLEAN NOT NULL DEFAULT false,
      is_active BOOLEAN NOT NULL DEFAULT true, is_custom BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS fee_structures (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      category_id UUID REFERENCES fee_categories(id) ON DELETE SET NULL,
      grade_label VARCHAR(64) NOT NULL,
      amount_per_term NUMERIC(12,2) NOT NULL DEFAULT 0,
      amount_per_year NUMERIC(12,2) NOT NULL DEFAULT 0,
      currency VARCHAR(8) NOT NULL DEFAULT 'KES',
      payment_frequency VARCHAR(16) NOT NULL DEFAULT 'PER_TERM',
      is_mandatory BOOLEAN NOT NULL DEFAULT true, due_day INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS invoices (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      student_id UUID REFERENCES students(id) ON DELETE CASCADE,
      invoice_number VARCHAR(48) NOT NULL, term_id VARCHAR(64),
      description VARCHAR(255), status VARCHAR(24) NOT NULL DEFAULT 'ISSUED',
      total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
      amount_outstanding NUMERIC(12,2) GENERATED ALWAYS AS (total_amount - amount_paid) STORED,
      due_date DATE, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_number ON invoices (invoice_number);
    CREATE TABLE IF NOT EXISTS payments (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      student_id UUID REFERENCES students(id) ON DELETE SET NULL,
      invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
      payment_reference VARCHAR(64) NOT NULL,
      source VARCHAR(16) NOT NULL DEFAULT 'CASH',
      status VARCHAR(24) NOT NULL DEFAULT 'COMPLETED',
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      learner_label VARCHAR(255), receipt_no VARCHAR(64),
      recorded_by UUID, recorded_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_reference ON payments (payment_reference);
    CREATE TABLE IF NOT EXISTS fee_credits (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      student_id UUID REFERENCES students(id) ON DELETE SET NULL,
      credit_reference VARCHAR(64) NOT NULL, learner_id UUID,
      learner_label VARCHAR(255), amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      reason VARCHAR(255), created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_reference ON fee_credits (credit_reference);
    CREATE TABLE IF NOT EXISTS fee_adjustments (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
      adjustment_reference VARCHAR(64) NOT NULL,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0, direction VARCHAR(8) NOT NULL DEFAULT 'ADJ_UP',
      reason VARCHAR(255), created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE UNIQUE INDEX IF NOT EXISTS uq_adjustment_reference ON fee_adjustments (adjustment_reference);
    CREATE TABLE IF NOT EXISTS fee_refunds (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
      refund_reference VARCHAR(64) NOT NULL, amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      status VARCHAR(16) NOT NULL DEFAULT 'REQUESTED',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_reference ON fee_refunds (refund_reference);
    CREATE TABLE IF NOT EXISTS reconciliation_runs (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      period_start DATE, period_end DATE, period VARCHAR(64),
      status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
      total_expected NUMERIC(12,2) NOT NULL DEFAULT 0,
      total_matched NUMERIC(12,2) NOT NULL DEFAULT 0,
      variance NUMERIC(12,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS mpesa_stk_requests (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      parent_user_id UUID, student_id UUID REFERENCES students(id) ON DELETE SET NULL,
      amount NUMERIC(12,2) NOT NULL, phone VARCHAR(32) NOT NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
      checkout_request_id VARCHAR(96), result_desc TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now());

    CREATE TABLE IF NOT EXISTS attendance_registers (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      register_date DATE NOT NULL, grade_label VARCHAR(64), stream_name VARCHAR(64),
      class_group_id VARCHAR(64), session_type VARCHAR(24) NOT NULL DEFAULT 'FULL_DAY',
      status VARCHAR(16) NOT NULL DEFAULT 'OPEN',
      created_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, register_date, grade_label, stream_name, session_type));
    CREATE TABLE IF NOT EXISTS attendance_marks (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      register_id UUID REFERENCES attendance_registers(id) ON DELETE CASCADE,
      student_id UUID REFERENCES students(id) ON DELETE CASCADE,
      status VARCHAR(16) NOT NULL DEFAULT 'PRESENT',
      marked_by UUID, marked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      device_id VARCHAR(96), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (register_id, student_id));
    CREATE TABLE IF NOT EXISTS assessment_events (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      title VARCHAR(255), grade_label VARCHAR(64),
      learning_area_id VARCHAR(128), learning_area VARCHAR(128),
      assessment_type VARCHAR(32) NOT NULL DEFAULT 'FORMATIVE',
      scoring_mode VARCHAR(24) NOT NULL DEFAULT 'RUBRIC',
      assessment_window VARCHAR(64), status VARCHAR(16) NOT NULL DEFAULT 'OPEN',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS streams (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      grade_label VARCHAR(64), name VARCHAR(64) NOT NULL);
    CREATE TABLE IF NOT EXISTS teaching_allocations (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      teacher_id UUID REFERENCES users(id) ON DELETE CASCADE,
      learning_area_id VARCHAR(128) NOT NULL, learning_area VARCHAR(128),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, teacher_id, learning_area_id));

    CREATE TABLE IF NOT EXISTS school_profile (
      tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
      school_type VARCHAR(32), funding_mode VARCHAR(32), county VARCHAR(96),
      postal_address VARCHAR(255), phone VARCHAR(32), email VARCHAR(128),
      motto VARCHAR(255), license_tier VARCHAR(32), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS finance_settings (
      tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
      paybill VARCHAR(32), invoice_prefix VARCHAR(16) DEFAULT 'INV',
      stk_enabled BOOLEAN NOT NULL DEFAULT true, late_fee NUMERIC(12,2) DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS integration_channels (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
      name VARCHAR(96) NOT NULL, channel VARCHAR(32) NOT NULL, provider VARCHAR(48),
      status VARCHAR(16) NOT NULL DEFAULT 'healthy', success_rate NUMERIC(5,2),
      callback_lag_ms INTEGER, queue_depth INTEGER DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS curriculum_versions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      code VARCHAR(64) NOT NULL, description VARCHAR(255),
      effective_from DATE, is_published BOOLEAN NOT NULL DEFAULT false);
    CREATE TABLE IF NOT EXISTS learning_areas (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
      version_id UUID REFERENCES curriculum_versions(id) ON DELETE CASCADE,
      code VARCHAR(32), name VARCHAR(128) NOT NULL,
      grade_band VARCHAR(16), sort_order INTEGER DEFAULT 0);

    CREATE TABLE IF NOT EXISTS report_templates (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      template_id VARCHAR(32) UNIQUE, name VARCHAR(128) NOT NULL, status VARCHAR(16) DEFAULT 'ACTIVE');
    CREATE TABLE IF NOT EXISTS report_cards (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      student_id UUID REFERENCES students(id) ON DELETE CASCADE,
      card_number VARCHAR(48), learner_id UUID, grade_id VARCHAR(64),
      term_label VARCHAR(64), overall_grade VARCHAR(4), percentage NUMERIC(5,1),
      position INTEGER, comment TEXT, status VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, student_id, term_label));

    CREATE TABLE IF NOT EXISTS notices (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      title VARCHAR(191) NOT NULL, message TEXT,
      channel VARCHAR(16) NOT NULL DEFAULT 'IN_APP', audience VARCHAR(16) NOT NULL DEFAULT 'PARENT',
      status VARCHAR(16) NOT NULL DEFAULT 'PUBLISHED', is_read BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS comms_templates (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      template_name VARCHAR(128) NOT NULL, channel VARCHAR(16) NOT NULL DEFAULT 'SMS',
      body_text TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    ALTER TABLE comms_templates ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
    CREATE TABLE IF NOT EXISTS comms_messages (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      recipient_type VARCHAR(16) NOT NULL DEFAULT 'GUARDIAN',
      channel VARCHAR(16) NOT NULL DEFAULT 'SMS',
      recipient_address VARCHAR(191) NOT NULL,
      body_text TEXT, status VARCHAR(16) NOT NULL DEFAULT 'QUEUED',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS comms_opt_outs (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      address VARCHAR(191) NOT NULL, channel VARCHAR(16) NOT NULL DEFAULT 'SMS');

    CREATE TABLE IF NOT EXISTS consent_notices (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      title VARCHAR(191) NOT NULL, description TEXT,
      version VARCHAR(16) NOT NULL DEFAULT 'v1', channel VARCHAR(32) NOT NULL DEFAULT 'IN_APP',
      is_required BOOLEAN NOT NULL DEFAULT true, is_optional BOOLEAN NOT NULL DEFAULT false,
      requires_consent BOOLEAN NOT NULL DEFAULT true,
      status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS consent_records (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      notice_id UUID REFERENCES consent_notices(id) ON DELETE CASCADE,
      purpose_label VARCHAR(191), parent_email VARCHAR(191),
      granted BOOLEAN NOT NULL DEFAULT true, notes VARCHAR(255),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS access_logs (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID, user_id UUID, user_email VARCHAR(191),
      action VARCHAR(32) NOT NULL, resource_type VARCHAR(32), resource_id VARCHAR(96),
      accessed_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS dsr_requests (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      requester_name VARCHAR(191), requester_contact VARCHAR(191),
      request_type VARCHAR(24) NOT NULL DEFAULT 'ACCESS',
      subject VARCHAR(255), status VARCHAR(16) NOT NULL DEFAULT 'OPEN',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), completed_at TIMESTAMPTZ);
    CREATE TABLE IF NOT EXISTS breach_register (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      breach_id VARCHAR(48), title VARCHAR(191) NOT NULL,
      severity VARCHAR(16) NOT NULL DEFAULT 'LOW', affected_count INTEGER DEFAULT 0,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      status VARCHAR(16) NOT NULL DEFAULT 'OPEN', notes TEXT);

    CREATE TABLE IF NOT EXISTS knec_tools (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tool_code VARCHAR(32) NOT NULL, name VARCHAR(128) NOT NULL,
      category VARCHAR(48), status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE');
    DELETE FROM knec_tools a USING knec_tools b
      WHERE a.tool_code = b.tool_code AND a.id > b.id;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_knec_tools_code ON knec_tools (tool_code);
    CREATE TABLE IF NOT EXISTS knec_submissions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      tool_id UUID REFERENCES knec_tools(id) ON DELETE SET NULL,
      period VARCHAR(32), status VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
      payload JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS knec_exports (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      tool_id UUID REFERENCES knec_tools(id) ON DELETE SET NULL,
      format VARCHAR(16) NOT NULL DEFAULT 'CSV',
      status VARCHAR(16) NOT NULL DEFAULT 'REQUESTED',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now());

    CREATE TABLE IF NOT EXISTS audit_log (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID, actor_id UUID, actor_email VARCHAR(191),
      action VARCHAR(32) NOT NULL, resource_type VARCHAR(32), resource_id VARCHAR(96),
      ip VARCHAR(64), detail TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at DESC);

    CREATE TABLE IF NOT EXISTS parent_children (
      parent_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      PRIMARY KEY (parent_user_id, student_id));
    CREATE TABLE IF NOT EXISTS password_resets (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      key VARCHAR(191) NOT NULL, token VARCHAR(96) NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL);
    ALTER TABLE password_resets ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
    CREATE INDEX IF NOT EXISTS idx_resets_key ON password_resets (key);
    CREATE INDEX IF NOT EXISTS idx_resets_token ON password_resets (token);

    INSERT INTO report_templates (template_id, name) VALUES ('standard_cbc','Standard CBC Report Card')
      ON CONFLICT (template_id) DO NOTHING;
    INSERT INTO curriculum_versions (code, description, effective_from, is_published)
    SELECT 'CBC 2024', 'Competency Based Curriculum 2024', '2024-01-01', true
    WHERE NOT EXISTS (SELECT 1 FROM curriculum_versions WHERE code = 'CBC 2024');
    INSERT INTO curriculum_versions (code, description, effective_from, is_published)
    SELECT 'CBC 2025 DRAFT', 'CBC 2025 revision under review', '2025-01-01', false
    WHERE NOT EXISTS (SELECT 1 FROM curriculum_versions WHERE code = 'CBC 2025 DRAFT');
    INSERT INTO learning_areas (version_id, code, name, grade_band, sort_order)
    SELECT v.id, a.code, a.name, a.band, a.sort
    FROM curriculum_versions v,
    (VALUES
      ('LA-ENG','English','LOWER',1),('LA-KIS','Kiswahili','LOWER',2),
      ('LA-MAT','Mathematics','LOWER',3),('LA-SCI','Science & Technology','UPPER',4),
      ('LA-SCR','Social Studies','UPPER',5),('LA-AGR','Agriculture','UPPER',6),
      ('LA-ART','Creative Arts','LOWER',7),('LA-PHE','Physical & Health Education','LOWER',8),
      ('LA-RES','Religious Education','LOWER',9)
    ) AS a(code, name, band, sort)
    WHERE v.code = 'CBC 2024' AND NOT EXISTS (SELECT 1 FROM learning_areas WHERE version_id = v.id);
    INSERT INTO knec_tools (tool_code, name, category) VALUES
      ('REG-PL','Registration of Candidates','PORTAL'),
      ('ADM-SLR','School Learner Register (SLR)','DATA'),
      ('KAP-EXP','KCPE/KAPSA Exam Registration','EXAM')
    ON CONFLICT (tool_code) DO NOTHING;
`;

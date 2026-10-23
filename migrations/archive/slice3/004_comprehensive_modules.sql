-- migrations/slice3/004_comprehensive_modules.sql
-- Guardians, Daily Attendance, KICD Sub-strands & Teacher Allocations

CREATE TABLE IF NOT EXISTS guardians (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    first_name VARCHAR(64) NOT NULL,
    last_name VARCHAR(64) NOT NULL,
    phone_number VARCHAR(20) NOT NULL,
    id_number VARCHAR(32),
    email VARCHAR(255),
    relationship VARCHAR(32) NOT NULL CHECK (relationship IN ('FATHER', 'MOTHER', 'LEGAL_GUARDIAN', 'SPONSOR')),
    is_primary_contact BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE guardians ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardians FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_guardians ON guardians
    FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS student_guardians (
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    guardian_id UUID NOT NULL REFERENCES guardians(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    PRIMARY KEY (student_id, guardian_id)
);

ALTER TABLE student_guardians ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_guardians FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_student_guardians ON student_guardians
    FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS attendance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    stream_id UUID NOT NULL REFERENCES class_streams(id) ON DELETE CASCADE,
    attendance_date DATE NOT NULL DEFAULT CURRENT_DATE,
    session VARCHAR(10) NOT NULL DEFAULT 'MORNING' CHECK (session IN ('MORNING', 'AFTERNOON')),
    status VARCHAR(10) NOT NULL CHECK (status IN ('PRESENT', 'ABSENT', 'EXCUSED', 'SICK')),
    remarks TEXT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_student_daily_attendance UNIQUE (tenant_id, student_id, attendance_date, session)
);

ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_attendance ON attendance_records
    FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS cbc_sub_strands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    strand_id UUID NOT NULL REFERENCES cbc_strands(id) ON DELETE CASCADE,
    title VARCHAR(150) NOT NULL,
    specific_learning_outcomes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE cbc_sub_strands ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbc_sub_strands FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_substrands ON cbc_sub_strands
    FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS teacher_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stream_id UUID NOT NULL REFERENCES class_streams(id) ON DELETE CASCADE,
    is_class_teacher BOOLEAN NOT NULL DEFAULT false,
    academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_teacher_stream UNIQUE (tenant_id, teacher_id, stream_id, academic_year_id)
);

ALTER TABLE teacher_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_allocations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_teacher_alloc ON teacher_allocations
    FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

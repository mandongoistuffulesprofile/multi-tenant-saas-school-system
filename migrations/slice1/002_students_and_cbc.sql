-- migrations/slice1/002_students_and_cbc.sql
-- Student Lifecycle and Event-Based CBC Assessment Schema

CREATE TABLE IF NOT EXISTS class_streams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    grade_level VARCHAR(20) NOT NULL, -- PP1, PP2, Grade 1 to 6
    stream_name VARCHAR(50) NOT NULL, -- e.g. East, West, Blue
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tenant_grade_stream UNIQUE (tenant_id, grade_level, stream_name)
);

ALTER TABLE class_streams ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_streams FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_streams ON class_streams
    FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    admission_number VARCHAR(64) NOT NULL,
    upi_nemis VARCHAR(32), -- MoE UPI/NEMIS identifier
    first_name VARCHAR(64) NOT NULL,
    last_name VARCHAR(64) NOT NULL,
    gender VARCHAR(10) NOT NULL CHECK (gender IN ('MALE', 'FEMALE')),
    date_of_birth DATE NOT NULL,
    current_stream_id UUID REFERENCES class_streams(id),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'TRANSFERRED', 'GRADUATED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tenant_admission UNIQUE (tenant_id, admission_number)
);

ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE students FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_students ON students
    FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS cbc_learning_areas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL, -- e.g. Mathematics, Kiswahili Language
    code VARCHAR(20) NOT NULL,
    grade_level VARCHAR(20) NOT NULL
);

ALTER TABLE cbc_learning_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbc_learning_areas FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_areas ON cbc_learning_areas
    FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS cbc_strands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    learning_area_id UUID NOT NULL REFERENCES cbc_learning_areas(id) ON DELETE CASCADE,
    title VARCHAR(150) NOT NULL
);

ALTER TABLE cbc_strands ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbc_strands FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_strands ON cbc_strands
    FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

-- CBC Append-Only Evaluation Events (Never overwrite prior ratings)
CREATE TABLE IF NOT EXISTS cbc_evaluation_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    strand_id UUID NOT NULL REFERENCES cbc_strands(id) ON DELETE CASCADE,
    teacher_id UUID NOT NULL REFERENCES users(id),
    rating VARCHAR(2) NOT NULL CHECK (rating IN ('EE', 'ME', 'AE', 'BE')),
    comments TEXT,
    assessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE cbc_evaluation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbc_evaluation_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_evaluations ON cbc_evaluation_events
    FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

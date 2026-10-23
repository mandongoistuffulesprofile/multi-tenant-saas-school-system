-- Migration 027: Create attendance and gate tables (M9)
-- attendance_registers: tenant-scoped attendance sessions
CREATE TABLE IF NOT EXISTS attendance_registers (
    register_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    class_group_id UUID NOT NULL REFERENCES class_groups(class_group_id) ON DELETE CASCADE,
    grade_id VARCHAR(20) NOT NULL REFERENCES grades(grade_id) ON DELETE CASCADE,
    stream_id UUID NOT NULL REFERENCES streams(stream_id) ON DELETE CASCADE,
    academic_year_id UUID NOT NULL REFERENCES academic_years(year_id) ON DELETE CASCADE,
    term_id UUID NOT NULL REFERENCES terms(term_id) ON DELETE CASCADE,
    register_date DATE NOT NULL,
    session_type VARCHAR(20) NOT NULL DEFAULT 'MORNING', -- MORNING, AFTERNOON, FULL_DAY
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN', -- OPEN, CLOSED, LOCKED
    marked_by UUID REFERENCES users(user_id),
    marked_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, class_group_id, register_date, session_type)
);

CREATE INDEX IF NOT EXISTS idx_attendance_registers_tenant ON attendance_registers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_attendance_registers_class ON attendance_registers(class_group_id);
CREATE INDEX IF NOT EXISTS idx_attendance_registers_date ON attendance_registers(register_date);
CREATE INDEX IF NOT EXISTS idx_attendance_registers_status ON attendance_registers(status);

-- RLS for attendance_registers
ALTER TABLE attendance_registers ENABLE ROW LEVEL SECURITY;
CREATE POLICY attendance_registers_isolation ON attendance_registers
    FOR ALL USING (tenant_id = current_tenant_id());

-- attendance_marks: individual learner marks
CREATE TABLE IF NOT EXISTS attendance_marks (
    mark_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    register_id UUID NOT NULL REFERENCES attendance_registers(register_id) ON DELETE CASCADE,
    learner_id UUID NOT NULL REFERENCES learners(learner_id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL, -- PRESENT, ABSENT, LATE, EXCUSED
    marked_by UUID REFERENCES users(user_id),
    marked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,
    UNIQUE(register_id, learner_id)
);

CREATE INDEX IF NOT EXISTS idx_attendance_marks_tenant ON attendance_marks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_attendance_marks_register ON attendance_marks(register_id);
CREATE INDEX IF NOT EXISTS idx_attendance_marks_learner ON attendance_marks(learner_id);
CREATE INDEX IF NOT EXISTS idx_attendance_marks_status ON attendance_marks(status);

-- RLS for attendance_marks
ALTER TABLE attendance_marks ENABLE ROW LEVEL SECURITY;
CREATE POLICY attendance_marks_isolation ON attendance_marks
    FOR ALL USING (tenant_id = current_tenant_id());

-- gate_devices: gate/kiosk devices
CREATE TABLE IF NOT EXISTS gate_devices (
    device_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    device_name VARCHAR(100) NOT NULL,
    device_type VARCHAR(30) NOT NULL DEFAULT 'KIOSK', -- KIOSK, MOBILE, RFID_READER
    location VARCHAR(100),
    pairing_code VARCHAR(20) UNIQUE NOT NULL,
    is_paired BOOLEAN DEFAULT FALSE,
    paired_at TIMESTAMP WITH TIME ZONE,
    paired_by UUID REFERENCES users(user_id),
    last_seen_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, INACTIVE, MAINTENANCE
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gate_devices_tenant ON gate_devices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_gate_devices_pairing ON gate_devices(pairing_code);
CREATE INDEX IF NOT EXISTS idx_gate_devices_status ON gate_devices(status);

-- RLS for gate_devices
ALTER TABLE gate_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY gate_devices_isolation ON gate_devices
    FOR ALL USING (tenant_id = current_tenant_id());

-- rfid_tags: RFID tags for learners/staff
CREATE TABLE IF NOT EXISTS rfid_tags (
    tag_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    tag_uid VARCHAR(50) NOT NULL UNIQUE,
    holder_type VARCHAR(20) NOT NULL, -- LEARNER, STAFF, VISITOR
    holder_id UUID NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    issued_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deactivated_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rfid_tags_tenant ON rfid_tags(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rfid_tags_uid ON rfid_tags(tag_uid);
CREATE INDEX IF NOT EXISTS idx_rfid_tags_holder ON rfid_tags(holder_type, holder_id);

-- RLS for rfid_tags
ALTER TABLE rfid_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY rfid_tags_isolation ON rfid_tags
    FOR ALL USING (tenant_id = current_tenant_id());

-- gate_events: gate entry/exit events
CREATE TABLE IF NOT EXISTS gate_events (
    event_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES gate_devices(device_id) ON DELETE CASCADE,
    tag_id UUID REFERENCES rfid_tags(tag_id) ON DELETE SET NULL,
    holder_type VARCHAR(20),
    holder_id UUID,
    event_type VARCHAR(20) NOT NULL, -- ENTRY, EXIT
    event_ts TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    verified BOOLEAN DEFAULT FALSE,
    verified_by UUID REFERENCES users(user_id),
    verified_at TIMESTAMP WITH TIME ZONE,
    raw_payload JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gate_events_tenant ON gate_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_gate_events_device ON gate_events(device_id);
CREATE INDEX IF NOT EXISTS idx_gate_events_tag ON gate_events(tag_id);
CREATE INDEX IF NOT EXISTS idx_gate_events_ts ON gate_events(event_ts);
CREATE INDEX IF NOT EXISTS idx_gate_events_type ON gate_events(event_type);

-- RLS for gate_events
ALTER TABLE gate_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY gate_events_isolation ON gate_events
    FOR ALL USING (tenant_id = current_tenant_id());

-- Migration 020: Create curriculum global tables + tenant_curriculum_pins (M5)
-- Curriculum tables are global (no tenant_id) per plan §2

-- curriculum_versions: versioned curriculum releases
CREATE TABLE IF NOT EXISTS curriculum_versions (
    version_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    version_label VARCHAR(50) NOT NULL UNIQUE, -- e.g. "CBC-2023", "CBC-2024"
    description TEXT,
    is_published BOOLEAN DEFAULT FALSE,
    effective_from DATE,
    effective_to DATE,
    created_by UUID REFERENCES users(user_id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_curriculum_versions_published ON curriculum_versions(is_published);
CREATE INDEX IF NOT EXISTS idx_curriculum_versions_label ON curriculum_versions(version_label);

-- learning_areas: global reference (e.g. Mathematics, English, Kiswahili)
CREATE TABLE IF NOT EXISTS learning_areas (
    area_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    version_id UUID NOT NULL REFERENCES curriculum_versions(version_id) ON DELETE CASCADE,
    code VARCHAR(20) NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    grade_band VARCHAR(20), -- e.g. "LOWER_PRIMARY", "UPPER_PRIMARY"
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(version_id, code)
);

CREATE INDEX IF NOT EXISTS idx_learning_areas_version ON learning_areas(version_id);
CREATE INDEX IF NOT EXISTS idx_learning_areas_code ON learning_areas(code);

-- strands: sub-divisions within learning areas
CREATE TABLE IF NOT EXISTS strands (
    strand_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    area_id UUID NOT NULL REFERENCES learning_areas(area_id) ON DELETE CASCADE,
    code VARCHAR(20) NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(area_id, code)
);

CREATE INDEX IF NOT EXISTS idx_strands_area ON strands(area_id);
CREATE INDEX IF NOT EXISTS idx_strands_code ON strands(code);

-- sub_strands: granular curriculum nodes within strands
CREATE TABLE IF NOT EXISTS sub_strands (
    sub_strand_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    strand_id UUID NOT NULL REFERENCES strands(strand_id) ON DELETE CASCADE,
    code VARCHAR(20) NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(strand_id, code)
);

CREATE INDEX IF NOT EXISTS idx_sub_strands_strand ON sub_strands(strand_id);
CREATE INDEX IF NOT EXISTS idx_sub_strands_code ON sub_strands(code);

-- node_mappings: cross-reference curriculum nodes to grades/streams
CREATE TABLE IF NOT EXISTS node_mappings (
    mapping_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sub_strand_id UUID NOT NULL REFERENCES sub_strands(sub_strand_id) ON DELETE CASCADE,
    grade_id VARCHAR(20) NOT NULL REFERENCES grades(grade_id) ON DELETE CASCADE,
    academic_year_id UUID NOT NULL REFERENCES academic_years(year_id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(sub_strand_id, grade_id, academic_year_id)
);

CREATE INDEX IF NOT EXISTS idx_node_mappings_sub_strand ON node_mappings(sub_strand_id);
CREATE INDEX IF NOT EXISTS idx_node_mappings_grade ON node_mappings(grade_id);
CREATE INDEX IF NOT EXISTS idx_node_mappings_year ON node_mappings(academic_year_id);

-- tenant_curriculum_pins: which curriculum version a school has pinned
CREATE TABLE IF NOT EXISTS tenant_curriculum_pins (
    pin_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    version_id UUID NOT NULL REFERENCES curriculum_versions(version_id) ON DELETE CASCADE,
    pinned_by UUID REFERENCES users(user_id),
    pinned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_curriculum_pins_tenant ON tenant_curriculum_pins(tenant_id);

-- RLS for tenant_curriculum_pins
ALTER TABLE tenant_curriculum_pins ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_curriculum_pins_isolation ON tenant_curriculum_pins
    FOR ALL USING (tenant_id = current_tenant_id());

-- Insert default curriculum version
INSERT INTO curriculum_versions (version_label, description, is_published) VALUES
    ('CBC-2024', 'Competency Based Curriculum 2024', TRUE)
ON CONFLICT (version_label) DO NOTHING;

-- Insert default learning areas for CBC
INSERT INTO learning_areas (version_id, code, name, description, grade_band, sort_order)
SELECT cv.version_id, v.code, v.name, v.description, v.grade_band, v.sort_order
FROM (VALUES
    ('MAT', 'Mathematics', 'Mathematics learning area', 'LOWER_PRIMARY', 1),
    ('ENG', 'English', 'English language', 'LOWER_PRIMARY', 2),
    ('KIS', 'Kiswahili', 'Kiswahili language', 'LOWER_PRIMARY', 3),
    ('SCI', 'Science and Technology', 'Science and technology', 'LOWER_PRIMARY', 4),
    ('SST', 'Social Studies', 'Social studies', 'LOWER_PRIMARY', 5),
    ('CRE', 'Christian Religious Education', 'CRE', 'LOWER_PRIMARY', 6),
    ('HRE', 'Human Rights Education', 'Human rights education', 'LOWER_PRIMARY', 7),
    ('ART', 'Arts and Crafts', 'Arts and crafts', 'LOWER_PRIMARY', 8),
    ('MUS', 'Music', 'Music education', 'LOWER_PRIMARY', 9),
    ('PHE', 'Physical and Health Education', 'PHE', 'LOWER_PRIMARY', 10)
) AS v(code, name, description, grade_band, sort_order)
CROSS JOIN curriculum_versions cv
WHERE cv.version_label = 'CBC-2024' AND cv.is_published
ON CONFLICT (version_id, code) DO NOTHING;

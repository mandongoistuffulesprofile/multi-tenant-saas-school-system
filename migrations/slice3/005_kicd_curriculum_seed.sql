-- migrations/slice3/005_kicd_curriculum_seed.sql
-- Default KICD Learning Areas and Strands for Kenyan CBC

-- Function to seed default KICD curricula for a tenant
CREATE OR REPLACE FUNCTION seed_default_kicd_curriculum(p_tenant_id UUID)
RETURNS VOID AS $$
DECLARE
    v_math_id UUID;
    v_eng_id UUID;
    v_swa_id UUID;
    v_sci_id UUID;
BEGIN
    -- 1. MATHEMATICS ACTIVITIES (Lower Primary: Grade 1-3)
    INSERT INTO cbc_learning_areas (tenant_id, name, code, grade_level)
    VALUES (p_tenant_id, 'Mathematics Activities', 'MATH_LP', 'Grade 1-3')
    RETURNING id INTO v_math_id;

    INSERT INTO cbc_strands (tenant_id, learning_area_id, title) VALUES
        (p_tenant_id, v_math_id, '1.0 Numbers (Number Concept, Whole Numbers, Addition, Subtraction)'),
        (p_tenant_id, v_math_id, '2.0 Measurement (Length, Mass, Capacity, Time, Money)'),
        (p_tenant_id, v_math_id, '3.0 Geometry (Lines, Shapes)');

    -- 2. ENGLISH LANGUAGE ACTIVITIES
    INSERT INTO cbc_learning_areas (tenant_id, name, code, grade_level)
    VALUES (p_tenant_id, 'English Language Activities', 'ENG_LP', 'Grade 1-3')
    RETURNING id INTO v_eng_id;

    INSERT INTO cbc_strands (tenant_id, learning_area_id, title) VALUES
        (p_tenant_id, v_eng_id, '1.0 Listening and Speaking'),
        (p_tenant_id, v_eng_id, '2.0 Reading (Phonics, Fluency, Comprehension)'),
        (p_tenant_id, v_eng_id, '3.0 Writing (Handwriting, Sentence Formation)');

    -- 3. KISWAHILI SHUGHULI ZA LUGHA
    INSERT INTO cbc_learning_areas (tenant_id, name, code, grade_level)
    VALUES (p_tenant_id, 'Kiswahili Shughuli za Lugha', 'SWA_LP', 'Grade 1-3')
    RETURNING id INTO v_swa_id;

    INSERT INTO cbc_strands (tenant_id, learning_area_id, title) VALUES
        (p_tenant_id, v_swa_id, '1.0 Kusikiliza na Kuzungumza'),
        (p_tenant_id, v_swa_id, '2.0 Kusoma (Kutambua Sauti, Kusoma kwa Ufahamu)'),
        (p_tenant_id, v_swa_id, '3.0 Kuandika (Hati Safi na Tungo Fupi)');

    -- 4. SCIENCE & TECHNOLOGY (Upper Primary: Grade 4-6)
    INSERT INTO cbc_learning_areas (tenant_id, name, code, grade_level)
    VALUES (p_tenant_id, 'Science and Technology', 'SCI_UP', 'Grade 4-6')
    RETURNING id INTO v_sci_id;

    INSERT INTO cbc_strands (tenant_id, learning_area_id, title) VALUES
        (p_tenant_id, v_sci_id, '1.0 Living Things (Plants, Animals, Human Body)'),
        (p_tenant_id, v_sci_id, '2.0 Environment and Cleanliness'),
        (p_tenant_id, v_sci_id, '3.0 Digital Technology and Coding Basics');

END;
$$ LANGUAGE plpgsql;

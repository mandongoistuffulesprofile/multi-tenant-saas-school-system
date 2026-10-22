-- migrations/slice3/006_bootstrap_demo_school.sql
-- Bootstrap Seed for Hillcrest Academy (Demo School)

DO $$
DECLARE
    v_tenant_id UUID;
    v_year_id UUID;
    v_term1_id UUID;
    v_stream_id UUID;
    v_student1_id UUID;
    -- Argon2id hash for 'Password123!'
    v_pwd_hash VARCHAR := '$argon2id$v=19$m=65536,t=1,p=4$vB87kX8s9o1H5e9u7t6r5A$wX4y8Z9v0A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q';
BEGIN
    -- 1. Create Demo Tenant if not exists
    INSERT INTO tenants (name, subdomain, school_code, status)
    VALUES ('Hillcrest Academy', 'demo', 'HA-2026', 'ACTIVE')
    ON CONFLICT (subdomain) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO v_tenant_id;

    -- 2. Create Default Head Teacher
    INSERT INTO users (tenant_id, email, phone_number, password_hash, first_name, last_name, role, is_active)
    VALUES (v_tenant_id, 'admin@shuleyetu.ke', '+254712345678', v_pwd_hash, 'Mwalimu', 'Kariuki', 'HEAD_TEACHER', true)
    ON CONFLICT (tenant_id, email) DO NOTHING;

    -- 3. Academic Year 2026
    INSERT INTO academic_years (tenant_id, year_name, start_date, end_date, is_current)
    VALUES (v_tenant_id, '2026', '2026-01-05', '2026-11-20', true)
    ON CONFLICT (tenant_id, year_name) DO UPDATE SET is_current = true
    RETURNING id INTO v_year_id;

    -- 4. Term 1 (Current)
    INSERT INTO terms (tenant_id, academic_year_id, term_number, start_date, end_date, is_current)
    VALUES (v_tenant_id, v_year_id, 1, '2026-01-05', '2026-04-03', true)
    ON CONFLICT (tenant_id, academic_year_id, term_number) DO UPDATE SET is_current = true
    RETURNING id INTO v_term1_id;

    -- 5. Standard Streams
    INSERT INTO class_streams (tenant_id, grade_level, stream_name)
    VALUES (v_tenant_id, 'Grade 3', 'East')
    ON CONFLICT (tenant_id, grade_level, stream_name) DO NOTHING
    RETURNING id INTO v_stream_id;

    -- 6. Seed KICD Curricula for this Tenant
    PERFORM seed_default_kicd_curriculum(v_tenant_id);

    -- 7. Sample Learners
    INSERT INTO students (tenant_id, admission_number, upi_nemis, first_name, last_name, gender, date_of_birth, current_stream_id)
    VALUES 
        (v_tenant_id, 'ADM-001', 'UPI789123', 'Juma', 'Omondi', 'MALE', '2017-04-12', v_stream_id),
        (v_tenant_id, 'ADM-002', 'UPI456789', 'Achieng', 'Nekesa', 'FEMALE', '2017-06-25', v_stream_id),
        (v_tenant_id, 'ADM-003', 'UPI123456', 'Mwangi', 'Kamau', 'MALE', '2017-09-08', v_stream_id)
    ON CONFLICT (tenant_id, admission_number) DO NOTHING;

END $$;

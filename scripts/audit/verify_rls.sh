#!/usr/bin/env bash
# Verifies RLS enforcement by attempting cross-tenant reads
set -e

DB_URL=${DATABASE_URL:-"postgres://postgres:postgres@localhost:5432/school_saas?sslmode=disable"}

echo "Running RLS boundary checks..."
psql "$DB_URL" << 'SQL'
DO $$
DECLARE
    tenant_a UUID;
    tenant_b UUID;
    student_count INT;
BEGIN
    -- Setup two sandbox tenants
    INSERT INTO tenants (name, subdomain) VALUES ('School A', 'school-a') RETURNING id INTO tenant_a;
    INSERT INTO tenants (name, subdomain) VALUES ('School B', 'school-b') RETURNING id INTO tenant_b;

    -- Insert student under School A
    PERFORM set_config('app.current_tenant_id', tenant_a::text, true);
    INSERT INTO students (tenant_id, admission_number, first_name, last_name, grade_level)
    VALUES (tenant_a, 'ADM-001', 'Kamau', 'Njoroge', 'Grade 3');

    -- Switch context to School B and query
    PERFORM set_config('app.current_tenant_id', tenant_b::text, true);
    SELECT COUNT(*) INTO student_count FROM students;

    IF student_count > 0 THEN
        RAISE EXCEPTION 'RLS LEAK DETECTED: School B accessed % records from School A!', student_count;
    ELSE
        RAISE NOTICE 'RLS AUDIT PASSED: Zero cross-tenant records exposed.';
    END IF;

    -- Clean up test rollback
    RAISE EXCEPTION 'Rollback test cleanly' USING ERRCODE = 'check_violation';
EXCEPTION
    WHEN check_violation THEN
        RAISE NOTICE 'Test completed successfully and sandboxed.';
END $$;
SQL

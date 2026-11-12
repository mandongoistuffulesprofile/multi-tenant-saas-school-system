-- 0030_rls_remaining_tables.sql — close the last tenant tables without RLS.
--
-- 0009_force_rls.sql covers every table that existed at the time, and 0028
-- adds the platform-admin bypass. Five later tables carry tenant_id but were
-- never enrolled in FORCE RLS. Their handlers filter by tenant_id explicitly,
-- so this is defence in depth rather than a live leak, but the schema should
-- not have exceptions.
--
-- password_assistance_requests is the one deliberate widening: the public
-- "ask a platform administrator" endpoint has no session tenant, and a global
-- account may have no membership. That table therefore allows tenant_id IS
-- NULL as well as the request tenant; the handler sets app.current_tenant_id
-- transaction-locally before writing.

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'delegated_entry_tokens',
        'export_audit_logs',
        'mpesa_holding_tank',
        'password_assistance_requests',
        'platform_tenant_onboarding'
    ]
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);

        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_isolation', t);
        IF t = 'password_assistance_requests' THEN
            EXECUTE format(
                'CREATE POLICY %I ON public.%I USING (tenant_id IS NULL OR tenant_id = current_tenant_id()) WITH CHECK (tenant_id IS NULL OR tenant_id = current_tenant_id())',
                t || '_isolation', t);
        ELSE
            EXECUTE format(
                'CREATE POLICY %I ON public.%I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
                t || '_isolation', t);
        END IF;

        EXECUTE format('DROP POLICY IF EXISTS platform_admin_bypass ON public.%I', t);
        EXECUTE format(
            'CREATE POLICY platform_admin_bypass ON public.%I USING (current_setting(''app.current_user_role'', true) IN (''SAAS_ADMIN'', ''SUPER_ADMIN''))',
            t);
    END LOOP;
END $$;

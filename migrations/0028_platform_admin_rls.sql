-- 0028_platform_admin_rls.sql — let platform administrators read across tenants.
--
-- Tenant policies compare tenant_id with app.current_tenant_id. A SaaS admin's
-- only membership is the platform-ops tenant, so under FORCE ROW LEVEL SECURITY
-- every school-level query (learner counts, subscriptions, invoices, audit
-- events, onboarding) returned just platform-ops. The console needs the full
-- registry.
--
-- TenantTxMiddleware sets app.current_user_role = 'SAAS_ADMIN' for signed
-- sessions carrying SAAS_ADMIN or SUPER_ADMIN, inside the same request
-- transaction as the tenant GUC. This permissive policy is OR-ed with the
-- existing isolation policy, so it widens access only for those sessions.
--
-- set_config(..., true) is transaction-local, so the flag cannot leak to the
-- next request that checks out the same pooled connection.

DO $$
DECLARE
    tbl record;
BEGIN
    FOR tbl IN
        SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id'
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p')
          AND c.relrowsecurity
          AND NOT a.attisdropped
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS platform_admin_bypass ON public.%I', tbl.relname);
        EXECUTE format(
            'CREATE POLICY platform_admin_bypass ON public.%I USING (current_setting(''app.current_user_role'', true) IN (''SAAS_ADMIN'', ''SUPER_ADMIN''))',
            tbl.relname);
    END LOOP;
END $$;

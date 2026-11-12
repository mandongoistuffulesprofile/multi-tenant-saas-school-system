-- 0037_tenant_isolation_policies.sql
--
-- 0009_force_rls.sql enabled + forced RLS on every table carrying tenant_id,
-- but it never created a tenant-scoped policy. 0028 then added only the
-- platform-admin bypass. The result on a fresh/live database was that ordinary
-- school sessions were denied their own rows on schools, learners, invoices and
-- every other table without a hand-written policy.
--
-- This creates the standard isolation policy on every RLS-enabled table that
-- has a tenant_id. Policies are permissive and OR-ed with any existing ones,
-- so the platform-admin bypass and the hand-written policies keep working.
-- Creating the policy on a table that already narrows access can only add the
-- same-tenant case, never widen it.

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
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', tbl.relname);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON public.%I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
            tbl.relname);
    END LOOP;
END $$;

-- 0062_staff_profiles_tenant_scope.sql — put staff profiles under tenant RLS.
--
-- 0042 created staff_profiles with no tenant_id and no policies. The staff API
-- already treats the table as tenant-scoped: its UPDATE filters on
-- `tenant_id` (which did not exist, so every profile edit failed) and the
-- INSERT left the tenant implicit. Without a tenant_id column RLS cannot scope
-- the table at all, which left TSC numbers, national IDs and employment dates
-- readable by every tenant connection.
--
-- The parent membership owns the tenant, so existing rows are backfilled from
-- it. A profile always has a membership (the FK is NOT NULL and cascades), so
-- the backfill covers every row.

ALTER TABLE public.staff_profiles ADD COLUMN IF NOT EXISTS tenant_id character varying(50);

-- tenant_memberships has been under forced RLS since 0060, so the role running
-- this migration cannot read the memberships it has to copy the tenant from.
-- The join silently matches nothing, every tenant_id stays NULL, and the
-- NOT NULL below fails on any database that already has profiles — which is
-- every real one. Read them through the platform-admin bypass the policies
-- already define, for this transaction only.
SET LOCAL app.current_user_role = 'SAAS_ADMIN';

UPDATE public.staff_profiles sp
   SET tenant_id = tm.tenant_id
  FROM public.tenant_memberships tm
 WHERE tm.membership_id = sp.membership_id
   AND sp.tenant_id IS NULL;

SET LOCAL app.current_user_role = DEFAULT;

ALTER TABLE public.staff_profiles ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_staff_profiles_tenant
    ON public.staff_profiles (tenant_id);

ALTER TABLE public.staff_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_profiles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_staff_profiles ON public.staff_profiles;
CREATE POLICY tenant_isolation_staff_profiles ON public.staff_profiles
    FOR ALL USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS platform_admin_staff_profiles ON public.staff_profiles;
CREATE POLICY platform_admin_staff_profiles ON public.staff_profiles
    FOR ALL USING (current_setting('app.current_user_role', true) = ANY (ARRAY['SAAS_ADMIN', 'SUPER_ADMIN']))
    WITH CHECK (current_setting('app.current_user_role', true) = ANY (ARRAY['SAAS_ADMIN', 'SUPER_ADMIN']));

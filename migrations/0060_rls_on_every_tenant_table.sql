-- 0060_rls_on_every_tenant_table.sql — close the two gaps a catalog-wide check found.
--
-- cmd/rlscheck enumerates every table with a tenant_id column and requires three
-- things of each: RLS enabled, RLS forced (otherwise the owning role bypasses
-- its own policies), and both a tenant_isolation and a platform_admin_bypass
-- policy. Run against the schema as it stood after 0059, that check found two
-- exceptions out of 104 tables:
--
--   * subscriptions — created by 0056 with row-level security deliberately left
--     off, because the platform console reads it across tenants. The bypass
--     policy 0056 said it "should not guess at" is the same one every other
--     tenant table already carries, keyed on app.current_user_role, so guess it
--     now: SAAS_ADMIN and SUPER_ADMIN keep their cross-tenant view, and every
--     other role sees only its own school's subscription.
--   * invite_tokens — had policies but no FORCE, so a connection as the table
--     owner read every tenant's invite tokens.
--
-- Nothing here changes a query: the console and the invite flow already run
-- through the tenant transaction, which sets app.current_tenant_id and, for
-- platform staff, app.current_user_role.

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON subscriptions;
CREATE POLICY tenant_isolation ON subscriptions
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS platform_admin_bypass ON subscriptions;
CREATE POLICY platform_admin_bypass ON subscriptions
    USING (current_setting('app.current_user_role', true) IN ('SAAS_ADMIN', 'SUPER_ADMIN'));

ALTER TABLE invite_tokens FORCE ROW LEVEL SECURITY;

COMMENT ON TABLE subscriptions IS
'Per-tenant plan; cross-tenant reads are limited to the platform_admin_bypass policy.';

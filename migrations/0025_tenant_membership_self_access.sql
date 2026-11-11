-- Allow a user to enumerate their own tenant memberships before a tenant has
-- been selected (login and school picker). tenant_memberships is FORCE-RLS
-- protected, so without this policy the login lookup sees zero rows and every
-- sign-in fails with NO_ACTIVE_SCHOOL.
--
-- This only exposes rows for the authenticated user id set in the request
-- transaction by the auth handler; tenant-scoped access is still governed by
-- tenant_memberships_isolation.

DROP POLICY IF EXISTS tenant_memberships_self_select ON public.tenant_memberships;

CREATE POLICY tenant_memberships_self_select ON public.tenant_memberships
    FOR SELECT
    USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

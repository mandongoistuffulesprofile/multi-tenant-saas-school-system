-- 0041_login_school_visibility.sql
--
-- Sign-in resolves the user's schools before a tenant has been selected, but
-- schools is FORCE-RLS protected and the tenant policy has no GUC to match, so
-- the membership JOIN returned zero rows and every non-superuser login failed
-- with NO_ACTIVE_SCHOOL.
--
-- The auth handler sets app.current_user_id inside the login transaction. This
-- policy exposes only the school rows for that user's active memberships; the
-- tenant policy and platform-admin bypass are permissive and continue to work.
-- tenant_memberships is itself filtered by tenant_memberships_self_select, so
-- the EXISTS can only see the same user's memberships.

DROP POLICY IF EXISTS schools_member_select ON public.schools;

CREATE POLICY schools_member_select ON public.schools
    FOR SELECT
    USING (
        NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL
        AND EXISTS (
            SELECT 1
              FROM public.tenant_memberships tm
             WHERE tm.tenant_id = schools.tenant_id
               AND tm.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
               AND tm.status = 'ACTIVE'
        )
    );

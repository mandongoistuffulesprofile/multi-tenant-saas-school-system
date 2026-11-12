-- 0031_auth_lookup_function.sql — remove the login path's SAAS_ADMIN GUC.
--
-- Login used to run
--   SELECT set_config('app.current_user_role', 'SAAS_ADMIN', true)
-- before reading users. That was transaction-local, but it put cross-tenant
-- privilege state into the most exposed request path. The lookup itself only
-- needs one row from the global users table, so encapsulate it in a definer
-- function and expose nothing else.
--
-- The function is owned by the migration/app role. On this deployment that
-- role also owns the schema, so the definer can read users without a session
-- role GUC. The login handler still resolves tenant_memberships in its own
-- transaction scoped by app.current_user_id (0025).
--
-- Only executable roles are granted; PUBLIC is revoked because the return value
-- contains a password hash.

CREATE OR REPLACE FUNCTION public.auth_lookup_credentials(p_identifier text)
RETURNS TABLE (user_id text, password_hash text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT u.user_id::text, u.password_hash
      FROM public.users u
     WHERE u.is_active = true
       AND (u.email_norm = LOWER(p_identifier)
            OR LOWER(u.email) = LOWER(p_identifier)
            OR u.phone_number = p_identifier)
     ORDER BY (u.email IS NOT NULL AND LOWER(u.email) = LOWER(p_identifier)) DESC,
              (u.phone_number = p_identifier) DESC,
              u.created_at DESC
     LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.auth_lookup_credentials(text) FROM PUBLIC;

DO $$
BEGIN
    EXECUTE format(
        'GRANT EXECUTE ON FUNCTION public.auth_lookup_credentials(text) TO %I',
        current_user);

    -- Production compose runs the migrator and the API as the same role, but
    -- keep an explicit grant for the documented production role.
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skulapp_app') THEN
        GRANT EXECUTE ON FUNCTION public.auth_lookup_credentials(text) TO skulapp_app;
    END IF;
END $$;

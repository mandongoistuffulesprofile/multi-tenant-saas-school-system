-- 0051_schools_worker_select.sql
--
-- The nightly reconciliation worker enumerates tenants from schools, the same
-- way the M-Pesa worker enumerates mpesa_inbox. But schools has only the
-- standard tenant policy (tenant_id = current_tenant_id()) plus the sign-in
-- policy, and the worker sets app.worker without a tenant — so it matched no
-- rows, reconciled nothing, and reported "no discrepancies". A check that
-- silently covers zero tenants is worse than no check, because it reads as
-- proof that the books balance.
--
-- mpesa_raw_inbox already has exactly this escape hatch for the same reason
-- (0003), so this follows the established pattern rather than inventing one.
-- The policy is permissive and OR-ed with the existing ones: it grants no
-- access to anything except the school list, and only to a session that has
-- deliberately set app.worker = 'on'. The API never runs user-supplied SQL.

DROP POLICY IF EXISTS schools_worker_select ON public.schools;

CREATE POLICY schools_worker_select ON public.schools
    FOR SELECT
    USING (current_setting('app.worker', true) = 'on');

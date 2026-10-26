-- Migration 0012: audit_events RLS on parent + immutability trigger
-- The parent partitioned table audit_events already has tenant_id.
-- 0009_force_rls.sql already ran ALTER TABLE ... FORCE ROW LEVEL SECURITY,
-- but without a parent policy all SELECTs returned zero rows.
-- Add a parent isolation policy (checked before partition routing in PG15+).
-- Also add a trigger to block UPDATE/DELETE for the application role.

-- Parent isolation policy (tenants see only their rows)
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_events_isolation ON public.audit_events;
CREATE POLICY audit_events_isolation ON public.audit_events
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- Default partition also needs the policy (created by 0002)
ALTER TABLE public.audit_events_default ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_events_default_isolation ON public.audit_events_default;
CREATE POLICY audit_events_default_isolation ON public.audit_events_default
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- Function to prevent UPDATE/DELETE on audit_events for the app role.
-- The migration / admin role (bypasses) is SUPERUSER so not affected.
-- Any UPDATE/DELETE attempt raises exception with code 'P0001'.
CREATE OR REPLACE FUNCTION public.audit_events_prevent_modification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'audit_events is append-only: % not allowed', TG_OP
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_events_immutable ON public.audit_events;
CREATE TRIGGER audit_events_immutable
    BEFORE UPDATE OR DELETE ON public.audit_events
    FOR EACH ROW EXECUTE FUNCTION public.audit_events_prevent_modification();
-- 0049_gate_tables.sql
--
-- The gate feature has had handlers for devices, tags and events, but the live
-- schema only ever had part of it. 0001_baseline creates gate_devices and
-- gate_events (without indexes), and rfid_tags exists only in
-- migrations/archive/slice5/027_create_attendance_gate_tables.sql, which the
-- checksummed runner never applies. On a database built from this directory
-- issuing a tag and GET /gate/tags therefore failed outright, and the device and
-- event lists did a tenant scan plus sort.
--
-- This fills the gap: it creates rfid_tags (same shape as the archived table,
-- following the live conventions — gen_random_uuid(), no foreign keys, a
-- tenant_id NOT NULL check) and adds the indexes the list endpoints need. Each
-- index leads with tenant_id and ends with the column the endpoint sorts by:
--
--   GET /gate/devices  WHERE tenant_id = $1 ORDER BY device_name
--   GET /gate/tags     WHERE tenant_id = $1 ORDER BY tag_uid
--   GET /gate/events   WHERE tenant_id = $1 ORDER BY event_ts DESC LIMIT 100
--
-- tag_uid is unique per tenant rather than globally: two schools may issue the
-- same physical badge number, and one school must not be able to block another
-- from issuing a tag. The pair is also what the scan lookup uses.
--
-- RLS uses the standard names from 0028/0037 (platform_admin_bypass and
-- tenant_isolation), so the two existing gate tables keep exactly one policy of
-- each and rfid_tags starts out matching them.

CREATE TABLE IF NOT EXISTS public.rfid_tags (
    tag_id         uuid DEFAULT gen_random_uuid(),
    tenant_id      character varying(50) NOT NULL,
    tag_uid        character varying(50) NOT NULL,
    holder_type    character varying(20) NOT NULL, -- LEARNER, STAFF, GUARDIAN
    holder_id      uuid NOT NULL,
    is_active      boolean DEFAULT true,
    issued_at      timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    deactivated_at timestamp with time zone,
    created_at     timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at     timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE public.rfid_tags ALTER COLUMN holder_type SET NOT NULL;

-- A database that already created rfid_tags by hand from the archived file may
-- carry these constraints under other names, so only add what is missing.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = 'rfid_tags' AND c.contype = 'p'
    ) THEN
        ALTER TABLE public.rfid_tags ADD CONSTRAINT pk_rfid_tags PRIMARY KEY (tag_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = 'rfid_tags' AND c.conname = 'chk_rfid_tags_tenant_not_null'
    ) THEN
        ALTER TABLE public.rfid_tags
            ADD CONSTRAINT chk_rfid_tags_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
        ALTER TABLE public.rfid_tags VALIDATE CONSTRAINT chk_rfid_tags_tenant_not_null;
    END IF;
END $$;

-- A terminal's pairing code is the token an operator types into the kiosk, so it
-- has to be unique across the deployment, not just within a school.
CREATE UNIQUE INDEX IF NOT EXISTS uq_gate_devices_pairing_code
    ON public.gate_devices (pairing_code);

-- List order, plus the lookup ScanGate does for an active terminal.
CREATE INDEX IF NOT EXISTS idx_gate_devices_tenant_name
    ON public.gate_devices (tenant_id, device_name);
CREATE INDEX IF NOT EXISTS idx_gate_devices_tenant_status
    ON public.gate_devices (tenant_id, status);

-- Serves both the tag list (sorted by tag_uid) and the scan lookup by UID.
CREATE UNIQUE INDEX IF NOT EXISTS uq_rfid_tags_tenant_uid
    ON public.rfid_tags (tenant_id, tag_uid);
CREATE INDEX IF NOT EXISTS idx_rfid_tags_tenant_holder
    ON public.rfid_tags (tenant_id, holder_type, holder_id);

-- The event list reads the newest 100 for one tenant; device and tag lookups are
-- how an operator traces one terminal or one badge.
CREATE INDEX IF NOT EXISTS idx_gate_events_tenant_ts
    ON public.gate_events (tenant_id, event_ts DESC);
CREATE INDEX IF NOT EXISTS idx_gate_events_tenant_device
    ON public.gate_events (tenant_id, device_id);
CREATE INDEX IF NOT EXISTS idx_gate_events_tenant_tag
    ON public.gate_events (tenant_id, tag_id);

-- Same RLS model as every other tenant table: enabled and forced, one isolation
-- policy against current_tenant_id(), and the platform-admin bypass from 0028.
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['gate_devices', 'rfid_tags', 'gate_events']
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);

        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON public.%I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
            t);

        EXECUTE format('DROP POLICY IF EXISTS platform_admin_bypass ON public.%I', t);
        EXECUTE format(
            'CREATE POLICY platform_admin_bypass ON public.%I USING (current_setting(''app.current_user_role'', true) IN (''SAAS_ADMIN'', ''SUPER_ADMIN''))',
            t);
    END LOOP;
END $$;

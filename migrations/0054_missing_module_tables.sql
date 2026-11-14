-- ============================================================================
-- 0054_missing_module_tables.sql
-- ============================================================================
-- Eleven tables that live code reads and writes were never created, so the
-- features behind them failed on every call: teaching assignments, RFID tags,
-- CBC strands and sub-strands, tenant curriculum pins, retention policies,
-- sync logs and conflicts, tenant usage, assessment weighting profiles and
-- in-kind settings.
--
-- Each table below is shaped from the statements the code already runs, not
-- from an idealised model, so no query has to change beyond the timestamp
-- casts noted in the accompanying commit. Tenant-scoped tables get the same
-- row-level security contract as the rest of the schema.
--
-- It also seeds the three ledger accounts that opening balances post against.
-- Until now opening balances looked for chart_of_accounts, which does not
-- exist, and journal_lines.account_id is NOT NULL, so the feature could not
-- post an entry at all.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Teaching assignments (structure + teacher-scoped assessment)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.teaching_assignments (
    assignment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    staff_membership_id uuid NOT NULL
        REFERENCES public.tenant_memberships (membership_id) ON DELETE CASCADE,
    class_group_id uuid NOT NULL
        REFERENCES public.class_groups (class_group_id) ON DELETE CASCADE,
    -- A subject is identified either by a learning area code or by its area_id
    -- rendered as text; both shapes are matched in the authorisation query.
    subject_id text NOT NULL,
    academic_year_id uuid
        REFERENCES public.academic_years (year_id) ON DELETE CASCADE,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_teaching_assignments_tenant
    ON public.teaching_assignments (tenant_id, class_group_id);

ALTER TABLE public.teaching_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teaching_assignments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS teaching_assignments_isolation ON public.teaching_assignments;
CREATE POLICY teaching_assignments_isolation ON public.teaching_assignments
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- ----------------------------------------------------------------------------
-- 2. RFID tags (kiosk attendance)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rfid_tags (
    tag_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    tag_uid character varying(100) NOT NULL,
    holder_type character varying(20) NOT NULL,
    holder_id uuid NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    issued_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deactivated_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_rfid_tags_tenant_uid
    ON public.rfid_tags (tenant_id, tag_uid);

ALTER TABLE public.rfid_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rfid_tags FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rfid_tags_isolation ON public.rfid_tags;
CREATE POLICY rfid_tags_isolation ON public.rfid_tags
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- ----------------------------------------------------------------------------
-- 3. CBC strands and sub-strands (curriculum reference data)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.strands (
    strand_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    area_id uuid NOT NULL REFERENCES public.learning_areas (area_id) ON DELETE CASCADE,
    code character varying(50) NOT NULL,
    name character varying(200) NOT NULL,
    description text,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_strands_area_code
    ON public.strands (area_id, code);

CREATE TABLE IF NOT EXISTS public.sub_strands (
    sub_strand_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    strand_id uuid NOT NULL REFERENCES public.strands (strand_id) ON DELETE CASCADE,
    code character varying(50) NOT NULL,
    name character varying(200) NOT NULL,
    description text,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sub_strands_strand_code
    ON public.sub_strands (strand_id, code);

CREATE INDEX IF NOT EXISTS idx_sub_strands_strand
    ON public.sub_strands (strand_id, sort_order);

-- ----------------------------------------------------------------------------
-- 4. Tenant curriculum pin
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_curriculum_pins (
    pin_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL UNIQUE
        REFERENCES public.schools (tenant_id) ON DELETE CASCADE,
    version_id uuid NOT NULL
        REFERENCES public.curriculum_versions (version_id) ON DELETE CASCADE,
    pinned_by uuid,
    pinned_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.tenant_curriculum_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_curriculum_pins FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_curriculum_pins_isolation ON public.tenant_curriculum_pins;
CREATE POLICY tenant_curriculum_pins_isolation ON public.tenant_curriculum_pins
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- ----------------------------------------------------------------------------
-- 5. Data retention policies
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.retention_policies (
    policy_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    resource_type character varying(60) NOT NULL,
    retention_days integer NOT NULL,
    action_after_retention character varying(20) NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_by uuid,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT retention_policies_days_positive_chk CHECK (retention_days > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_retention_policies_tenant_resource
    ON public.retention_policies (tenant_id, resource_type);

ALTER TABLE public.retention_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retention_policies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS retention_policies_isolation ON public.retention_policies;
CREATE POLICY retention_policies_isolation ON public.retention_policies
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- ----------------------------------------------------------------------------
-- 6. Offline sync log and conflicts
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sync_log (
    sync_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    -- Devices identify themselves with an opaque string; not every device has
    -- a row in devices yet, so this is deliberately not a foreign key.
    device_id text,
    sync_type character varying(30) NOT NULL,
    items_sent integer NOT NULL DEFAULT 0,
    conflicts integer NOT NULL DEFAULT 0,
    status character varying(20) NOT NULL DEFAULT 'IN_PROGRESS',
    started_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS idx_sync_log_tenant_started
    ON public.sync_log (tenant_id, started_at DESC);

ALTER TABLE public.sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sync_log_isolation ON public.sync_log;
CREATE POLICY sync_log_isolation ON public.sync_log
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS public.sync_conflicts (
    conflict_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    entity_type character varying(50) NOT NULL,
    entity_id text NOT NULL,
    client_version integer NOT NULL DEFAULT 0,
    server_version integer NOT NULL DEFAULT 0,
    client_values jsonb NOT NULL DEFAULT '{}'::jsonb,
    server_values jsonb NOT NULL DEFAULT '{}'::jsonb,
    resolved boolean NOT NULL DEFAULT false,
    resolution_values jsonb,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sync_conflicts_tenant_open
    ON public.sync_conflicts (tenant_id, created_at DESC)
    WHERE resolved = false;

ALTER TABLE public.sync_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_conflicts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sync_conflicts_isolation ON public.sync_conflicts;
CREATE POLICY sync_conflicts_isolation ON public.sync_conflicts
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- ----------------------------------------------------------------------------
-- 7. Tenant usage (platform billing view)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_usage (
    usage_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    period_month date NOT NULL,
    active_learners integer NOT NULL DEFAULT 0,
    active_staff integer NOT NULL DEFAULT 0,
    sms_sent integer NOT NULL DEFAULT 0,
    reports_generated integer NOT NULL DEFAULT 0,
    assessments_recorded integer NOT NULL DEFAULT 0,
    payments_processed integer NOT NULL DEFAULT 0,
    gate_taps integer NOT NULL DEFAULT 0,
    storage_mb integer NOT NULL DEFAULT 0,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_usage_period
    ON public.tenant_usage (tenant_id, period_month);

ALTER TABLE public.tenant_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_usage FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_usage_isolation ON public.tenant_usage;
CREATE POLICY tenant_usage_isolation ON public.tenant_usage
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- ----------------------------------------------------------------------------
-- 8. Assessment weighting profiles (global reference data)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.weighting_profiles (
    profile_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name character varying(120) NOT NULL,
    description text,
    grade_id text,
    weights jsonb NOT NULL DEFAULT '{}'::jsonb,
    is_default boolean NOT NULL DEFAULT false,
    created_by uuid,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_weighting_profiles_grade
    ON public.weighting_profiles (grade_id, name);

-- ----------------------------------------------------------------------------
-- 9. Admin in-kind settings
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_in_kind_settings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    setting_key character varying(100) NOT NULL,
    setting_value jsonb NOT NULL,
    description text,
    updated_by uuid,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_in_kind_settings_key
    ON public.admin_in_kind_settings (tenant_id, setting_key);

ALTER TABLE public.admin_in_kind_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_in_kind_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_in_kind_settings_isolation ON public.admin_in_kind_settings;
CREATE POLICY admin_in_kind_settings_isolation ON public.admin_in_kind_settings
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- ----------------------------------------------------------------------------
-- 10. Opening-balance ledger accounts
-- ----------------------------------------------------------------------------
-- Opening balances post against receivable, inventory and opening equity. The
-- application role cannot create accounts per tenant, so they are seeded here
-- for every school that already exists; onboarding seeds them for new schools.
INSERT INTO public.ledger_accounts (tenant_id, code, name, type)
SELECT s.tenant_id, v.code, v.name, v.type
FROM public.schools s
CROSS JOIN (VALUES
    ('1100', 'Fee Receivable', 'ASSET'),
    ('1200', 'Inventory', 'ASSET'),
    ('3900', 'Opening Balance Equity', 'EQUITY')
) AS v(code, name, type)
WHERE NOT EXISTS (
    SELECT 1 FROM public.ledger_accounts la
    WHERE la.tenant_id = s.tenant_id AND la.code = v.code
);

-- ----------------------------------------------------------------------------
-- Grants for the application role, following the 0031/0053 pattern.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    t text;
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skulapp_app') THEN
        FOREACH t IN ARRAY ARRAY[
            'teaching_assignments', 'rfid_tags', 'strands', 'sub_strands',
            'tenant_curriculum_pins', 'retention_policies', 'sync_log',
            'sync_conflicts', 'tenant_usage', 'weighting_profiles',
            'admin_in_kind_settings'
        ] LOOP
            EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO skulapp_app', t);
        END LOOP;
    END IF;
END $$;

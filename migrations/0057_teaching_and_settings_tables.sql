-- 0057_teaching_and_settings_tables.sql — restore five tenant tables the
-- handlers query but no numbered migration creates.
--
-- The archived slice schemas (migrations/archive/slice1, slice3, slice4) defined
-- these tables, but they were never carried into the active chain, so a database
-- built from migrations alone answered:
--
--   GET  /structure/teaching-assignments  -> relation "teaching_assignments" does not exist
--   GET  /school/finance-settings         -> relation "school_finance_settings" does not exist
--   GET  /sync/conflicts                  -> relation "sync_conflicts" does not exist
--   GET  /compliance/retention-policies   -> relation "retention_policies" does not exist
--   GET  /platform/usage                  -> relation "tenant_usage" does not exist
--
-- plus POST /structure/teaching-assignments and POST /platform/tenants, which
-- writes school_finance_settings inside the tenant-creation transaction.
--
-- The shapes below are the archived definitions, with the column names the
-- queries actually use (checked against internal/structure, internal/school,
-- internal/sync, internal/compliance and internal/platform), so no query has to
-- change. `uuid_generate_v4()` is replaced with `gen_random_uuid()` to match the
-- rest of the chain.

-- Teaching assignments: who teaches which subject to which class group.
CREATE TABLE IF NOT EXISTS teaching_assignments (
    assignment_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    staff_membership_id UUID NOT NULL REFERENCES tenant_memberships(membership_id) ON DELETE CASCADE,
    class_group_id      UUID NOT NULL REFERENCES class_groups(class_group_id) ON DELETE CASCADE,
    subject_id          VARCHAR(50) NOT NULL,
    academic_year_id    UUID NOT NULL REFERENCES academic_years(year_id) ON DELETE CASCADE,
    created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, staff_membership_id, class_group_id, subject_id, academic_year_id)
);

CREATE INDEX IF NOT EXISTS idx_teaching_assignments_tenant ON teaching_assignments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_teaching_assignments_staff ON teaching_assignments(staff_membership_id);
CREATE INDEX IF NOT EXISTS idx_teaching_assignments_class ON teaching_assignments(class_group_id);
CREATE INDEX IF NOT EXISTS idx_teaching_assignments_subject ON teaching_assignments(tenant_id, subject_id);

-- Per-school finance switches. One row per tenant, upserted by
-- PUT /school/finance-settings and seeded when a tenant is created.
CREATE TABLE IF NOT EXISTS school_finance_settings (
    setting_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id              VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    tuition_invoicing      BOOLEAN NOT NULL DEFAULT FALSE,
    optional_services      BOOLEAN NOT NULL DEFAULT FALSE,
    capitation_tracking    BOOLEAN NOT NULL DEFAULT FALSE,
    allowed_fee_categories JSONB NOT NULL DEFAULT '[]'::jsonb,
    arrears_reminders      BOOLEAN NOT NULL DEFAULT TRUE,
    report_withholding     BOOLEAN NOT NULL DEFAULT FALSE,
    gate_arrears_denial    BOOLEAN NOT NULL DEFAULT FALSE,
    preset_label           VARCHAR(30) NOT NULL DEFAULT 'CUSTOM',
    updated_by             UUID REFERENCES users(user_id),
    updated_at             TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at             TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_school_finance_settings_tenant ON school_finance_settings(tenant_id);

-- Offline sync: rows the server and a device both changed. Written by the sync
-- handler when a client's base version is stale, read by /sync/conflicts and
-- closed by the resolution endpoint.
CREATE TABLE IF NOT EXISTS sync_conflicts (
    conflict_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    entity_type       VARCHAR(50) NOT NULL,
    entity_id         UUID NOT NULL,
    client_version    INTEGER NOT NULL,
    server_version    INTEGER NOT NULL,
    client_values     JSONB NOT NULL DEFAULT '{}'::jsonb,
    server_values     JSONB NOT NULL DEFAULT '{}'::jsonb,
    resolved          BOOLEAN NOT NULL DEFAULT FALSE,
    resolution_values JSONB DEFAULT '{}'::jsonb,
    resolved_by       UUID REFERENCES users(user_id),
    resolved_at       TIMESTAMP WITH TIME ZONE,
    created_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sync_conflicts_tenant ON sync_conflicts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_entity ON sync_conflicts(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_resolved ON sync_conflicts(resolved);

-- Data-protection retention policy per resource type.
CREATE TABLE IF NOT EXISTS retention_policies (
    policy_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id              VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    resource_type          VARCHAR(50) NOT NULL,
    retention_days         INTEGER NOT NULL,
    action_after_retention VARCHAR(30) NOT NULL,
    is_active              BOOLEAN NOT NULL DEFAULT TRUE,
    created_by             UUID REFERENCES users(user_id),
    created_at             TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at             TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, resource_type)
);

CREATE INDEX IF NOT EXISTS idx_retention_policies_tenant ON retention_policies(tenant_id);

-- Monthly utilisation figures shown on the platform console.
CREATE TABLE IF NOT EXISTS tenant_usage (
    usage_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    period_month         VARCHAR(7) NOT NULL,
    active_learners      INTEGER NOT NULL DEFAULT 0,
    active_staff         INTEGER NOT NULL DEFAULT 0,
    sms_sent             INTEGER NOT NULL DEFAULT 0,
    reports_generated    INTEGER NOT NULL DEFAULT 0,
    assessments_recorded INTEGER NOT NULL DEFAULT 0,
    payments_processed   INTEGER NOT NULL DEFAULT 0,
    gate_taps            INTEGER NOT NULL DEFAULT 0,
    storage_mb           INTEGER NOT NULL DEFAULT 0,
    created_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, period_month)
);

CREATE INDEX IF NOT EXISTS idx_tenant_usage_tenant ON tenant_usage(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_usage_period ON tenant_usage(period_month);

-- Tenant isolation, same policy pair as the rest of the tenant tables
-- (see 0055_school_settings.sql): rows are visible only inside the tenant
-- transaction, with a bypass for the platform console.
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'teaching_assignments', 'school_finance_settings', 'sync_conflicts',
        'retention_policies', 'tenant_usage'
    ] LOOP
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

COMMENT ON TABLE teaching_assignments IS
'Teacher-to-class-group subject allocation; read by /structure and checked before an assessment event is opened.';
COMMENT ON TABLE school_finance_settings IS
'Per-tenant finance switches, one row per school.';
COMMENT ON TABLE sync_conflicts IS
'Offline sync conflicts awaiting KEEP_MINE/KEEP_THEIRS resolution.';
COMMENT ON TABLE retention_policies IS
'Per-resource retention window and the action taken when it elapses.';
COMMENT ON TABLE tenant_usage IS
'Monthly per-tenant utilisation counters shown on the platform console.';

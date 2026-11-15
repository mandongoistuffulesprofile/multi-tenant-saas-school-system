-- 0055_school_settings.sql
--
-- Per-tenant key/value settings, including the grading scale override that
-- internal/grading reads and writes under the key 'grading_config'.
--
-- The table exists in the archived slice1 schema but was never carried into the
-- numbered migration chain, so a database built from migrations had no
-- school_settings at all: saving the grading config failed with
-- `relation "school_settings" does not exist` and the report snapshot test could
-- not run. This migration creates it with the shape the queries expect
-- (tenant_id, setting_key, setting_value jsonb, version, updated_by) and the same
-- tenant isolation policy as the rest of the tenant tables.

CREATE TABLE IF NOT EXISTS public.school_settings (
    setting_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     VARCHAR(50) NOT NULL REFERENCES public.schools(tenant_id) ON DELETE CASCADE,
    setting_key   VARCHAR(100) NOT NULL,
    setting_value JSONB NOT NULL DEFAULT '{}'::jsonb,
    version       INTEGER NOT NULL DEFAULT 1,
    updated_by    UUID REFERENCES public.users(user_id),
    updated_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, setting_key)
);

CREATE INDEX IF NOT EXISTS idx_school_settings_tenant ON public.school_settings (tenant_id);

ALTER TABLE public.school_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_settings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.school_settings;
CREATE POLICY tenant_isolation ON public.school_settings
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS platform_admin_bypass ON public.school_settings;
CREATE POLICY platform_admin_bypass ON public.school_settings
    USING (current_setting('app.current_user_role', true) IN ('SAAS_ADMIN', 'SUPER_ADMIN'));

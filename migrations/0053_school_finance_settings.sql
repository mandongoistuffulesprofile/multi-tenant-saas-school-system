-- ============================================================================
-- 0053_school_finance_settings.sql
-- ============================================================================
-- The finance module switches were stored in a table that was never created.
-- Two live paths write it:
--
--   * platform tenant provisioning, which inserts a row for every new school
--     inside the same transaction that creates the school, so onboarding could
--     never commit; and
--   * the school settings API, so a bursar could not enable tuition invoicing,
--     optional services, capitation tracking or arrears reminders at all.
--
-- The columns below are exactly the ones the two queries read and write. Every
-- switch defaults to the conservative value: optional services, capitation and
-- withholding off, arrears reminders on (the behaviour the API documents when
-- no row exists).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.school_finance_settings (
    tenant_id character varying(50) PRIMARY KEY
        REFERENCES public.schools (tenant_id) ON DELETE CASCADE,
    tuition_invoicing boolean NOT NULL DEFAULT false,
    optional_services boolean NOT NULL DEFAULT false,
    capitation_tracking boolean NOT NULL DEFAULT false,
    -- Fee categories the school is allowed to bill, by code. An empty array
    -- means no restriction beyond the fee structure itself.
    allowed_fee_categories jsonb NOT NULL DEFAULT '[]'::jsonb,
    arrears_reminders boolean NOT NULL DEFAULT true,
    report_withholding boolean NOT NULL DEFAULT false,
    gate_arrears_denial boolean NOT NULL DEFAULT false,
    preset_label character varying(50) NOT NULL DEFAULT 'CUSTOM',
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT school_finance_settings_categories_array_chk
        CHECK (jsonb_typeof(allowed_fee_categories) = 'array')
);

-- RLS: same isolation contract as every other tenant table.
ALTER TABLE public.school_finance_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_finance_settings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS school_finance_settings_isolation ON public.school_finance_settings;
CREATE POLICY school_finance_settings_isolation ON public.school_finance_settings
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- Schools that already exist have no row because none could be written; give
-- them the documented defaults so the settings screen opens with a row it can
-- edit rather than a synthetic one.
INSERT INTO public.school_finance_settings (tenant_id)
SELECT s.tenant_id FROM public.schools s
ON CONFLICT (tenant_id) DO NOTHING;

-- Match the grant pattern used by 0031: the application role needs privileges
-- on a new table, and it is only present in some environments.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skulapp_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_finance_settings TO skulapp_app;
    END IF;
END $$;

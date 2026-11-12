-- 0036_report_template_config.sql
--
-- report_templates is written and read with is_active, template_config and
-- created_by, and the tenant-isolation test seeds all three. The baseline only
-- declared the name/type/band/is_default columns, so every template write
-- failed on a live database with "column does not exist".

ALTER TABLE public.report_templates
    ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS template_config jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS created_by uuid;

-- The write path maps a duplicate template name to 409. That needs a unique
-- constraint to fire; scope it per tenant and make it case-insensitive.
CREATE UNIQUE INDEX IF NOT EXISTS uq_report_templates_tenant_name
    ON public.report_templates (tenant_id, lower(template_name))
    WHERE tenant_id IS NOT NULL;

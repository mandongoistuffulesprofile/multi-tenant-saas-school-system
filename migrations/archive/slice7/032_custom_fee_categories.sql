-- 032: per-school custom fee categories
--
-- fee_categories previously held only the eight global defaults and was
-- read-only. Schools need their own fee types (e.g. "Lunch", "Swimming",
-- "ICT Levy") that are invisible to other schools.
--
-- tenant_id NULL  -> global default category, available to every school
-- tenant_id SET   -> custom category owned by that school
--
-- The original UNIQUE(code) constraint is replaced by a composite one so two
-- schools may use the same code for their own category.

BEGIN;

ALTER TABLE fee_categories ADD COLUMN IF NOT EXISTS tenant_id varchar(50);

-- Replace the global unique constraint with a per-school one.
ALTER TABLE fee_categories DROP CONSTRAINT IF EXISTS fee_categories_code_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_fee_categories_tenant_code
    ON fee_categories (COALESCE(tenant_id, ''), code);

CREATE INDEX IF NOT EXISTS idx_fee_categories_tenant
    ON fee_categories (tenant_id);

-- Categories created by a school are soft-deletable so that fee structures,
-- invoice lines and learner fee options that already reference them keep
-- working. Global categories cannot be deleted, only deactivated.
ALTER TABLE fee_categories ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

COMMIT;

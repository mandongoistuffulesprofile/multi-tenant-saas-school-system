-- Migration 0011: onboarding fields for the tenant/school root
-- Additive only. Tenant RLS (FORCE ROW LEVEL SECURITY) is already applied to
-- every table with a tenant_id column via migrations/0009_force_rls.sql.

-- is_demo: demo tenants get a banner + snapshot/reset capability; never used
-- for production tenant isolation.
ALTER TABLE public.schools
  ADD COLUMN is_demo boolean NOT NULL DEFAULT false;

-- NEMIS school code (optional, never required for go-live). Partial unique
-- index keeps uniqueness only when populated; a school admin never sees the
-- match for another school (no name leak).
ALTER TABLE public.schools
  ADD COLUMN nemis_code character varying(40);

CREATE UNIQUE INDEX uq_schools_nemis ON public.schools (upper(nemis_code))
  WHERE nemis_code IS NOT NULL;

-- RLS policy for the new column isn't required per-column; table-level policy
-- already applies (tenant_id filter via current_setting). Force RLS via the
-- loop in migrations/0009_force_rls.sql automatically covers this table.

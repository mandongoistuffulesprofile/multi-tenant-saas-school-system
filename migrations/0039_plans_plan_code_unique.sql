-- 0039_plans_plan_code_unique.sql
--
-- 0029_create_plans.sql was edited in place to create this index before its
-- seed INSERT ... ON CONFLICT (plan_code). Databases that legitimately applied
-- the original 0029 already have the seeded rows but not the index, and the
-- migrate checksum adoption deliberately does not re-run the file. This
-- migration makes both paths converge.

CREATE UNIQUE INDEX IF NOT EXISTS uq_plans_plan_code ON public.plans (plan_code);

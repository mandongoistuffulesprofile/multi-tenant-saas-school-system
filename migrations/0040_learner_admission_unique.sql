-- 0040_learner_admission_unique.sql
--
-- Admission numbers identify a learner within a school, and the demo seed,
-- enrolment API and imports all rely on ON CONFLICT (tenant_id,
-- admission_number). That key was never declared, so seeding failed and
-- duplicate admissions were possible. Add the tenant-scoped unique key.

CREATE UNIQUE INDEX IF NOT EXISTS uq_learners_tenant_admission
    ON public.learners (tenant_id, admission_number);

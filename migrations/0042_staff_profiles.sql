-- 0042_staff_profiles.sql
--
-- The staff API joins and upserts public.staff_profiles, but the table only
-- existed in the archived pre-baseline migration set. Every GET /staff (and
-- therefore the dashboard's Promise.all) failed with "relation does not
-- exist". Recreate the live shape the handler expects.

CREATE TABLE IF NOT EXISTS public.staff_profiles (
    profile_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    membership_id uuid NOT NULL UNIQUE
        REFERENCES public.tenant_memberships (membership_id) ON DELETE CASCADE,
    tsc_number character varying(50),
    national_id character varying(50),
    subjects jsonb NOT NULL DEFAULT '[]'::jsonb,
    employment_date date,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_profiles_membership
    ON public.staff_profiles (membership_id);

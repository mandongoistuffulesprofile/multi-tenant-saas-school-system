-- ============================================================================
-- 0035_kenyan_customization.sql — tenant-level Kenyan academia customization
-- ============================================================================
--
-- Aligned with the live schema rather than the design sketch:
--   * learners            (not "students"); admission_number, grade via enrolments
--   * fee_categories      (already the tenant chart of fee accounts)
--   * fee_structures      (already grade/category/year; residence_type is added)
--   * schools             (already knec_code, nemis_code, county, logo/stamp refs)
--   * terms               (not an integer "term" column on an invoice matrix)
--
-- Sensitive learner fields already exist encrypted (birth_cert_no_enc,
-- sne_enc) and are deliberately NOT duplicated as plaintext. Only the
-- non-sensitive SNE *category* is added.
--
-- fee_structures.residence_type is nullable on purpose: NULL means "applies to
-- every residence type", so existing school-wide structures keep working after
-- this migration. New boarder/day-only rows carry an explicit value.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Learner residence type + Ministry of Education / KNEC identifiers
-- ----------------------------------------------------------------------------
ALTER TABLE public.learners
    ADD COLUMN IF NOT EXISTS residence_type character varying(30) NOT NULL DEFAULT 'DAY_SCHOLAR_WITH_LUNCH',
    ADD COLUMN IF NOT EXISTS kemis_upi character varying(20),
    ADD COLUMN IF NOT EXISTS knec_assessment_no character varying(30),
    ADD COLUMN IF NOT EXISTS sne_category character varying(50) NOT NULL DEFAULT 'NONE',
    ADD COLUMN IF NOT EXISTS transport_zone_id uuid,
    ADD COLUMN IF NOT EXISTS transport_trip_type character varying(20) NOT NULL DEFAULT 'NONE';

-- Backfill the richer residence vocabulary from the legacy two-value column.
UPDATE public.learners
SET residence_type = 'BOARDER_FULL'
WHERE boarding_type = 'BOARDING'
  AND residence_type = 'DAY_SCHOLAR_WITH_LUNCH';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.learners'::regclass
          AND conname = 'learners_residence_type_chk'
    ) THEN
        ALTER TABLE public.learners
            ADD CONSTRAINT learners_residence_type_chk CHECK (
                residence_type IN (
                    'DAY_SCHOLAR_NO_LUNCH',
                    'DAY_SCHOLAR_WITH_LUNCH',
                    'BOARDER_FULL',
                    'BOARDER_WEEKLY'
                )
            ) NOT VALID;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.learners'::regclass
          AND conname = 'learners_transport_trip_type_chk'
    ) THEN
        ALTER TABLE public.learners
            ADD CONSTRAINT learners_transport_trip_type_chk CHECK (
                transport_trip_type IN ('NONE', 'ONE_WAY_AM', 'ONE_WAY_PM', 'TWO_WAY')
            ) NOT VALID;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.learners'::regclass
          AND conname = 'learners_sne_category_chk'
    ) THEN
        ALTER TABLE public.learners
            ADD CONSTRAINT learners_sne_category_chk CHECK (
                sne_category IN (
                    'NONE', 'GIFTED', 'VISUAL', 'HEARING', 'PHYSICAL', 'NEURODIVERSE', 'MULTIPLE'
                )
            ) NOT VALID;
    END IF;
END $$;

ALTER TABLE public.learners VALIDATE CONSTRAINT learners_residence_type_chk;
ALTER TABLE public.learners VALIDATE CONSTRAINT learners_transport_trip_type_chk;
ALTER TABLE public.learners VALIDATE CONSTRAINT learners_sne_category_chk;

-- National identifiers are unique inside a school, never across schools.
-- Blank strings are excluded so an unfilled optional field never collides.
CREATE UNIQUE INDEX IF NOT EXISTS uq_learners_tenant_nemis_upi
    ON public.learners (tenant_id, upper(btrim(upi_nemis_number)))
    WHERE upi_nemis_number IS NOT NULL AND btrim(upi_nemis_number) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_learners_tenant_kemis_upi
    ON public.learners (tenant_id, upper(btrim(kemis_upi)))
    WHERE kemis_upi IS NOT NULL AND btrim(kemis_upi) <> '';

-- KNEC CBA/KPSEA/KJSEA numbers are [centre]/[index] today but school-based
-- continuous assessment formats vary by level, so the column stays VARCHAR(30)
-- with no format regex — only tenant-scoped uniqueness is enforced.
CREATE UNIQUE INDEX IF NOT EXISTS uq_learners_tenant_knec_no
    ON public.learners (tenant_id, upper(btrim(knec_assessment_no)))
    WHERE knec_assessment_no IS NOT NULL AND btrim(knec_assessment_no) <> '';

-- ----------------------------------------------------------------------------
-- 2. Transport zones (tiered day-scholar transport)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.transport_zones (
    tenant_id character varying(50) NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    zone_name character varying(100) NOT NULL,
    pickup_points text,
    two_way_fee numeric(12, 2) NOT NULL DEFAULT 0.00,
    one_way_fee numeric(12, 2) NOT NULL DEFAULT 0.00,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT transport_zones_pkey PRIMARY KEY (tenant_id, id),
    CONSTRAINT transport_zones_tenant_name_unique UNIQUE (tenant_id, zone_name),
    CONSTRAINT transport_zones_fee_non_negative CHECK (two_way_fee >= 0 AND one_way_fee >= 0)
);

CREATE INDEX IF NOT EXISTS idx_transport_zones_tenant_active
    ON public.transport_zones (tenant_id, is_active);

-- Composite FK keeps a learner from pointing at another tenant's zone even if
-- application code ever forgets the tenant filter.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.learners'::regclass
          AND conname = 'learners_transport_zone_fkey'
    ) THEN
        ALTER TABLE public.learners
            ADD CONSTRAINT learners_transport_zone_fkey
            FOREIGN KEY (tenant_id, transport_zone_id)
            REFERENCES public.transport_zones (tenant_id, id)
            ON DELETE SET NULL;
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 3. Fee structures become residence-aware
-- ----------------------------------------------------------------------------
ALTER TABLE public.fee_structures
    ADD COLUMN IF NOT EXISTS residence_type character varying(30);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.fee_structures'::regclass
          AND conname = 'fee_structures_residence_type_chk'
    ) THEN
        ALTER TABLE public.fee_structures
            ADD CONSTRAINT fee_structures_residence_type_chk CHECK (
                residence_type IS NULL OR residence_type IN (
                    'DAY_SCHOLAR_NO_LUNCH',
                    'DAY_SCHOLAR_WITH_LUNCH',
                    'BOARDER_FULL',
                    'BOARDER_WEEKLY'
                )
            ) NOT VALID;
    END IF;
END $$;

ALTER TABLE public.fee_structures VALIDATE CONSTRAINT fee_structures_residence_type_chk;

-- Non-unique on purpose: older databases may already contain duplicates that
-- the API now prevents by upserting on the same key.
CREATE INDEX IF NOT EXISTS idx_fee_structures_residence_lookup
    ON public.fee_structures (tenant_id, academic_year_id, grade_id, category_id, residence_type);

-- ----------------------------------------------------------------------------
-- 4. School institutional / MoE / payment identity
-- ----------------------------------------------------------------------------
-- Existing schools columns that already cover part of the profile:
--   knec_code, kemis_code, nemis_code, county, sub_county, logo_ref,
--   stamp_ref, head_signature_ref.
ALTER TABLE public.schools
    ADD COLUMN IF NOT EXISTS moe_registration_number character varying(100),
    ADD COLUMN IF NOT EXISTS zone_ward character varying(50),
    ADD COLUMN IF NOT EXISTS kra_pin character varying(20),
    ADD COLUMN IF NOT EXISTS mpesa_account_format character varying(100) DEFAULT 'STUDENT_ADM_NO',
    ADD COLUMN IF NOT EXISTS school_motto text;

-- ----------------------------------------------------------------------------
-- 5. Tenant CBC learning areas (electives and school-specific additions)
-- ----------------------------------------------------------------------------
-- The published CBC catalogue stays in curriculum_versions/learning_areas.
-- This table holds only a school's own additions (French, Coding, Music, …)
-- and is merged with the catalogue at read time.
CREATE TABLE IF NOT EXISTS public.tenant_learning_areas (
    tenant_id character varying(50) NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    grade_tier character varying(20) NOT NULL,
    name character varying(100) NOT NULL,
    code character varying(20) NOT NULL,
    is_elective boolean NOT NULL DEFAULT false,
    is_active boolean NOT NULL DEFAULT true,
    knec_subject_code character varying(10),
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT tenant_learning_areas_pkey PRIMARY KEY (tenant_id, id),
    CONSTRAINT tenant_learning_areas_tenant_tier_code_unique UNIQUE (tenant_id, grade_tier, code),
    CONSTRAINT tenant_learning_areas_grade_tier_chk CHECK (
        grade_tier IN ('PRE_PRIMARY', 'LOWER_PRIMARY', 'UPPER_PRIMARY', 'JUNIOR_SCHOOL')
    )
);

CREATE INDEX IF NOT EXISTS idx_tenant_learning_areas_tier
    ON public.tenant_learning_areas (tenant_id, grade_tier, is_active);

-- ----------------------------------------------------------------------------
-- 6. Row-Level Security for every newly created tenant table
-- ----------------------------------------------------------------------------
-- 0009 auto-enrols tables that exist when it runs; these are newer, so the
-- policies are explicit and mirror 0030 (isolation + platform-admin bypass).
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['transport_zones', 'tenant_learning_areas']
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);

        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_isolation', t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
            t || '_isolation', t);

        EXECUTE format('DROP POLICY IF EXISTS platform_admin_bypass ON public.%I', t);
        EXECUTE format(
            'CREATE POLICY platform_admin_bypass ON public.%I USING (current_setting(''app.current_user_role'', true) IN (''SAAS_ADMIN'', ''SUPER_ADMIN''))',
            t);
    END LOOP;
END $$;

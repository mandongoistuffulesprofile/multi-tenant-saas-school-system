-- 0046_curriculum_and_national_assessment.sql
--
-- Two foundation gaps closed here:
--
-- 1. `strands` and `sub_strands` were present in the development database but
--    never created by the canonical migration set (they only existed in
--    migrations/archive, which is never applied). A fresh install therefore
--    failed on /curriculum/strands, /curriculum/sub-strands and the grading
--    grid. Recreate them idempotently, matching the shape the handlers read.
--
-- 2. KNEC results had nowhere to live. `national_assessment_results` stores
--    only the official raw band (and, where KNEC publishes them, official
--    points). There is deliberately no percentage, total, mean or position
--    column: those transformations are prohibited for national results.
--
-- Also adds the published-report snapshot columns. A published card is a
-- frozen revision, never a live read of assessment_results.

-- ---------------------------------------------------------------------------
-- 1. Curriculum tree
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.strands (
    strand_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    area_id uuid NOT NULL REFERENCES public.learning_areas(area_id) ON DELETE CASCADE,
    code character varying(20) NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (area_id, code)
);

CREATE TABLE IF NOT EXISTS public.sub_strands (
    sub_strand_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    strand_id uuid NOT NULL REFERENCES public.strands(strand_id) ON DELETE CASCADE,
    code character varying(20) NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (strand_id, code)
);

CREATE INDEX IF NOT EXISTS idx_strands_area ON public.strands(area_id);
CREATE INDEX IF NOT EXISTS idx_strands_code ON public.strands(code);
CREATE INDEX IF NOT EXISTS idx_sub_strands_strand ON public.sub_strands(strand_id);
CREATE INDEX IF NOT EXISTS idx_sub_strands_code ON public.sub_strands(code);

-- learning_areas is created in the baseline with only a primary key, so a
-- (version_id, code) pair could repeat. Declare the pair the seed and the
-- Curriculum screen both assume. IF NOT EXISTS keeps this safe on databases
-- that already carry the index.
--
-- Legacy databases may already hold duplicates. Report them by name instead of
-- letting CREATE UNIQUE INDEX fail with "could not create unique index ... Key
-- (version_id, code)=(...) is duplicated", which says nothing about how many
-- rows are affected or what to do next.
DO $$
DECLARE
    duplicate_pairs integer;
    examples text;
BEGIN
    SELECT count(*) INTO duplicate_pairs
    FROM (
        SELECT 1
        FROM public.learning_areas
        GROUP BY version_id, code
        HAVING count(*) > 1
    ) d;

    IF duplicate_pairs > 0 THEN
        SELECT string_agg(
                   format('version_id=%s code=%s rows=%s', version_id, code, row_count),
                   '; ' ORDER BY row_count DESC, code
               )
          INTO examples
          FROM (
              SELECT version_id, code, count(*) AS row_count
              FROM public.learning_areas
              GROUP BY version_id, code
              HAVING count(*) > 1
              ORDER BY count(*) DESC, code
              LIMIT 5
          ) d;

        -- The hint is repeated inside the message on purpose: pgx and lib/pq
        -- both print only Message, so a separate HINT never reaches the
        -- operator running the migration.
        RAISE EXCEPTION
            'cannot add uq_learning_areas_version_code: learning_areas has % duplicate (version_id, code) pair(s). Examples: %. Keep one row per pair and repoint or delete the others (strands and sub_strands cascade from learning_areas), then re-run this migration. Renaming or retiring the repeated codes in the Curriculum screen first is usually easiest.',
            duplicate_pairs, examples
            USING ERRCODE = 'unique_violation',
                  HINT = 'learning_areas must be unique per (version_id, code) before the index is created.';
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_learning_areas_version_code
    ON public.learning_areas (version_id, code);

-- ---------------------------------------------------------------------------
-- 2. Official KNEC national assessment results (append-only, band-only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.national_assessment_results (
    result_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL REFERENCES public.schools(tenant_id) ON DELETE CASCADE,
    learner_id uuid NOT NULL REFERENCES public.learners(learner_id) ON DELETE CASCADE,
    assessment_type character varying(20) NOT NULL,
    assessment_year integer NOT NULL,
    learning_area_id uuid REFERENCES public.learning_areas(area_id) ON DELETE SET NULL,
    subject_code character varying(20),
    raw_band character varying(10) NOT NULL,
    points smallint,
    source character varying(30) NOT NULL DEFAULT 'KNEC_IMPORT',
    revision integer NOT NULL DEFAULT 1,
    superseded_by uuid REFERENCES public.national_assessment_results(result_id) ON DELETE SET NULL,
    imported_by uuid REFERENCES public.users(user_id),
    imported_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    locked_at timestamp with time zone,
    CONSTRAINT national_assessment_type_chk
        CHECK (assessment_type IN ('KPSEA', 'KJSEA', 'GRADE3')),
    -- 4-band codes for KPSEA / Grade 3, 8-point sub-levels for KJSEA.
    CONSTRAINT national_assessment_band_chk
        CHECK (raw_band IN ('EE', 'ME', 'AE', 'BE',
                            'EE1', 'EE2', 'ME1', 'ME2',
                            'AE1', 'AE2', 'BE1', 'BE2')),
    CONSTRAINT national_assessment_points_chk
        CHECK (points IS NULL OR points BETWEEN 1 AND 8),
    CONSTRAINT national_assessment_year_chk
        CHECK (assessment_year BETWEEN 2000 AND 2100),
    CONSTRAINT national_assessment_no_school_score_chk
        CHECK (source IN ('KNEC_IMPORT', 'KNEC_PORTAL', 'MANUAL_OFFICIAL'))
);

CREATE INDEX IF NOT EXISTS idx_national_results_tenant_learner
    ON public.national_assessment_results(tenant_id, learner_id);
CREATE INDEX IF NOT EXISTS idx_national_results_tenant_year
    ON public.national_assessment_results(tenant_id, assessment_type, assessment_year);
CREATE INDEX IF NOT EXISTS idx_national_results_area
    ON public.national_assessment_results(tenant_id, learner_id, learning_area_id);

ALTER TABLE public.national_assessment_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.national_assessment_results FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS national_assessment_results_isolation ON public.national_assessment_results;
CREATE POLICY national_assessment_results_isolation ON public.national_assessment_results
    USING ((tenant_id)::text = current_tenant_id()::text)
    WITH CHECK ((tenant_id)::text = current_tenant_id()::text);

DROP POLICY IF EXISTS national_assessment_results_platform_bypass ON public.national_assessment_results;
CREATE POLICY national_assessment_results_platform_bypass ON public.national_assessment_results
    USING (current_setting('app.current_user_role', true) IN ('SAAS_ADMIN', 'SUPER_ADMIN'));

-- Append-only. The only permitted update is linking a row to its replacement
-- revision; deletes are never allowed. A correction is a new revision.
CREATE OR REPLACE FUNCTION public.national_assessment_results_append_only()
RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'national assessment results are append-only';
    END IF;
    IF NEW.result_id <> OLD.result_id
       OR NEW.tenant_id <> OLD.tenant_id
       OR NEW.learner_id <> OLD.learner_id
       OR NEW.assessment_type <> OLD.assessment_type
       OR NEW.assessment_year <> OLD.assessment_year
       OR NEW.raw_band <> OLD.raw_band
       OR NEW.points IS DISTINCT FROM OLD.points
       OR NEW.learning_area_id IS DISTINCT FROM OLD.learning_area_id
       OR NEW.subject_code IS DISTINCT FROM OLD.subject_code
       OR NEW.revision <> OLD.revision
       OR NEW.source <> OLD.source THEN
        RAISE EXCEPTION 'national assessment results are append-only; insert a new revision instead';
    END IF;
    IF NEW.superseded_by IS NULL AND OLD.superseded_by IS NOT NULL THEN
        RAISE EXCEPTION 'national assessment supersession cannot be undone';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_national_assessment_results_append_only ON public.national_assessment_results;
CREATE TRIGGER trg_national_assessment_results_append_only
    BEFORE UPDATE OR DELETE ON public.national_assessment_results
    FOR EACH ROW EXECUTE FUNCTION public.national_assessment_results_append_only();

-- ---------------------------------------------------------------------------
-- 3. Immutable published report cards
-- ---------------------------------------------------------------------------
ALTER TABLE public.report_cards
    ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS snapshot jsonb,
    ADD COLUMN IF NOT EXISTS snapshot_at timestamp with time zone,
    ADD COLUMN IF NOT EXISTS frozen boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.report_card_revisions (
    card_revision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL REFERENCES public.schools(tenant_id) ON DELETE CASCADE,
    card_id uuid NOT NULL REFERENCES public.report_cards(card_id) ON DELETE CASCADE,
    revision integer NOT NULL,
    snapshot jsonb NOT NULL,
    created_by uuid REFERENCES public.users(user_id),
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, card_id, revision)
);

CREATE INDEX IF NOT EXISTS idx_report_card_revisions_card
    ON public.report_card_revisions(tenant_id, card_id);

ALTER TABLE public.report_card_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_card_revisions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS report_card_revisions_isolation ON public.report_card_revisions;
CREATE POLICY report_card_revisions_isolation ON public.report_card_revisions
    USING ((tenant_id)::text = current_tenant_id()::text)
    WITH CHECK ((tenant_id)::text = current_tenant_id()::text);

DROP POLICY IF EXISTS report_card_revisions_platform_bypass ON public.report_card_revisions;
CREATE POLICY report_card_revisions_platform_bypass ON public.report_card_revisions
    USING (current_setting('app.current_user_role', true) IN ('SAAS_ADMIN', 'SUPER_ADMIN'));

-- Published revisions are immutable at the database level as well.
CREATE OR REPLACE FUNCTION public.report_card_revisions_immutable()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'published report card revisions are immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_report_card_revisions_immutable ON public.report_card_revisions;
CREATE TRIGGER trg_report_card_revisions_immutable
    BEFORE UPDATE OR DELETE ON public.report_card_revisions
    FOR EACH ROW EXECUTE FUNCTION public.report_card_revisions_immutable();

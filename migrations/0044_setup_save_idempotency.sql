-- 0044_setup_save_idempotency.sql
--
-- The platform setup wizard is resumable: staff can save the calendar,
-- structure and finance steps more than once. Those handlers relied on
-- ON CONFLICT clauses, but the baseline schema had no matching unique
-- constraints, and class_groups.stream_id was NOT NULL even though the
-- structure handler writes NULL for unstreamed classes.
--
-- The result: every repeated save appended another academic year, a second
-- set of terms, duplicate class groups, duplicate fee categories and
-- duplicate fee structures. This migration removes the duplicates (keeping the
-- newest row, since the last save carries the operator's intent), re-points
-- child rows at the keeper, and adds the indexes the handlers now upsert on.
--
-- Deduplication runs with the platform-admin RLS bypass so it can see every
-- tenant; without it, FORCE ROW LEVEL SECURITY would hide rows from the
-- migrator and the unique indexes would fail on rows it could not merge.

SET LOCAL app.current_user_role = 'SAAS_ADMIN';

-- A single-stream school still needs a class group. SetupStructure writes NULL
-- stream_id for that case; the baseline declared the column NOT NULL.
ALTER TABLE public.class_groups ALTER COLUMN stream_id DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- academic_years: one row per (tenant, year label)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _year_dedupe ON COMMIT DROP AS
SELECT year_id,
       first_value(year_id) OVER w AS keep_id,
       row_number() OVER w AS rn
  FROM public.academic_years
WINDOW w AS (
    PARTITION BY tenant_id, year_label
    ORDER BY created_at DESC NULLS LAST, year_id DESC
);

UPDATE public.terms x
   SET year_id = d.keep_id
  FROM _year_dedupe d
 WHERE d.rn > 1 AND x.year_id = d.year_id;
UPDATE public.class_groups x
   SET year_id = d.keep_id
  FROM _year_dedupe d
 WHERE d.rn > 1 AND x.year_id = d.year_id;
UPDATE public.enrolments x
   SET year_id = d.keep_id
  FROM _year_dedupe d
 WHERE d.rn > 1 AND x.year_id = d.year_id;
UPDATE public.fee_structures x
   SET academic_year_id = d.keep_id
  FROM _year_dedupe d
 WHERE d.rn > 1 AND x.academic_year_id = d.year_id;
UPDATE public.attendance_registers x
   SET academic_year_id = d.keep_id
  FROM _year_dedupe d
 WHERE d.rn > 1 AND x.academic_year_id = d.year_id;
UPDATE public.invoices x
   SET academic_year_id = d.keep_id
  FROM _year_dedupe d
 WHERE d.rn > 1 AND x.academic_year_id = d.year_id;
UPDATE public.invoice_lines x
   SET academic_year_id = d.keep_id
  FROM _year_dedupe d
 WHERE d.rn > 1 AND x.academic_year_id = d.year_id;
UPDATE public.knec_submission_status x
   SET academic_year_id = d.keep_id
  FROM _year_dedupe d
 WHERE d.rn > 1 AND x.academic_year_id = d.year_id;
UPDATE public.node_mappings x
   SET academic_year_id = d.keep_id
  FROM _year_dedupe d
 WHERE d.rn > 1 AND x.academic_year_id = d.year_id;
UPDATE public.report_cards x
   SET academic_year_id = d.keep_id
  FROM _year_dedupe d
 WHERE d.rn > 1 AND x.academic_year_id = d.year_id;
UPDATE public.report_runs x
   SET academic_year_id = d.keep_id
  FROM _year_dedupe d
 WHERE d.rn > 1 AND x.academic_year_id = d.year_id;

DELETE FROM public.academic_years y
 USING _year_dedupe d
 WHERE d.rn > 1 AND y.year_id = d.year_id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_academic_years_tenant_label
    ON public.academic_years (tenant_id, year_label);

-- ---------------------------------------------------------------------------
-- terms: one row per (tenant, year, term number)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _term_dedupe ON COMMIT DROP AS
SELECT term_id,
       first_value(term_id) OVER w AS keep_id,
       row_number() OVER w AS rn
  FROM public.terms
WINDOW w AS (
    PARTITION BY tenant_id, year_id, term_number
    ORDER BY created_at DESC NULLS LAST, term_id DESC
);

UPDATE public.in_kind_rates x
   SET term_id = d.keep_id
  FROM _term_dedupe d
 WHERE d.rn > 1 AND x.term_id = d.term_id;
UPDATE public.assessment_events x
   SET term_id = d.keep_id
  FROM _term_dedupe d
 WHERE d.rn > 1 AND x.term_id = d.term_id;
UPDATE public.attendance_registers x
   SET term_id = d.keep_id
  FROM _term_dedupe d
 WHERE d.rn > 1 AND x.term_id = d.term_id;
UPDATE public.invoices x
   SET term_id = d.keep_id
  FROM _term_dedupe d
 WHERE d.rn > 1 AND x.term_id = d.term_id;
UPDATE public.invoice_lines x
   SET term_id = d.keep_id
  FROM _term_dedupe d
 WHERE d.rn > 1 AND x.term_id = d.term_id;
UPDATE public.report_cards x
   SET term_id = d.keep_id
  FROM _term_dedupe d
 WHERE d.rn > 1 AND x.term_id = d.term_id;
UPDATE public.report_runs x
   SET term_id = d.keep_id
  FROM _term_dedupe d
 WHERE d.rn > 1 AND x.term_id = d.term_id;

DELETE FROM public.terms t
 USING _term_dedupe d
 WHERE d.rn > 1 AND t.term_id = d.term_id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_terms_tenant_year_number
    ON public.terms (tenant_id, year_id, term_number);

-- ---------------------------------------------------------------------------
-- class_groups: one row per (tenant, year, grade, stream); NULL stream is a
-- real value here, so the index folds it into a sentinel id.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _class_group_dedupe ON COMMIT DROP AS
SELECT class_group_id,
       first_value(class_group_id) OVER w AS keep_id,
       row_number() OVER w AS rn
  FROM public.class_groups
WINDOW w AS (
    PARTITION BY tenant_id, year_id, grade_id,
                 COALESCE(stream_id, '00000000-0000-0000-0000-000000000000'::uuid)
    ORDER BY created_at ASC NULLS LAST, class_group_id ASC
);

UPDATE public.enrolments x
   SET class_group_id = d.keep_id
  FROM _class_group_dedupe d
 WHERE d.rn > 1 AND x.class_group_id = d.class_group_id;
UPDATE public.attendance_registers x
   SET class_group_id = d.keep_id
  FROM _class_group_dedupe d
 WHERE d.rn > 1 AND x.class_group_id = d.class_group_id;

DELETE FROM public.class_groups c
 USING _class_group_dedupe d
 WHERE d.rn > 1 AND c.class_group_id = d.class_group_id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_class_groups_tenant_year_grade_stream
    ON public.class_groups (
        tenant_id,
        year_id,
        grade_id,
        COALESCE(stream_id, '00000000-0000-0000-0000-000000000000'::uuid)
    );

-- ---------------------------------------------------------------------------
-- fee_categories: one tenant-owned row per code, compared case-insensitively
-- so "tuition" and "TUITION" cannot both exist.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _fee_category_dedupe ON COMMIT DROP AS
SELECT category_id,
       first_value(category_id) OVER w AS keep_id,
       row_number() OVER w AS rn
  FROM public.fee_categories
 WHERE tenant_id IS NOT NULL
WINDOW w AS (
    PARTITION BY tenant_id, upper(code)
    ORDER BY created_at DESC NULLS LAST, category_id DESC
);

UPDATE public.fee_structures x
   SET category_id = d.keep_id
  FROM _fee_category_dedupe d
 WHERE d.rn > 1 AND x.category_id = d.category_id;
UPDATE public.learner_fee_options x
   SET category_id = d.keep_id
  FROM _fee_category_dedupe d
 WHERE d.rn > 1 AND x.category_id = d.category_id;
UPDATE public.invoice_lines x
   SET category_id = d.keep_id
  FROM _fee_category_dedupe d
 WHERE d.rn > 1 AND x.category_id = d.category_id;

DELETE FROM public.fee_categories c
 USING _fee_category_dedupe d
 WHERE d.rn > 1 AND c.category_id = d.category_id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fee_categories_tenant_code
    ON public.fee_categories (tenant_id, upper(code))
    WHERE tenant_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- fee_structures: one row per (tenant, year, grade, category)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _fee_structure_dedupe ON COMMIT DROP AS
SELECT structure_id,
       first_value(structure_id) OVER w AS keep_id,
       row_number() OVER w AS rn
  FROM public.fee_structures
WINDOW w AS (
    PARTITION BY tenant_id, academic_year_id, grade_id, category_id
    ORDER BY created_at DESC NULLS LAST, structure_id DESC
);

UPDATE public.learner_fee_options x
   SET structure_id = d.keep_id
  FROM _fee_structure_dedupe d
 WHERE d.rn > 1 AND x.structure_id = d.structure_id;

DELETE FROM public.fee_structures f
 USING _fee_structure_dedupe d
 WHERE d.rn > 1 AND f.structure_id = d.structure_id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fee_structures_tenant_year_grade_category
    ON public.fee_structures (tenant_id, academic_year_id, grade_id, category_id);

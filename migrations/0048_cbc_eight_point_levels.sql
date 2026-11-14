-- 0048_cbc_eight_point_levels.sql
--
-- The legacy offline CBC event table (cbc_assessment_events) enforced a 1-4
-- performance_level. The 8-point sub-level scale uses achievement levels 1-8
-- (BE2=1 ... EE1=8), so widen the constraint. The row also carries the level's
-- ordinal, not its code; the API accepts both 4-band and 8-point codes.

ALTER TABLE public.cbc_assessment_events
    DROP CONSTRAINT IF EXISTS cbc_assessment_events_performance_level_check;

ALTER TABLE public.cbc_assessment_events
    ADD CONSTRAINT cbc_assessment_events_performance_level_check
    CHECK (performance_level BETWEEN 1 AND 8);

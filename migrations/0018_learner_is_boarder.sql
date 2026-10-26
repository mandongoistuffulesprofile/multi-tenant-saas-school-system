-- Migration 0018: add is_boarder to learners (safe additive)
-- Spec §3 DECISION: boarding is per-tenant feature flag; default FALSE.
-- Existing column boarding_type already defaults to 'DAY' (equivalent to FALSE).
-- Adding boolean is_boarder for explicit feature-flag checks.

ALTER TABLE public.learners
    ADD COLUMN is_boarder boolean NOT NULL DEFAULT false;

-- Backfill from boarding_type for existing rows (if any are BOARDING)
UPDATE public.learners
SET is_boarder = true
WHERE boarding_type = 'BOARDING';

-- RLS already covers learners via force loop in 0009
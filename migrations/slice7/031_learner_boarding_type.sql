-- Replace previous_school with boarding_type (Day Scholar / Boarding).
-- Each school decides the fee model per learner, so the learner record needs
-- an explicit boarding classification rather than a free-text previous school.

ALTER TABLE learners
    ADD COLUMN IF NOT EXISTS boarding_type character varying(20);

-- Backfill: anything not explicitly flagged is a day scholar.
UPDATE learners
SET boarding_type = 'DAY'
WHERE boarding_type IS NULL;

ALTER TABLE learners
    ALTER COLUMN boarding_type SET DEFAULT 'DAY';

-- Constrain to the two supported values.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'learners_boarding_type_check'
    ) THEN
        ALTER TABLE learners
            ADD CONSTRAINT learners_boarding_type_check
            CHECK (boarding_type IN ('DAY', 'BOARDING'));
    END IF;
END $$;

-- previous_school is no longer used by the application.
ALTER TABLE learners
    DROP COLUMN IF EXISTS previous_school;

CREATE INDEX IF NOT EXISTS idx_learners_boarding_type
    ON learners (tenant_id, boarding_type);

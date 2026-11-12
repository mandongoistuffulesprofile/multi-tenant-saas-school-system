-- 0034_cbc_optimistic_locking.sql
-- Adds a version column to cbc_assessment_events for optimistic locking
-- during offline sync. Concurrent syncs of the same event must not silently
-- overwrite each other; the version is checked on every update.

ALTER TABLE cbc_assessment_events
    ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1;

-- Index to support optimistic lock lookups by tenant + student + strand.
CREATE INDEX IF NOT EXISTS idx_cbc_events_version
    ON cbc_assessment_events (tenant_id, student_id, version);

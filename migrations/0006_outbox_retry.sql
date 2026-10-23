-- 0006_outbox_retry.sql — retry scheduling and error capture for the outbox.
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS next_attempt_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS last_error text;

CREATE INDEX IF NOT EXISTS idx_outbox_drain
    ON outbox (next_attempt_at, created_at)
    WHERE status = 'PENDING';

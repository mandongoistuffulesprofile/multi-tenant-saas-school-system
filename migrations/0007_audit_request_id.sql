-- 0007_audit_request_id.sql — correlate audit rows with request logs.
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS request_id text;

CREATE INDEX IF NOT EXISTS idx_audit_events_tenant_created
    ON audit_events (tenant_id, created_at DESC);

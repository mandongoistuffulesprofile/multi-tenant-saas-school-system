-- 0002_rls_hardening.sql — close RLS gaps left by the legacy schema.
--
-- Every tenant table in 0001 already has ENABLE RLS and a
-- `<table>_isolation` policy. Three objects were missed:
--   * outbox            (worker queue, tenant_id NOT NULL)
--   * fee_categories    (global defaults use tenant_id IS NULL)
--   * the audit_events partition (queries normally go through the parent)
--
-- The outbox policy includes an explicit worker escape hatch. The worker sets
-- `SET app.worker = 'on'` on its own connection; it is the only cross-tenant
-- reader. When a dedicated BYPASSRLS worker role exists, remove the clause.

ALTER TABLE outbox ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS outbox_isolation ON outbox;
CREATE POLICY outbox_isolation ON outbox
    USING (current_setting('app.worker', true) = 'on' OR tenant_id = current_tenant_id())
    WITH CHECK (current_setting('app.worker', true) = 'on' OR tenant_id = current_tenant_id());

ALTER TABLE fee_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fee_categories_isolation ON fee_categories;
CREATE POLICY fee_categories_isolation ON fee_categories
    USING (tenant_id IS NULL OR tenant_id = current_tenant_id())
    WITH CHECK (tenant_id IS NULL OR tenant_id = current_tenant_id());

ALTER TABLE audit_events_y2026m10 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_events_y2026m10_isolation ON audit_events_y2026m10;
CREATE POLICY audit_events_y2026m10_isolation ON audit_events_y2026m10
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- A partitioned table with only one monthly partition rejects every insert
-- outside that month. The default partition keeps audit writes working until
-- monthly partitions are created by a maintenance job.
CREATE TABLE IF NOT EXISTS audit_events_default PARTITION OF audit_events DEFAULT;

-- Hot-path indexes that were missing from the working database.
CREATE INDEX IF NOT EXISTS idx_outbox_pending
    ON outbox (created_at)
    WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_audit_events_tenant_created
    ON audit_events (tenant_id, created_at DESC);

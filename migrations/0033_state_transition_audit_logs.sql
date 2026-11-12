-- 0033_state_transition_audit_logs.sql
-- Immutable audit trail for every FSM state transition (invoices, M-Pesa
-- records, CBC assessments, learner enrollment, etc.). No state change may
-- occur silently; each transition is logged inside the same transaction.

CREATE TABLE IF NOT EXISTS state_transition_logs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     VARCHAR(50) NOT NULL,
    entity_name   VARCHAR(64) NOT NULL,
    entity_id     VARCHAR(64) NOT NULL,
    from_state    VARCHAR(50) NOT NULL,
    to_state      VARCHAR(50) NOT NULL,
    event         VARCHAR(64) NOT NULL,
    actor_id      VARCHAR(64) NOT NULL,
    reason        TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_state_transition_logs_entity
    ON state_transition_logs (tenant_id, entity_name, entity_id);

CREATE INDEX IF NOT EXISTS idx_state_transition_logs_created
    ON state_transition_logs (tenant_id, created_at DESC);

-- RLS: tenants see only their own transition logs.
ALTER TABLE state_transition_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE state_transition_logs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_state_transition_logs ON state_transition_logs;
CREATE POLICY tenant_isolation_state_transition_logs ON state_transition_logs
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS platform_admin_state_transition_logs ON state_transition_logs;
CREATE POLICY platform_admin_state_transition_logs ON state_transition_logs
    FOR ALL USING (current_setting('app.current_user_role', true) = 'SAAS_ADMIN')
    WITH CHECK (current_setting('app.current_user_role', true) = 'SAAS_ADMIN');

DROP POLICY IF EXISTS worker_state_transition_logs ON state_transition_logs;
CREATE POLICY worker_state_transition_logs ON state_transition_logs
    FOR ALL USING (current_setting('app.worker', true) = 'on')
    WITH CHECK (current_setting('app.worker', true) = 'on');

-- Append-only: transitions are never updated or deleted.
CREATE OR REPLACE FUNCTION prevent_transition_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'State transition log entries are immutable. % is prohibited on state_transition_logs.',
        CASE WHEN TG_OP = 'DELETE' THEN 'DELETE' ELSE 'UPDATE' END;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_transition_log_mutation ON state_transition_logs;
CREATE TRIGGER trg_prevent_transition_log_mutation
    BEFORE DELETE OR UPDATE ON state_transition_logs
    FOR EACH ROW
    EXECUTE FUNCTION prevent_transition_log_mutation();

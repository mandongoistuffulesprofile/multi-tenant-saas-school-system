-- 0004_runtime_tables.sql — feature flags and idempotent job runs.

CREATE TABLE IF NOT EXISTS feature_flags (
    tenant_id  varchar(50) NOT NULL,
    flag_key   varchar(100) NOT NULL,
    enabled    boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, flag_key)
);

ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS feature_flags_isolation ON feature_flags;
CREATE POLICY feature_flags_isolation ON feature_flags
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- One row per (job, period). The unique key is the idempotency contract:
-- re-running October's invoice run is a no-op, not a second invoice.
CREATE TABLE IF NOT EXISTS job_runs (
    job_name    varchar(100) NOT NULL,
    run_key     varchar(100) NOT NULL,
    status      varchar(20) NOT NULL DEFAULT 'RUNNING'
                CHECK (status IN ('RUNNING','SUCCEEDED','FAILED')),
    started_at  timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    error       text,
    PRIMARY KEY (job_name, run_key)
);

CREATE INDEX IF NOT EXISTS idx_job_runs_started ON job_runs (job_name, started_at DESC);

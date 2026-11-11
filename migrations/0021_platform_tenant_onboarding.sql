-- Platform-orchestrated school onboarding state for Super Admin setup flow.
-- Tracks resumable per-tenant setup progress without requiring SA tenant membership.

CREATE TABLE IF NOT EXISTS platform_tenant_onboarding (
    tenant_id VARCHAR(50) PRIMARY KEY REFERENCES schools(tenant_id) ON DELETE CASCADE,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING_SETUP',
    current_step VARCHAR(40) NOT NULL DEFAULT 'PROVISIONED',
    steps JSONB NOT NULL DEFAULT '{}'::jsonb,
    draft JSONB NOT NULL DEFAULT '{}'::jsonb,
    readiness JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by UUID,
    updated_by UUID,
    handed_off_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT platform_tenant_onboarding_status_chk CHECK (
        status IN ('PENDING_SETUP','IN_PROGRESS','READY_FOR_HANDOFF','HANDED_OFF','LEGACY_COMPLETE')
    )
);

CREATE INDEX IF NOT EXISTS idx_platform_tenant_onboarding_status
    ON platform_tenant_onboarding(status);

COMMENT ON TABLE platform_tenant_onboarding IS
'Super-admin (platform-only) onboarding progress and readiness for a tenant; mutated via audited platform APIs.';

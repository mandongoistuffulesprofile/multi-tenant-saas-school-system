-- 0056_platform_subscriptions.sql — restore the subscriptions table.
--
-- CreateTenant records the school's plan by inserting into subscriptions, and
-- the platform console reads and writes subscriptions too, but the only definition
-- of this table lives in migrations/archive/slice6/028, which is not part of the
-- active chain. On a freshly migrated database every POST /platform/tenants that
-- carried a plan_code therefore failed with 'relation "subscriptions" does not
-- exist' — after the school, the administrator and the finance settings had been
-- written inside the same transaction.
--
-- The shape below matches the archived definition and what the console queries
-- (subscription_id, tenant_id, plan_id, status, started_at, ends_at, auto_renew).
-- Row-level security is deliberately left off for now: the platform console reads
-- subscriptions across tenants without a tenant context, and the neighbouring
-- schools/plans tables are unscoped in the same way. Enabling it needs a platform
-- bypass policy as well, which this migration should not guess at.

CREATE TABLE IF NOT EXISTS subscriptions (
    subscription_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES plans(plan_id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    ends_at TIMESTAMP WITH TIME ZONE,
    auto_renew BOOLEAN DEFAULT TRUE,
    payment_channel_id UUID REFERENCES school_payment_channels(channel_id) ON DELETE SET NULL,
    created_by UUID REFERENCES users(user_id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant ON subscriptions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_plan ON subscriptions(plan_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

COMMENT ON TABLE subscriptions IS
'The school''s current plan. One row per tenant, written by POST /platform/tenants and read by the platform console.';

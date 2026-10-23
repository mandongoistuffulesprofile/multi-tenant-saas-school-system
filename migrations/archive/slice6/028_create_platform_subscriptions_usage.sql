-- Migration 028: Create platform tables (M13)
-- plans: subscription plans (global, no tenant_id)
CREATE TABLE IF NOT EXISTS plans (
    plan_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plan_code VARCHAR(30) NOT NULL UNIQUE, -- STARTER, STANDARD, PREMIUM, ENTERPRISE
    name VARCHAR(100) NOT NULL,
    description TEXT,
    price_monthly NUMERIC(12,2) NOT NULL DEFAULT 0,
    price_yearly NUMERIC(12,2) NOT NULL DEFAULT 0,
    currency VARCHAR(3) DEFAULT 'KES',
    max_learners INTEGER NOT NULL DEFAULT 0,
    max_staff INTEGER NOT NULL DEFAULT 0,
    features JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_plans_code ON plans(plan_code);
CREATE INDEX IF NOT EXISTS idx_plans_active ON plans(is_active);

-- Insert default plans
INSERT INTO plans (plan_code, name, description, price_monthly, price_yearly, max_learners, max_staff, features) VALUES
    ('STARTER', 'Starter', 'For small schools up to 100 learners', 2500, 25000, 100, 10, '{"fee_tracking": true, "basic_reports": true, "sms_alerts": 50}'),
    ('STANDARD', 'Standard', 'For growing schools up to 500 learners', 5000, 50000, 500, 25, '{"fee_tracking": true, "basic_reports": true, "sms_alerts": 200, "mpesa_integration": true, "report_cards": true}'),
    ('PREMIUM', 'Premium', 'For large schools up to 2000 learners', 10000, 100000, 2000, 100, '{"fee_tracking": true, "advanced_reports": true, "sms_alerts": 1000, "mpesa_integration": true, "report_cards": true, "assessment_analytics": true, "gate_access": true}'),
    ('ENTERPRISE', 'Enterprise', 'For school chains and large institutions', 25000, 250000, 10000, 500, '{"fee_tracking": true, "advanced_reports": true, "sms_alerts": 5000, "mpesa_integration": true, "report_cards": true, "assessment_analytics": true, "gate_access": true, "multi_school": true, "api_access": true}')
ON CONFLICT (plan_code) DO NOTHING;

-- subscriptions: tenant subscriptions
CREATE TABLE IF NOT EXISTS subscriptions (
    subscription_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES plans(plan_id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, PAST_DUE, CANCELLED, SUSPENDED, EXPIRED
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    ends_at TIMESTAMP WITH TIME ZONE,
    auto_renew BOOLEAN DEFAULT TRUE,
    payment_channel_id UUID REFERENCES school_payment_channels(channel_id) ON DELETE SET NULL,
    created_by UUID REFERENCES users(user_id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant ON subscriptions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_plan ON subscriptions(plan_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

-- RLS for subscriptions
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY subscriptions_isolation ON subscriptions
    FOR ALL USING (tenant_id = current_tenant_id());

-- platform_invoices: platform-level invoices to schools
CREATE TABLE IF NOT EXISTS platform_invoices (
    invoice_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    invoice_number VARCHAR(50) NOT NULL,
    amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    currency VARCHAR(3) DEFAULT 'KES',
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT', -- DRAFT, ISSUED, PAID, VOID, CANCELLED
    issue_date DATE,
    due_date DATE,
    paid_at TIMESTAMP WITH TIME ZONE,
    created_by UUID REFERENCES users(user_id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, invoice_number)
);

CREATE INDEX IF NOT EXISTS idx_platform_invoices_tenant ON platform_invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_platform_invoices_status ON platform_invoices(status);

-- RLS for platform_invoices
ALTER TABLE platform_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_invoices_isolation ON platform_invoices
    FOR ALL USING (tenant_id = current_tenant_id());

-- tenant_usage: monthly usage tracking per tenant
CREATE TABLE IF NOT EXISTS tenant_usage (
    usage_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    period_month VARCHAR(7) NOT NULL, -- YYYY-MM
    active_learners INTEGER DEFAULT 0,
    active_staff INTEGER DEFAULT 0,
    sms_sent INTEGER DEFAULT 0,
    reports_generated INTEGER DEFAULT 0,
    assessments_recorded INTEGER DEFAULT 0,
    payments_processed INTEGER DEFAULT 0,
    gate_taps INTEGER DEFAULT 0,
    storage_mb INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, period_month)
);

CREATE INDEX IF NOT EXISTS idx_tenant_usage_tenant ON tenant_usage(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_usage_period ON tenant_usage(period_month);

-- RLS for tenant_usage
ALTER TABLE tenant_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_usage_isolation ON tenant_usage
    FOR ALL USING (tenant_id = current_tenant_id());

-- impersonation_sessions: SaaS admin impersonation sessions
CREATE TABLE IF NOT EXISTS impersonation_sessions (
    session_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    target_user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    target_tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    revoked_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_impersonation_sessions_admin ON impersonation_sessions(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_impersonation_sessions_target ON impersonation_sessions(target_user_id);
CREATE INDEX IF NOT EXISTS idx_impersonation_sessions_expires ON impersonation_sessions(expires_at);

-- migration_runs: schema migration tracking
CREATE TABLE IF NOT EXISTS migration_runs (
    migration_id VARCHAR(50) PRIMARY KEY,
    applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    success BOOLEAN DEFAULT TRUE,
    error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_migration_runs_applied ON migration_runs(applied_at);

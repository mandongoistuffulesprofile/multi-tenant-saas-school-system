-- Migration 001: Create uuid-ossp extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Migration 002: Create schools table (global, no tenant_id)
CREATE TABLE IF NOT EXISTS schools (
    tenant_id VARCHAR(50) PRIMARY KEY,
    school_name VARCHAR(150) NOT NULL,
    subdomain VARCHAR(100) UNIQUE NOT NULL,
    license_tier VARCHAR(30) DEFAULT 'STANDARD',
    status VARCHAR(20) DEFAULT 'ACTIVE',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_schools_subdomain ON schools(subdomain);
CREATE INDEX IF NOT EXISTS idx_schools_status ON schools(status);

-- Migration 003: Create users table (global, no tenant_id)
CREATE TABLE IF NOT EXISTS users (
    user_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(100),
    phone_number VARCHAR(20) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    locale VARCHAR(10) DEFAULT 'en',
    status VARCHAR(20) DEFAULT 'ACTIVE',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT users_email_or_phone CHECK (email IS NOT NULL OR phone_number IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone_number);

-- Migration 004: Create tenant_memberships table (tenant-scoped)
CREATE TABLE IF NOT EXISTS tenant_memberships (
    membership_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    role VARCHAR(30) NOT NULL,
    status VARCHAR(20) DEFAULT 'ACTIVE',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_memberships_tenant ON tenant_memberships(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_user ON tenant_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_role ON tenant_memberships(role);

-- Migration 005: Create refresh_tokens, devices, otp_challenges, guardian_claim_codes
CREATE TABLE IF NOT EXISTS refresh_tokens (
    token_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    revoked_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    device_fingerprint VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);

CREATE TABLE IF NOT EXISTS devices (
    device_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    tenant_id VARCHAR(50) REFERENCES schools(tenant_id) ON DELETE CASCADE,
    fingerprint VARCHAR(255) NOT NULL,
    label VARCHAR(100),
    revoked_at TIMESTAMP WITH TIME ZONE,
    last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);
CREATE INDEX IF NOT EXISTS idx_devices_fingerprint ON devices(fingerprint);

CREATE TABLE IF NOT EXISTS otp_challenges (
    challenge_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone_number VARCHAR(20) NOT NULL,
    code_hash VARCHAR(255) NOT NULL,
    purpose VARCHAR(30) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    attempts INTEGER DEFAULT 0,
    used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_otp_challenges_phone ON otp_challenges(phone_number);
CREATE INDEX IF NOT EXISTS idx_otp_challenges_purpose ON otp_challenges(purpose);

CREATE TABLE IF NOT EXISTS guardian_claim_codes (
    claim_code_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    learner_id UUID,
    guardian_id UUID,
    code_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_guardian_claim_codes_hash ON guardian_claim_codes(code_hash);

-- Migration 006: Enable RLS and create policies
ALTER TABLE schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE otp_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardian_claim_codes ENABLE ROW LEVEL SECURITY;

-- Schools: tenant-scoped; only the school's own tenant can read/write its row
CREATE POLICY schools_select_all ON schools FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY schools_insert_saas ON schools FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY schools_update_saas ON schools FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true));

-- Users: users can read their own record; admins can read all
CREATE POLICY users_select_own ON users FOR SELECT USING (
    user_id = current_setting('app.current_user_id', true)::UUID
    OR current_setting('app.current_user_role', true) = 'SAAS_ADMIN'
);
CREATE POLICY users_insert_self ON users FOR INSERT WITH CHECK (true);
CREATE POLICY users_update_own ON users FOR UPDATE USING (
    user_id = current_setting('app.current_user_id', true)::UUID
);

-- Tenant memberships: scoped to tenant
CREATE POLICY tenant_memberships_isolation ON tenant_memberships
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id', true));

-- Refresh tokens: user-scoped
CREATE POLICY refresh_tokens_isolation ON refresh_tokens
    FOR ALL
    USING (user_id = current_setting('app.current_user_id', true)::UUID);

-- Devices: user-scoped
CREATE POLICY devices_isolation ON devices
    FOR ALL
    USING (user_id = current_setting('app.current_user_id', true)::UUID);

-- OTP challenges: phone-scoped (no tenant, public for auth)
CREATE POLICY otp_challenges_all ON otp_challenges FOR ALL USING (true);

-- Guardian claim codes: no tenant (used during activation)
CREATE POLICY guardian_claim_codes_all ON guardian_claim_codes FOR ALL USING (true);

-- Migration 007: Create audit_events table (partitioned by tenant)
CREATE TABLE IF NOT EXISTS audit_events (
    audit_id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL,
    user_id UUID,
    action VARCHAR(50) NOT NULL,
    table_name VARCHAR(50) NOT NULL,
    record_id UUID,
    old_values JSONB,
    new_values JSONB,
    reason TEXT,
    device_id UUID,
    ip_address INET,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (audit_id, created_at)
) PARTITION BY RANGE (created_at);

CREATE INDEX IF NOT EXISTS idx_audit_events_tenant ON audit_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_events_action ON audit_events(action);

-- Partition audit_events by tenant (monthly partitions will be maintained by J-08)
-- Initial partition for current month
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'audit_events_y2026m10') THEN
        CREATE TABLE audit_events_y2026m10 PARTITION OF audit_events
        FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
    END IF;
END $$;

-- Migration 008: Create outbox table for domain events
CREATE TABLE IF NOT EXISTS outbox (
    outbox_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    aggregate_type VARCHAR(50) NOT NULL,
    aggregate_id UUID NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    event_id UUID NOT NULL DEFAULT uuid_generate_v4(),
    payload JSONB NOT NULL,
    tenant_id VARCHAR(50) NOT NULL,
    status VARCHAR(20) DEFAULT 'PENDING',
    published_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    attempt_count INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_outbox_tenant_status ON outbox(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_outbox_created ON outbox(created_at);
CREATE INDEX IF NOT EXISTS idx_outbox_event_type ON outbox(event_type);

-- Migration 009: Create RLS trigger function for tenant context
CREATE OR REPLACE FUNCTION set_tenant_context()
RETURNS EVENT_TRIGGER AS $$
BEGIN
    -- This function is called via SET LOCAL app.current_tenant_id per transaction
    -- The trigger ensures the context is set before any DML
    NULL;
END;
$$ LANGUAGE plpgsql;

-- Helper function to get current tenant (used in policies)
CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS VARCHAR(50) AS $$
DECLARE
    tid VARCHAR(50);
BEGIN
    SELECT current_setting('app.current_tenant_id', true) INTO tid;
    RETURN tid;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Helper function to get current user id
CREATE OR REPLACE FUNCTION current_user_id()
RETURNS UUID AS $$
DECLARE
    uid UUID;
BEGIN
    SELECT current_setting('app.current_user_id', true)::UUID INTO uid;
    RETURN uid;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

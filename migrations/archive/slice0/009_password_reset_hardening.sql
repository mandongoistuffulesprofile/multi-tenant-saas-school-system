-- Migration 009: Hardened password-reset schema
-- Adds password_reset_tokens, audit_events, email_log, login_attempts
-- and hardens the users/sessions tables for constant-time auth.

CREATE EXTENSION IF NOT EXISTS "citext";

-- Users: add lockout + soft-active columns if missing.
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_norm TEXT;

-- Sessions table (if not already present from foundation migration).
CREATE TABLE IF NOT EXISTS sessions (
    session_id   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id      UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    session_token TEXT NOT NULL,
    user_agent   TEXT,
    ip           INET,
    created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at   TIMESTAMP WITH TIME ZONE NOT NULL,
    revoked      BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, revoked, expires_at);

-- Password reset tokens: store ONLY the SHA-256 of the token.
-- The raw token is sent via email and never persisted.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    reset_id     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id      UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    token_hash   VARCHAR(255) NOT NULL,
    token_prefix VARCHAR(8) NOT NULL,
    created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at   TIMESTAMP WITH TIME ZONE NOT NULL,
    used_at      TIMESTAMP WITH TIME ZONE,
    used_by_ip   INET,
    invalidated  BOOLEAN NOT NULL DEFAULT false,
    created_by_ip INET,
    created_by_ua TEXT,
    request_id   TEXT
);
CREATE INDEX IF NOT EXISTS idx_reset_tokens_hash ON password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_reset_tokens_user ON password_reset_tokens(user_id, created_at DESC);

-- Login attempt audit (constant-time enforcement + alerting).
CREATE TABLE IF NOT EXISTS login_attempts (
    attempt_id   BIGSERIAL PRIMARY KEY,
    user_id      UUID,
    email_norm   TEXT,
    ip           INET NOT NULL,
    user_agent   TEXT,
    success      BOOLEAN NOT NULL DEFAULT false,
    created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip, created_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_user ON login_attempts(user_id, created_at);

-- Generic audit log (no secrets/tokens/passwords).
CREATE TABLE IF NOT EXISTS audit_log (
    id           BIGSERIAL PRIMARY KEY,
    user_id      UUID,
    event        TEXT NOT NULL,
    ip           INET,
    user_agent   TEXT,
    request_id   TEXT,
    metadata     JSONB NOT NULL DEFAULT '{}',
    created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_log_event ON audit_log(event, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id, created_at);

-- Email send log (prevents inbox bombing, tracks delivery).
CREATE TABLE IF NOT EXISTS email_log (
    id           BIGSERIAL PRIMARY KEY,
    user_id      UUID,
    email_norm   TEXT,
    kind         TEXT NOT NULL,
    ip           INET,
    request_id   TEXT,
    sent_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_email_log_user_kind ON email_log(user_id, kind, sent_at);
CREATE INDEX IF NOT EXISTS idx_email_log_ip ON email_log(ip, sent_at);

-- RLS: force isolation on all user-scoped tables.
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY sessions_isolation ON sessions
    FOR ALL USING (user_id = current_setting('app.current_user_id', true)::UUID);
CREATE POLICY reset_tokens_isolation ON password_reset_tokens
    FOR ALL USING (user_id = current_setting('app.current_user_id', true)::UUID);
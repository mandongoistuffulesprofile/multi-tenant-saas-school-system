-- Invite tokens for staff onboarding. A school admin invites a staff member;
-- the system generates a single-use token, hashes it, and sends the plaintext
-- token to the invitee via SMS. The invitee presents the token at
-- POST /auth/invite/accept together with their chosen password.
--
-- Tokens expire after 7 days and are single-use (invalidated on accept).

CREATE TABLE IF NOT EXISTS invite_tokens (
    invite_id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    tenant_id character varying(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    token_hash character varying(255) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_by_ip inet
);

CREATE INDEX IF NOT EXISTS idx_invite_tokens_hash ON invite_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_invite_tokens_user ON invite_tokens(user_id, created_at DESC);

ALTER TABLE invite_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY invite_tokens_isolation ON invite_tokens
    USING (tenant_id = current_tenant_id());

COMMENT ON TABLE invite_tokens IS
'Single-use, time-limited invitation tokens for staff onboarding; presented at /auth/invite/accept.';

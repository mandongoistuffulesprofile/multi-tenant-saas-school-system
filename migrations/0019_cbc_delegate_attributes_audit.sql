-- Additive: custom attributes, delegated entry tokens, mpesa holding tank, export audit logs
ALTER TABLE students ADD COLUMN IF NOT EXISTS custom_attributes JSONB DEFAULT '{}'::jsonb;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS custom_attributes JSONB DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS delegated_entry_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(50) NOT NULL,
    created_by_user_id UUID NOT NULL,
    delegate_pin VARCHAR(4) NOT NULL,
    class_id VARCHAR(50) NOT NULL,
    subject_scope VARCHAR(100)[] NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS mpesa_holding_tank (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(50) NOT NULL,
    transaction_code VARCHAR(50) UNIQUE NOT NULL,
    amount NUMERIC(12, 2) NOT NULL,
    sender_phone VARCHAR(20) NOT NULL,
    sender_name VARCHAR(150),
    raw_webhook_payload JSONB NOT NULL,
    status VARCHAR(20) DEFAULT 'UNMATCHED',
    resolved_student_id UUID,
    resolved_by UUID,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS export_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(50) NOT NULL,
    user_id UUID NOT NULL,
    export_type VARCHAR(50) NOT NULL,
    ip_address VARCHAR(45),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

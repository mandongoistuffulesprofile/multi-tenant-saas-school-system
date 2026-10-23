-- Migration 026: Create message templates, outbound messages, broadcasts (M11)
-- message_templates: global + tenant-scoped message templates
CREATE TABLE IF NOT EXISTS message_templates (
    template_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) REFERENCES schools(tenant_id) ON DELETE CASCADE,
    template_name VARCHAR(150) NOT NULL,
    channel VARCHAR(20) NOT NULL, -- SMS, EMAIL, WHATSAPP, PUSH
    subject VARCHAR(200),
    body_text TEXT NOT NULL,
    body_html TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    is_default BOOLEAN DEFAULT FALSE,
    created_by UUID REFERENCES users(user_id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, template_name)
);

CREATE INDEX IF NOT EXISTS idx_message_templates_tenant ON message_templates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_message_templates_channel ON message_templates(channel);

-- RLS for message_templates
ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY message_templates_isolation ON message_templates
    FOR ALL USING (tenant_id = current_tenant_id() OR tenant_id IS NULL);

-- outbound_messages: messages sent to parents/guardians
CREATE TABLE IF NOT EXISTS outbound_messages (
    message_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    template_id UUID REFERENCES message_templates(template_id) ON DELETE SET NULL,
    recipient_type VARCHAR(20) NOT NULL, -- PARENT, GUARDIAN, STAFF, LEARNER
    recipient_id UUID NOT NULL,
    channel VARCHAR(20) NOT NULL, -- SMS, EMAIL, WHATSAPP, PUSH
    recipient_address VARCHAR(255) NOT NULL, -- phone, email, push token
    subject VARCHAR(200),
    body_text TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING, SENT, DELIVERED, FAILED, READ
    provider_message_id VARCHAR(100),
    provider_response JSONB DEFAULT '{}',
    sent_at TIMESTAMP WITH TIME ZONE,
    delivered_at TIMESTAMP WITH TIME ZONE,
    read_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    created_by UUID REFERENCES users(user_id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_outbound_messages_tenant ON outbound_messages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_outbound_messages_recipient ON outbound_messages(recipient_type, recipient_id);
CREATE INDEX IF NOT EXISTS idx_outbound_messages_status ON outbound_messages(status);
CREATE INDEX IF NOT EXISTS idx_outbound_messages_channel ON outbound_messages(channel);
CREATE INDEX IF NOT EXISTS idx_outbound_messages_created ON outbound_messages(created_at);

-- RLS for outbound_messages
ALTER TABLE outbound_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY outbound_messages_isolation ON outbound_messages
    FOR ALL USING (tenant_id = current_tenant_id());

-- delivery_receipts: delivery confirmations from providers
CREATE TABLE IF NOT EXISTS delivery_receipts (
    receipt_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    message_id UUID NOT NULL REFERENCES outbound_messages(message_id) ON DELETE CASCADE,
    channel VARCHAR(20) NOT NULL,
    provider_status VARCHAR(50),
    delivered_at TIMESTAMP WITH TIME ZONE,
    raw_payload JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_delivery_receipts_tenant ON delivery_receipts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_delivery_receipts_message ON delivery_receipts(message_id);

-- RLS for delivery_receipts
ALTER TABLE delivery_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY delivery_receipts_isolation ON delivery_receipts
    FOR ALL USING (tenant_id = current_tenant_id());

-- broadcasts: bulk messages to groups
CREATE TABLE IF NOT EXISTS broadcasts (
    broadcast_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    broadcast_name VARCHAR(150) NOT NULL,
    channel VARCHAR(20) NOT NULL, -- SMS, EMAIL, WHATSAPP, PUSH
    target_audience VARCHAR(50) NOT NULL, -- ALL_PARENTS, GRADE_PARENTS, STAFF, CUSTOM
    target_grade_ids JSONB DEFAULT '[]',
    subject VARCHAR(200),
    body_text TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT', -- DRAFT, SCHEDULED, SENDING, COMPLETED, FAILED
    scheduled_at TIMESTAMP WITH TIME ZONE,
    sent_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    total_recipients INTEGER DEFAULT 0,
    sent_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    created_by UUID REFERENCES users(user_id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH Time ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_broadcasts_tenant ON broadcasts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_broadcasts_status ON broadcasts(status);
CREATE INDEX IF NOT EXISTS idx_broadcasts_channel ON broadcasts(channel);

-- RLS for broadcasts
ALTER TABLE broadcasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY broadcasts_isolation ON broadcasts
    FOR ALL USING (tenant_id = current_tenant_id());

-- broadcast_recipients: individual recipients of a broadcast
CREATE TABLE IF NOT EXISTS broadcast_recipients (
    recipient_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    broadcast_id UUID NOT NULL REFERENCES broadcasts(broadcast_id) ON DELETE CASCADE,
    recipient_type VARCHAR(20) NOT NULL,
    recipient_id_ref UUID NOT NULL,
    channel VARCHAR(20) NOT NULL,
    recipient_address VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING, SENT, DELIVERED, FAILED
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_broadcast ON broadcast_recipients(broadcast_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_status ON broadcast_recipients(status);
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_tenant ON broadcast_recipients(tenant_id);

-- RLS for broadcast_recipients
ALTER TABLE broadcast_recipients ENABLE ROW LEVEL SECURITY;
CREATE POLICY broadcast_recipients_isolation ON broadcast_recipients
    FOR ALL USING (tenant_id = current_tenant_id());

-- opt_outs: communication opt-outs
CREATE TABLE IF NOT EXISTS opt_outs (
    opt_out_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    channel VARCHAR(20) NOT NULL, -- SMS, EMAIL, WHATSAPP, PUSH
    reason VARCHAR(100),
    opted_out_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    opted_back_in_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT TRUE,
    UNIQUE(tenant_id, user_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_opt_outs_tenant ON opt_outs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_opt_outs_user ON opt_outs(user_id);

-- RLS for opt_outs
ALTER TABLE opt_outs ENABLE ROW LEVEL SECURITY;
CREATE POLICY opt_outs_isolation ON opt_outs
    FOR ALL USING (tenant_id = current_tenant_id());

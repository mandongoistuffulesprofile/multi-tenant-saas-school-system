-- Migration 018: Create M-Pesa transactions and STK requests (M10)
CREATE TABLE IF NOT EXISTS mpesa_transactions (
    trans_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES school_payment_channels(channel_id) ON DELETE CASCADE,
    external_trans_id VARCHAR(100) NOT NULL UNIQUE, -- M-Pesa TransID
    shortcode VARCHAR(20) NOT NULL,
    channel_type VARCHAR(20) NOT NULL, -- PAYBILL, TILL
    bill_ref VARCHAR(100), -- customer reference from M-Pesa
    msisdn_masked VARCHAR(20), -- masked phone number
    amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    currency VARCHAR(3) DEFAULT 'KES',
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING, COMPLETED, FAILED, REVERSED
    transaction_date TIMESTAMP WITH TIME ZONE,
    raw_payload JSONB NOT NULL DEFAULT '{}', -- full M-Pesa callback payload
    tenant_resolved BOOLEAN DEFAULT FALSE, -- whether tenant was identified from bill_ref
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH Time ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mpesa_transactions_tenant ON mpesa_transactions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_mpesa_transactions_external ON mpesa_transactions(external_trans_id);
CREATE INDEX IF NOT EXISTS idx_mpesa_transactions_channel ON mpesa_transactions(channel_id);
CREATE INDEX IF NOT EXISTS idx_mpesa_transactions_status ON mpesa_transactions(status);
CREATE INDEX IF NOT EXISTS idx_mpesa_transactions_msisdn ON mpesa_transactions(msisdn_masked);

-- RLS for mpesa_transactions
ALTER TABLE mpesa_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY mpesa_transactions_isolation ON mpesa_transactions
    FOR ALL USING (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS mpesa_stk_requests (
    stk_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES school_payment_channels(channel_id) ON DELETE CASCADE,
    checkout_request_id VARCHAR(100) NOT NULL UNIQUE, -- M-Pesa CheckoutRequestID
    merchant_request_id VARCHAR(100) NOT NULL, -- M-Pesa MerchantRequestID
    phone_number VARCHAR(20) NOT NULL,
    amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    currency VARCHAR(3) DEFAULT 'KES',
    account_reference VARCHAR(100),
    transaction_desc VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING, COMPLETED, FAILED, TIMEOUT, CANCELLED
    callback_received_at TIMESTAMP WITH TIME ZONE,
    callback_payload JSONB DEFAULT '{}',
    mpesa_trans_id VARCHAR(100), -- linked to mpesa_transactions.external_trans_id on completion
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mpesa_stk_requests_tenant ON mpesa_stk_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_mpesa_stk_requests_checkout ON mpesa_stk_requests(checkout_request_id);
CREATE INDEX IF NOT EXISTS idx_mpesa_stk_requests_phone ON mpesa_stk_requests(phone_number);
CREATE INDEX IF NOT EXISTS idx_mpesa_stk_requests_status ON mpesa_stk_requests(status);

-- RLS for mpesa_stk_requests
ALTER TABLE mpesa_stk_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY mpesa_stk_requests_isolation ON mpesa_stk_requests
    FOR ALL USING (tenant_id = current_tenant_id());

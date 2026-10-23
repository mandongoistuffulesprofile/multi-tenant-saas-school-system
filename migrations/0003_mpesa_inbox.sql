-- 0003_mpesa_inbox.sql — durable webhook inbox and payment idempotency.
--
-- Safaricom retries callbacks and can deliver duplicates. The handler must
-- persist first and acknowledge fast; allocation happens in a worker. The
-- unique (tenant_id, trans_id) key makes redelivery a no-op.

CREATE TABLE IF NOT EXISTS mpesa_raw_inbox (
    inbox_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         varchar(50) NOT NULL,
    trans_id          varchar(64) NOT NULL,
    sender_phone      varchar(20) NOT NULL,
    sender_name       varchar(128),
    amount            numeric(12,2) NOT NULL,
    account_reference varchar(64),
    raw_payload       jsonb NOT NULL,
    processing_status varchar(20) NOT NULL DEFAULT 'PENDING'
                      CHECK (processing_status IN ('PENDING','PROCESSED','FAILED','MANUAL_REVIEW')),
    attempts          integer NOT NULL DEFAULT 0,
    next_attempt_at   timestamptz NOT NULL DEFAULT now(),
    error_log         text,
    received_at       timestamptz NOT NULL DEFAULT now(),
    processed_at      timestamptz,
    CONSTRAINT uq_mpesa_inbox_tenant_trans UNIQUE (tenant_id, trans_id)
);

CREATE INDEX IF NOT EXISTS idx_mpesa_inbox_pending
    ON mpesa_raw_inbox (next_attempt_at)
    WHERE processing_status = 'PENDING';

ALTER TABLE mpesa_raw_inbox ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mpesa_raw_inbox_isolation ON mpesa_raw_inbox;
CREATE POLICY mpesa_raw_inbox_isolation ON mpesa_raw_inbox
    USING (current_setting('app.worker', true) = 'on' OR tenant_id = current_tenant_id())
    WITH CHECK (current_setting('app.worker', true) = 'on' OR tenant_id = current_tenant_id());

-- A TransID may only ever produce one payment per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_tenant_mpesa
    ON payments (tenant_id, mpesa_trans_id)
    WHERE mpesa_trans_id IS NOT NULL;

-- 0048_payment_reference_unique.sql
--
-- Correction: 0003_mpesa_inbox.sql already created
-- uq_payments_tenant_mpesa on (tenant_id, mpesa_trans_id) WHERE NOT NULL, which
-- is the index the M-Pesa resolve path's ON CONFLICT relies on. An earlier
-- revision of this migration added a duplicate under a different name; this
-- file keeps only the index that was actually missing.

CREATE INDEX IF NOT EXISTS idx_payments_tenant_learner
    ON public.payments (tenant_id, learner_id, received_at DESC);

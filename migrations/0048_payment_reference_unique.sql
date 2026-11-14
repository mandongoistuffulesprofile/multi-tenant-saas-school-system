-- 0048_payment_reference_unique.sql
--
-- Resolving an M-Pesa event inserts the payment with
--   ON CONFLICT (tenant_id, mpesa_trans_id) WHERE mpesa_trans_id IS NOT NULL
-- but no matching unique index was ever created, so the statement failed at
-- runtime ("no unique or exclusion constraint matching the ON CONFLICT
-- specification") and a matched M-Pesa receipt could not be posted at all.
--
-- The index also gives the receipts path its idempotency guarantee: a replayed
-- callback resolves to the existing payment instead of a second one.

CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_tenant_mpesa_trans
    ON public.payments (tenant_id, mpesa_trans_id)
    WHERE mpesa_trans_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_tenant_learner
    ON public.payments (tenant_id, learner_id, received_at DESC);

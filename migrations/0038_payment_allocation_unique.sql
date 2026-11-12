-- 0038_payment_allocation_unique.sql
--
-- Allocating a payment to the same invoice is an idempotent upsert in the
-- allocation path and in the concurrency regression test, which both use
-- ON CONFLICT (payment_id, invoice_id). The baseline never declared that
-- unique key, so the statement failed and no allocation could be recorded.

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_allocations_payment_invoice
    ON public.payment_allocations (payment_id, invoice_id);

-- 0061_payment_ledger_payment_link.sql — link each ledger row to the payment.
--
-- RecordPayment now issues the receipt number and writes the immutable ledger
-- row in the payment's own transaction. Without a link back to the payment, a
-- replayed request (same Idempotency-Key) could not return the receipt number it
-- had already issued, and reconciliation had no way to join the two tables.
--
-- Existing rows keep a NULL payment_id: they predate the link and guessing which
-- payment they belong to would be worse than leaving them unlinked.

ALTER TABLE payment_ledger ADD COLUMN IF NOT EXISTS payment_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_ledger_payment
    ON payment_ledger (payment_id)
    WHERE payment_id IS NOT NULL;

-- 0032_append_only_ledger_enforcement.sql
-- Hardens payment_ledger as an immutable, append-only forensic ledger.
--
-- 1. Relax the amount CHECK so compensating (negative) reversal entries can be
--    recorded. Zero amounts remain prohibited; positive = receipt, negative =
--    reversal/correction.
-- 2. Add a BEFORE DELETE/UPDATE trigger that permanently rejects any attempt to
--    mutate or delete historical ledger rows. Financial traceability must never
--    be rewritten.

-- 1. Amount may now be negative (compensating reversal) but never zero.
ALTER TABLE payment_ledger
    DROP CONSTRAINT IF EXISTS payment_ledger_amount_check;

ALTER TABLE payment_ledger
    ADD CONSTRAINT payment_ledger_amount_check
    CHECK (amount <> 0);

-- 2. Immutable ledger: DELETE and UPDATE are prohibited forever.
CREATE OR REPLACE FUNCTION prevent_ledger_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Financial ledger entries are immutable. % is prohibited on payment_ledger.',
        CASE WHEN TG_OP = 'DELETE' THEN 'DELETE' ELSE 'UPDATE' END;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_ledger_mutation ON payment_ledger;
CREATE TRIGGER trg_prevent_ledger_mutation
    BEFORE DELETE OR UPDATE ON payment_ledger
    FOR EACH ROW
    EXECUTE FUNCTION prevent_ledger_mutation();

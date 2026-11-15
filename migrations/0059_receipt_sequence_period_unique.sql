-- 0059_receipt_sequence_period_unique.sql — one receipt sequence per period.
--
-- receipt_sequences (0001) had no unique constraint on (tenant_id,
-- current_period), only a primary key on sequence_id. Two things depended on
-- that constraint existing and silently did nothing without it:
--
-- * CreateReceiptSequence maps SQLSTATE 23505 to 409 "A sequence already exists
--   for that period". With no constraint, 23505 could never fire, so a school
--   could create two sequences for the same period and FinanceReceiptSequencesPage
--   would list both, with the receipt number then depending on which row was read.
-- * GetReceiptSequence creates the period's default row on a miss, so a GET
--   racing a POST could also leave two rows for one period.
--
-- The invariant belongs in the schema rather than in an upsert: a sequence is
-- identity for "the counter this school uses for this period", and duplicates
-- are meaningless. Existing databases may already hold duplicates, so the
-- migration collapses them first, keeping the row that has issued the most
-- receipts (highest last_number, then lowest sequence_id to break ties).

DELETE FROM receipt_sequences a
USING receipt_sequences b
WHERE a.tenant_id = b.tenant_id
  AND a.current_period = b.current_period
  AND (a.last_number < b.last_number
       OR (a.last_number = b.last_number AND a.sequence_id > b.sequence_id));

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'uq_receipt_sequences_tenant_period'
          AND conrelid = 'receipt_sequences'::regclass
    ) THEN
        ALTER TABLE receipt_sequences
            ADD CONSTRAINT uq_receipt_sequences_tenant_period
            UNIQUE (tenant_id, current_period);
    END IF;
END $$;

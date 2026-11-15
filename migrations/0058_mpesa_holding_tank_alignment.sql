-- 0058_mpesa_holding_tank_alignment.sql — give the holding tank the column the
-- allocation endpoint writes.
--
-- internal/holdingtank reads mpesa_holding_tank (defined in 0019) with the names
-- of an older draft of the table: `msisdn`, `reference`, `allocated_to` and
-- `allocated_at`. The table actually has `sender_phone`, `transaction_code`,
-- `resolved_student_id` and `resolved_by`, so both the list and the allocation
-- failed with `column "msisdn" does not exist`. The queries are repointed at the
-- real columns in this slice; the one thing the table genuinely lacks is a
-- timestamp for when a deposit was allocated, so add it here.

ALTER TABLE mpesa_holding_tank
    ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE mpesa_holding_tank
    ALTER COLUMN status SET DEFAULT 'UNMATCHED';

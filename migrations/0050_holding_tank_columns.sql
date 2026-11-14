-- 0050_holding_tank_columns.sql
--
-- The holding-tank service has always read columns that the table never had:
--
--   SELECT id, tenant_id, msisdn, amount, reference, status, allocated_to,
--          allocated_at, created_at FROM mpesa_holding_tank
--
-- 0019 created the table with transaction_code, sender_phone and
-- resolved_student_id instead, so every List and Resolve call failed with
-- 'column "msisdn" does not exist' and unmatched M-Pesa money could not be
-- reviewed or allocated from the holding tank at all.
--
-- The service's names are the ones in use across the API and the SPA, so the
-- table gains them as aliases of the existing data rather than the service
-- being rewritten around the older names.

ALTER TABLE public.mpesa_holding_tank
    ADD COLUMN IF NOT EXISTS msisdn character varying(20),
    ADD COLUMN IF NOT EXISTS reference character varying(100),
    ADD COLUMN IF NOT EXISTS allocated_to uuid,
    ADD COLUMN IF NOT EXISTS allocated_at timestamp with time zone;

UPDATE public.mpesa_holding_tank
   SET msisdn = COALESCE(msisdn, sender_phone, ''),
       reference = COALESCE(NULLIF(reference, ''), transaction_code);

ALTER TABLE public.mpesa_holding_tank
    ALTER COLUMN msisdn SET DEFAULT '',
    ALTER COLUMN msisdn SET NOT NULL,
    ALTER COLUMN reference SET DEFAULT '',
    ALTER COLUMN reference SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_holding_tank_tenant_status
    ON public.mpesa_holding_tank (tenant_id, status, created_at DESC);

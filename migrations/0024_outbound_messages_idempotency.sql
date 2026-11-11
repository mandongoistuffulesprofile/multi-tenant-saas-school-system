-- 0024_outbound_messages_idempotency.sql
-- Add idempotency support for system-generated outbound messages (receipts/alerts).
-- Safe and additive.

ALTER TABLE public.outbound_messages
  ADD COLUMN IF NOT EXISTS idempotency_key character varying(120);

CREATE UNIQUE INDEX IF NOT EXISTS uq_outbound_messages_idempotency
  ON public.outbound_messages (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

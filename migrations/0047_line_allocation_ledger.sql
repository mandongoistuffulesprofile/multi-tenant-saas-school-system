-- 0047_line_allocation_ledger.sql
--
-- Phase 1 of the boarding/extra-classes/staff-pay programme: make every
-- receipt settle invoice LINES, and make unapplied money an explicit credit.
--
-- Design notes
--   * payment_allocations stays the receipt ledger. New rows carry the line and
--     the votehead they settled; legacy rows keep invoice_line_id NULL and are
--     excluded from line-level views rather than guessed at.
--   * A receipt that exceeds the debt no longer disappears: the remainder is a
--     credits row (a liability), applied to later lines through the same
--     planner with source = 'CREDIT'.
--   * Reversals are negative rows that point at the row they reverse. Nothing
--     is deleted and nothing is partially reversed silently.
--   * Views use security_invoker so they obey the caller's RLS, including the
--     tenant policies on the underlying tables.

-- ----------------------------------------------------------------------------
-- 1. Invoice lines can be cancelled without deleting history.
-- ----------------------------------------------------------------------------
ALTER TABLE public.invoice_lines
    ADD COLUMN IF NOT EXISTS status character varying(20) NOT NULL DEFAULT 'BILLED';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.invoice_lines'::regclass
          AND conname = 'invoice_lines_status_chk'
    ) THEN
        ALTER TABLE public.invoice_lines
            ADD CONSTRAINT invoice_lines_status_chk
            CHECK (status IN ('BILLED', 'CANCELLED')) NOT VALID;
    END IF;
END $$;

ALTER TABLE public.invoice_lines VALIDATE CONSTRAINT invoice_lines_status_chk;

-- ----------------------------------------------------------------------------
-- 2. Line-level allocation ledger
-- ----------------------------------------------------------------------------
ALTER TABLE public.payment_allocations
    ADD COLUMN IF NOT EXISTS invoice_line_id uuid,
    ADD COLUMN IF NOT EXISTS votehead_id uuid,
    ADD COLUMN IF NOT EXISTS credit_id uuid,
    ADD COLUMN IF NOT EXISTS source character varying(10) NOT NULL DEFAULT 'RECEIPT',
    ADD COLUMN IF NOT EXISTS rule character varying(10),
    ADD COLUMN IF NOT EXISTS reverses_allocation_id uuid,
    ADD COLUMN IF NOT EXISTS created_by uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.payment_allocations'::regclass
          AND conname = 'payment_allocations_source_chk'
    ) THEN
        ALTER TABLE public.payment_allocations
            ADD CONSTRAINT payment_allocations_source_chk
            CHECK (source IN ('RECEIPT', 'CREDIT', 'REVERSAL')) NOT VALID;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.payment_allocations'::regclass
          AND conname = 'payment_allocations_amount_nonzero_chk'
    ) THEN
        ALTER TABLE public.payment_allocations
            ADD CONSTRAINT payment_allocations_amount_nonzero_chk
            CHECK (allocated_amount <> 0) NOT VALID;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.payment_allocations'::regclass
          AND conname = 'payment_allocations_line_fkey'
    ) THEN
        ALTER TABLE public.payment_allocations
            ADD CONSTRAINT payment_allocations_line_fkey
            FOREIGN KEY (invoice_line_id) REFERENCES public.invoice_lines (line_id)
            ON DELETE SET NULL NOT VALID;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.payment_allocations'::regclass
          AND conname = 'payment_allocations_credit_fkey'
    ) THEN
        ALTER TABLE public.payment_allocations
            ADD CONSTRAINT payment_allocations_credit_fkey
            FOREIGN KEY (credit_id) REFERENCES public.credits (credit_id)
            ON DELETE SET NULL NOT VALID;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.payment_allocations'::regclass
          AND conname = 'payment_allocations_reverses_fkey'
    ) THEN
        ALTER TABLE public.payment_allocations
            ADD CONSTRAINT payment_allocations_reverses_fkey
            FOREIGN KEY (reverses_allocation_id) REFERENCES public.payment_allocations (allocation_id)
            ON DELETE SET NULL NOT VALID;
    END IF;
END $$;

-- Idempotency keys are per source: a receipt settles a line once, a credit
-- settles a line once, and a reversal reverses a row once. The old
-- (payment_id, invoice_id) index blocked a later credit application from the
-- same payment, so it is replaced by these partial keys.
DROP INDEX IF EXISTS uq_payment_allocations_payment_invoice;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_allocations_receipt_line
    ON public.payment_allocations (payment_id, invoice_line_id)
    WHERE source = 'RECEIPT' AND invoice_line_id IS NOT NULL AND reverses_allocation_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_allocations_credit_line
    ON public.payment_allocations (credit_id, invoice_line_id)
    WHERE credit_id IS NOT NULL AND reverses_allocation_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_allocations_legacy_invoice
    ON public.payment_allocations (payment_id, invoice_id)
    WHERE invoice_line_id IS NULL AND source = 'RECEIPT' AND reverses_allocation_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_allocations_reversal
    ON public.payment_allocations (reverses_allocation_id)
    WHERE reverses_allocation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_allocations_tenant_line
    ON public.payment_allocations (tenant_id, invoice_line_id)
    WHERE invoice_line_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_allocations_tenant_votehead
    ON public.payment_allocations (tenant_id, votehead_id)
    WHERE votehead_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3. Unapplied receipts are a liability, not lost money
-- ----------------------------------------------------------------------------
ALTER TABLE public.credits
    ADD COLUMN IF NOT EXISTS applied_amount numeric(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS status character varying(20) NOT NULL DEFAULT 'UNAPPLIED',
    ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.credits'::regclass
          AND conname = 'credits_applied_within_amount_chk'
    ) THEN
        ALTER TABLE public.credits
            ADD CONSTRAINT credits_applied_within_amount_chk
            CHECK (applied_amount >= 0 AND applied_amount <= amount) NOT VALID;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.credits'::regclass
          AND conname = 'credits_status_chk'
    ) THEN
        ALTER TABLE public.credits
            ADD CONSTRAINT credits_status_chk
            CHECK (status IN ('UNAPPLIED', 'PARTIALLY_APPLIED', 'APPLIED', 'VOID')) NOT VALID;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_credits_tenant_learner_open
    ON public.credits (tenant_id, learner_id)
    WHERE status IN ('UNAPPLIED', 'PARTIALLY_APPLIED');

-- ----------------------------------------------------------------------------
-- 4. Read models: what each line still owes, and what each votehead holds
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_line_outstanding
    WITH (security_invoker = true) AS
SELECT l.tenant_id,
       l.line_id,
       l.invoice_id,
       l.line_amount,
       COALESCE(SUM(a.allocated_amount), 0)::numeric(12,2) AS allocated_amount,
       (l.line_amount - COALESCE(SUM(a.allocated_amount), 0))::numeric(12,2) AS outstanding
  FROM public.invoice_lines l
  LEFT JOIN public.payment_allocations a
         ON a.invoice_line_id = l.line_id
        AND a.tenant_id = l.tenant_id
 WHERE l.status <> 'CANCELLED'
 GROUP BY l.tenant_id, l.line_id, l.invoice_id, l.line_amount;

CREATE OR REPLACE VIEW public.v_votehead_available
    WITH (security_invoker = true) AS
SELECT a.tenant_id,
       a.votehead_id,
       COALESCE(SUM(a.allocated_amount), 0)::numeric(12,2) AS collected
  FROM public.payment_allocations a
 WHERE a.votehead_id IS NOT NULL
 GROUP BY a.tenant_id, a.votehead_id;

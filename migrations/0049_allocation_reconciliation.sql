-- 0049_allocation_reconciliation.sql
--
-- The allocation rewrite makes two promises that must be provable from the
-- data alone, without trusting the code that wrote it:
--
--   1. Money in = money allocated. For every completed receipt, the net
--      allocations plus the unspent prepayment credit it created add back up to
--      the amount received.
--   2. Lines add up to the invoice. For every invoice whose lines are the whole
--      story, the outstanding on its lines equals the invoice's outstanding.
--
-- The view below is the read model; the nightly worker evaluates it and writes
-- any violation to allocation_reconciliation_findings, so a discrepancy is a
-- row someone can look at rather than a log line that scrolls away.
--
-- Legacy rows are classified, not "fixed": invoices with no lines, or with
-- invoice-level allocations written before lines existed, cannot satisfy the
-- line invariant and are reported as their own categories so a real violation
-- never hides behind them.

CREATE TABLE IF NOT EXISTS public.allocation_reconciliation_findings (
    finding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id varchar(50) NOT NULL,
    run_id uuid NOT NULL,
    kind varchar(40) NOT NULL,
    subject_id uuid,
    learner_id uuid,
    expected numeric(12,2),
    actual numeric(12,2),
    delta numeric(12,2),
    detail text,
    detected_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT allocation_reconciliation_findings_unique
        UNIQUE (run_id, kind, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_findings_tenant
    ON public.allocation_reconciliation_findings (tenant_id, detected_at DESC);

ALTER TABLE public.allocation_reconciliation_findings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allocation_reconciliation_findings_isolation
    ON public.allocation_reconciliation_findings;
CREATE POLICY allocation_reconciliation_findings_isolation
    ON public.allocation_reconciliation_findings
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- ----------------------------------------------------------------------------
-- Per-invoice reconciliation
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_allocation_reconciliation
    WITH (security_invoker = true) AS
WITH line_alloc AS (
    SELECT tenant_id, invoice_line_id, SUM(allocated_amount) AS allocated
      FROM public.payment_allocations
     WHERE invoice_line_id IS NOT NULL
     GROUP BY tenant_id, invoice_line_id
), inv_alloc AS (
    SELECT tenant_id,
           invoice_id,
           COALESCE(SUM(allocated_amount) FILTER (WHERE invoice_line_id IS NOT NULL), 0) AS line_allocated,
           COALESCE(SUM(allocated_amount) FILTER (WHERE invoice_line_id IS NULL), 0) AS invoice_allocated
      FROM public.payment_allocations
     GROUP BY tenant_id, invoice_id
), lines AS (
    SELECT tenant_id,
           invoice_id,
           COALESCE(SUM(line_amount) FILTER (WHERE status <> 'CANCELLED'), 0) AS line_total,
           COUNT(*) AS line_count
      FROM public.invoice_lines
     GROUP BY tenant_id, invoice_id
)
SELECT i.tenant_id,
       i.invoice_id,
       i.learner_id,
       i.status,
       i.total_amount,
       i.amount_paid,
       i.amount_outstanding,
       COALESCE(l.line_total, 0)::numeric(12,2) AS line_total,
       COALESCE(a.line_allocated, 0)::numeric(12,2) AS line_allocated,
       COALESCE(a.invoice_allocated, 0)::numeric(12,2) AS invoice_allocated,
       (COALESCE(l.line_total, 0) - COALESCE(a.line_allocated, 0))::numeric(12,2) AS line_outstanding,
       (i.total_amount - i.amount_paid)::numeric(12,2) AS expected_outstanding,
       CASE
           WHEN COALESCE(l.line_count, 0) = 0 THEN 'NO_LINES'
           WHEN COALESCE(a.invoice_allocated, 0) <> 0 THEN 'LEGACY_INVOICE_LEVEL'
           WHEN (COALESCE(l.line_total, 0) - COALESCE(a.line_allocated, 0)) <> i.amount_outstanding THEN 'LINE_MISMATCH'
           WHEN i.amount_paid <> COALESCE(a.line_allocated, 0) + COALESCE(a.invoice_allocated, 0) THEN 'PAID_MISMATCH'
           ELSE 'OK'
       END AS reconciliation_status
  FROM public.invoices i
  LEFT JOIN inv_alloc a ON a.tenant_id = i.tenant_id AND a.invoice_id = i.invoice_id
  LEFT JOIN lines l ON l.tenant_id = i.tenant_id AND l.invoice_id = i.invoice_id;

-- ----------------------------------------------------------------------------
-- Per-learner prepayment reconciliation
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_learner_prepayment
    WITH (security_invoker = true) AS
WITH credit AS (
    SELECT tenant_id,
           learner_id,
           COALESCE(SUM(amount) FILTER (WHERE status <> 'VOID'), 0) AS credit_created,
           COALESCE(SUM(applied_amount) FILTER (WHERE status <> 'VOID'), 0) AS credit_applied,
           COALESCE(SUM(amount - applied_amount) FILTER (WHERE status <> 'VOID'), 0) AS credit_outstanding
      FROM public.credits
     GROUP BY tenant_id, learner_id
), spent AS (
    SELECT pa.tenant_id, i.learner_id, COALESCE(SUM(pa.allocated_amount), 0) AS credit_allocated
      FROM public.payment_allocations pa
      JOIN public.invoices i ON i.invoice_id = pa.invoice_id AND i.tenant_id = pa.tenant_id
     WHERE pa.source IN ('CREDIT', 'REVERSAL') AND pa.credit_id IS NOT NULL
     GROUP BY pa.tenant_id, i.learner_id
)
SELECT c.tenant_id,
       c.learner_id,
       c.credit_created,
       c.credit_applied,
       c.credit_outstanding,
       COALESCE(s.credit_allocated, 0)::numeric(12,2) AS credit_allocated,
       (c.credit_applied - COALESCE(s.credit_allocated, 0))::numeric(12,2) AS credit_delta
  FROM credit c
  LEFT JOIN spent s ON s.tenant_id = c.tenant_id AND s.learner_id = c.learner_id;

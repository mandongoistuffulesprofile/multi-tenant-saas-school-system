-- 0052_normalize_invoice_status.sql
--
-- CreateInvoice stored 'OUTSTANDING' as the status of every invoice created
-- through the finance modal. That value is not a lifecycle state: the invoice
-- state machine cannot transition it, and the receipt allocator only locks
-- ISSUED, PARTIALLY_PAID and OVERDUE invoices.
--
-- The result was quiet and expensive: an invoice raised in the UI could never
-- be paid. Every receipt left it untouched and was recorded as a prepayment
-- credit instead, so the learner's arrears stayed visible while their money
-- sat on account.
--
-- The code now defaults to ISSUED and rejects unknown states. This migration
-- brings the invoices already stored the old way back into the lifecycle, with
-- their amounts deciding the correct state rather than a blind ISSUED.

UPDATE public.invoices
   SET status = CASE
                    WHEN amount_outstanding <= 0 AND amount_paid > 0 THEN 'PAID'
                    WHEN amount_paid > 0 THEN 'PARTIALLY_PAID'
                    ELSE 'ISSUED'
                END,
       updated_at = CURRENT_TIMESTAMP
 WHERE status = 'OUTSTANDING';

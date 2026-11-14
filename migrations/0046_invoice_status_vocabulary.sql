-- 0046_invoice_status_vocabulary.sql
--
-- The invoice state machine stored its terminal state as 'FULLY_PAID', while
-- every other writer (M-Pesa resolve, manual payment, in-kind credit, holding
-- tank, Daraja callback) stored 'PAID', which is also what the SPA reads.
-- TransitionInvoice could not read 'PAID' back, so an invoice paid through any
-- of those paths rejected its next allocation with "unknown invoice state".
--
-- The canonical value is now 'PAID'. This migration brings old rows across;
-- the state machine also normalises legacy strings on read, so a row missed
-- here still behaves correctly.

UPDATE invoices SET status = 'PAID' WHERE status = 'FULLY_PAID';

-- Reporting still treats OVERDUE as a derived condition, not a stored state.
-- Existing rows keep their value; readers normalize it.

-- Open-invoice lookups are on the hot path of every receipt.
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_learner_outstanding
    ON invoices (tenant_id, learner_id)
    WHERE amount_outstanding > 0;

CREATE INDEX IF NOT EXISTS idx_invoices_tenant_learners_open
    ON invoices (tenant_id, learner_id, status)
    WHERE status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE');

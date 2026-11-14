package finance

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/money"
)

// FindingKind classifies one reconciliation violation.
type FindingKind string

const (
	FindingLineMismatch    FindingKind = "LINE_MISMATCH"
	FindingPaidMismatch    FindingKind = "PAID_MISMATCH"
	FindingReceiptMismatch FindingKind = "RECEIPT_MISMATCH"
	FindingOrphanReceipt   FindingKind = "ORPHAN_RECEIPT"
	FindingPrepayment      FindingKind = "PREPAYMENT_MISMATCH"
	FindingStatusMismatch  FindingKind = "STATUS_MISMATCH"
)

// Finding is one proven discrepancy between what the ledger says and what the
// invoice or receipt records say. It is deliberately small and numeric: a
// bursar needs to see the invoice, the two figures and the difference.
type Finding struct {
	Kind      FindingKind
	SubjectID string
	LearnerID string
	Expected  money.Decimal
	Actual    money.Decimal
	Detail    string
}

// ReconcileTenant evaluates the allocation invariants for one tenant.
//
// It proves, from the rows themselves:
//   - each invoice's line outstanding equals its recorded outstanding;
//   - amount_paid equals the allocations posted against the invoice;
//   - each completed receipt's net allocations plus the prepayment credit it
//     created equal the amount received;
//   - prepayment marked applied equals prepayment actually allocated;
//   - the stored invoice status matches its own amounts.
//
// An empty result means the tenant reconciles. Findings are not "fixed" here:
// deciding what a discrepancy means is a human decision, and silently rewriting
// money is how discrepancies become invisible.
func ReconcileTenant(ctx context.Context, q allocQueryer, tenantID string) ([]Finding, error) {
	var findings []Finding

	invoiceRows, err := q.QueryContext(ctx, `
		SELECT invoice_id::text,
		       COALESCE(learner_id::text, ''),
		       reconciliation_status,
		       amount_outstanding::text,
		       line_outstanding::text,
		       amount_paid::text,
		       (line_allocated + invoice_allocated)::text
		  FROM v_allocation_reconciliation
		 WHERE tenant_id = $1
		   AND reconciliation_status IN ('LINE_MISMATCH', 'PAID_MISMATCH')
		 ORDER BY invoice_id`, tenantID)
	if err != nil {
		return nil, err
	}
	for invoiceRows.Next() {
		var (
			invoiceID, learnerID, status      string
			outstanding, lineOut, paid, alloc string
		)
		if err := invoiceRows.Scan(&invoiceID, &learnerID, &status, &outstanding, &lineOut, &paid, &alloc); err != nil {
			invoiceRows.Close()
			return nil, err
		}
		kind := FindingLineMismatch
		expected, actual := money.New(outstanding), money.New(lineOut)
		if status == "PAID_MISMATCH" {
			kind = FindingPaidMismatch
			expected, actual = money.New(paid), money.New(alloc)
		}
		findings = append(findings, Finding{
			Kind:      kind,
			SubjectID: invoiceID,
			LearnerID: learnerID,
			Expected:  expected,
			Actual:    actual,
			Detail:    fmt.Sprintf("invoice %s: %s (expected %s, actual %s)", invoiceID, status, expected.StringFixed(2), actual.StringFixed(2)),
		})
	}
	invoiceRows.Close()
	if err := invoiceRows.Err(); err != nil {
		return nil, err
	}

	receiptRows, err := q.QueryContext(ctx, `
		WITH alloc AS (
		    SELECT payment_id,
		           COALESCE(SUM(allocated_amount), 0) AS net,
		           COUNT(*) FILTER (WHERE source = 'REVERSAL') AS reversals
		      FROM payment_allocations
		     WHERE tenant_id = $1
		     GROUP BY payment_id
		), credit AS (
		    SELECT source_payment_id,
		           COALESCE(SUM(amount) FILTER (WHERE status <> 'VOID'), 0) AS credit_amount
		      FROM credits
		     WHERE tenant_id = $1 AND source_payment_id IS NOT NULL
		     GROUP BY source_payment_id
		)
		SELECT p.payment_id::text,
		       COALESCE(p.learner_id::text, ''),
		       p.amount::text,
		       COALESCE(a.net, 0)::text,
		       COALESCE(a.reversals, 0),
		       COALESCE(c.credit_amount, 0)::text
		  FROM payments p
		  LEFT JOIN alloc a ON a.payment_id = p.payment_id
		  LEFT JOIN credit c ON c.source_payment_id = p.payment_id
		 WHERE p.tenant_id = $1 AND p.status = 'COMPLETED'
		 ORDER BY p.payment_id`, tenantID)
	if err != nil {
		return nil, err
	}
	for receiptRows.Next() {
		var (
			paymentID, learnerID      string
			amount, net, creditAmount string
			reversals                 int
		)
		if err := receiptRows.Scan(&paymentID, &learnerID, &amount, &net, &reversals, &creditAmount); err != nil {
			receiptRows.Close()
			return nil, err
		}
		received := money.New(amount)
		placed := money.New(net).Add(money.New(creditAmount))
		expected := received
		if reversals > 0 {
			// A reversed receipt must leave nothing placed and no live credit.
			expected = money.Zero()
		}
		if placed.Equal(expected) {
			continue
		}

		kind := FindingReceiptMismatch
		detail := fmt.Sprintf("receipt %s: %s received, %s allocated or held", paymentID, received.StringFixed(2), placed.StringFixed(2))
		if reversals == 0 && money.New(net).IsZero() && money.New(creditAmount).IsZero() {
			kind = FindingOrphanReceipt
			detail = fmt.Sprintf("receipt %s: %s received with no allocation and no credit", paymentID, received.StringFixed(2))
		}
		findings = append(findings, Finding{
			Kind:      kind,
			SubjectID: paymentID,
			LearnerID: learnerID,
			Expected:  expected,
			Actual:    placed,
			Detail:    detail,
		})
	}
	receiptRows.Close()
	if err := receiptRows.Err(); err != nil {
		return nil, err
	}

	creditRows, err := q.QueryContext(ctx, `
		SELECT learner_id::text, credit_applied::text, credit_allocated::text
		  FROM v_learner_prepayment
		 WHERE tenant_id = $1 AND credit_delta <> 0
		 ORDER BY learner_id`, tenantID)
	if err != nil {
		return nil, err
	}
	for creditRows.Next() {
		var learnerID, applied, allocated string
		if err := creditRows.Scan(&learnerID, &applied, &allocated); err != nil {
			creditRows.Close()
			return nil, err
		}
		findings = append(findings, Finding{
			Kind:      FindingPrepayment,
			LearnerID: learnerID,
			Expected:  money.New(applied),
			Actual:    money.New(allocated),
			Detail:    fmt.Sprintf("learner %s: %s marked applied, %s actually allocated", learnerID, applied, allocated),
		})
	}
	creditRows.Close()
	if err := creditRows.Err(); err != nil {
		return nil, err
	}

	statusRows, err := q.QueryContext(ctx, `
		SELECT invoice_id::text, COALESCE(learner_id::text, ''), status,
		       amount_paid::text, total_amount::text
		  FROM invoices
		 WHERE tenant_id = $1
		   AND (
		       (status = 'PAID' AND (amount_outstanding <> 0 OR amount_paid <= 0))
		    OR (status = 'PARTIALLY_PAID' AND (amount_paid <= 0 OR amount_outstanding <= 0))
		    OR (status IN ('ISSUED', 'OVERDUE') AND amount_paid <> 0)
		   )
		 ORDER BY invoice_id`, tenantID)
	if err != nil {
		return nil, err
	}
	for statusRows.Next() {
		var invoiceID, learnerID, status, paid, total string
		if err := statusRows.Scan(&invoiceID, &learnerID, &status, &paid, &total); err != nil {
			statusRows.Close()
			return nil, err
		}
		findings = append(findings, Finding{
			Kind:      FindingStatusMismatch,
			SubjectID: invoiceID,
			LearnerID: learnerID,
			Expected:  money.New(total),
			Actual:    money.New(paid),
			Detail:    fmt.Sprintf("invoice %s: status %s with %s paid of %s", invoiceID, status, paid, total),
		})
	}
	statusRows.Close()
	return findings, statusRows.Err()
}

// RecordFindings persists one reconciliation run's findings. A run id ties the
// rows together so a later run can be compared with an earlier one instead of
// overwriting the evidence.
func RecordFindings(ctx context.Context, q allocQueryer, tenantID, runID string, findings []Finding) error {
	for _, finding := range findings {
		var subject interface{}
		if finding.SubjectID != "" {
			subject = finding.SubjectID
		}
		var learner interface{}
		if finding.LearnerID != "" {
			learner = finding.LearnerID
		}
		if _, err := q.ExecContext(ctx, `
			INSERT INTO allocation_reconciliation_findings
			    (tenant_id, run_id, kind, subject_id, learner_id, expected, actual, delta, detail)
			VALUES ($1, $2::uuid, $3, NULLIF($4, '')::uuid, NULLIF($5, '')::uuid,
			        $6::numeric, $7::numeric, $8::numeric, $9)
			ON CONFLICT (run_id, kind, subject_id) DO NOTHING`,
			tenantID, runID, string(finding.Kind), subject, learner,
			finding.Expected.StringFixed(2), finding.Actual.StringFixed(2),
			finding.Actual.Sub(finding.Expected).StringFixed(2), finding.Detail); err != nil {
			return err
		}
	}
	return nil
}

// ReconcileWorker evaluates the invariants nightly and persists any violation.
// It never mutates money: its job is to make a discrepancy impossible to miss,
// not to guess what it should have been.
type ReconcileWorker struct {
	db     *sql.DB
	logger *slog.Logger
}

func NewReconcileWorker(db *sql.DB, logger *slog.Logger) *ReconcileWorker {
	return &ReconcileWorker{db: db, logger: logger}
}

// Start runs one reconciliation immediately and then every interval, so a
// deployment does not have to wait a day for its first answer.
func (w *ReconcileWorker) Start(ctx context.Context, interval time.Duration) {
	if count, err := w.RunOnce(ctx); err != nil {
		w.logger.Error("Allocation reconciliation failed", "error", err)
	} else if count > 0 {
		w.logger.Warn("Allocation reconciliation found discrepancies", "findings", count)
	}

	ticker := time.NewTicker(interval)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				w.logger.Info("Terminating allocation reconciliation worker")
				return
			case <-ticker.C:
				count, err := w.RunOnce(ctx)
				if err != nil {
					w.logger.Error("Allocation reconciliation failed", "error", err)
					continue
				}
				if count > 0 {
					w.logger.Warn("Allocation reconciliation found discrepancies", "findings", count)
				}
			}
		}
	}()
}

// RunOnce reconciles every tenant in one pass and returns the finding count.
func (w *ReconcileWorker) RunOnce(ctx context.Context) (int, error) {
	if w == nil || w.db == nil {
		return 0, errors.New("reconciliation worker has no database")
	}
	tx, err := w.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return 0, fmt.Errorf("begin reconciliation tx: %w", err)
	}
	defer tx.Rollback()

	// The worker needs to see every tenant to enumerate them, exactly as the
	// M-Pesa worker does; each tenant's findings are then evaluated with that
	// tenant's RLS context set.
	if _, err := tx.ExecContext(ctx, "SELECT set_config('app.worker', 'on', true)"); err != nil {
		return 0, err
	}

	rows, err := tx.QueryContext(ctx, `SELECT tenant_id FROM schools ORDER BY tenant_id`)
	if err != nil {
		return 0, err
	}
	var tenants []string
	for rows.Next() {
		var tenantID string
		if err := rows.Scan(&tenantID); err != nil {
			rows.Close()
			return 0, err
		}
		tenants = append(tenants, tenantID)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}

	runID := uuid.NewString()
	total := 0
	for _, tenantID := range tenants {
		if _, err := tx.ExecContext(ctx, "SELECT set_config('app.current_tenant_id', $1, true)", tenantID); err != nil {
			return total, err
		}
		findings, err := ReconcileTenant(ctx, tx, tenantID)
		if err != nil {
			return total, fmt.Errorf("tenant %s: %w", tenantID, err)
		}
		if err := RecordFindings(ctx, tx, tenantID, runID, findings); err != nil {
			return total, fmt.Errorf("tenant %s: %w", tenantID, err)
		}
		total += len(findings)
	}

	if err := tx.Commit(); err != nil {
		return total, err
	}
	return total, nil
}

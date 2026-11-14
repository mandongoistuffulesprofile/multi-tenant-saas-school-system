package finance

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/money"
)

// allocQueryer is the small slice of a transaction the allocator needs. Both
// *sql.Tx (the M-Pesa worker) and *sqlx.Tx (tenant handlers) satisfy it, so one
// implementation serves every receipt path.
type allocQueryer interface {
	ExecContext(ctx context.Context, query string, args ...interface{}) (sql.Result, error)
	QueryContext(ctx context.Context, query string, args ...interface{}) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...interface{}) *sql.Row
}

// syntheticLinePrefix marks a plan entry that settles invoice debt which has no
// invoice line (invoices created before lines were mandatory). Those rows are
// written at invoice level, exactly like legacy allocations.
const syntheticLinePrefix = "invoice:"

// ReceiptApplication is one cleared receipt about to be spread over a learner's
// open lines.
type ReceiptApplication struct {
	TenantID     string
	UserID       string
	PaymentID    string
	LearnerID    string
	Amount       money.Decimal
	HintVotehead string
	// OnlyInvoiceID restricts the receipt to one invoice, for a bursar who
	// picked a specific bill. Empty means the whole learner account.
	OnlyInvoiceID string
	Rule          AllocationRule
	// Reference is stored on the immutable payment ledger row. It must be
	// unique per (tenant, invoice) because the ledger enforces that.
	Reference string
}

// ReceiptOutcome reports what the applier actually did.
type ReceiptOutcome struct {
	Allocated   money.Decimal
	Prepayment  money.Decimal
	Allocations []LineAllocation
	InvoiceIDs  []string
}

type lockedInvoice struct {
	ID          string
	Status      string
	Total       string
	Paid        string
	Outstanding string
}

// ApplyReceipt spreads a receipt over the learner's open lines in one
// transaction. It locks the learner's open invoices first, then reads the line
// balances, so a concurrent receipt either waits or sees the updated balances
// rather than both of them overpaying the same line.
func ApplyReceipt(ctx context.Context, q allocQueryer, app ReceiptApplication) (*ReceiptOutcome, error) {
	if app.TenantID == "" || app.LearnerID == "" || app.PaymentID == "" {
		return nil, errors.New("allocation requires tenant, learner and payment")
	}
	if !app.Amount.IsPositive() {
		return nil, errors.New("allocation amount must be positive")
	}
	rule := app.Rule
	if rule != AllocationProRata {
		rule = AllocationPriority
	}

	invoices, err := lockOpenInvoices(ctx, q, app.TenantID, app.LearnerID, app.OnlyInvoiceID)
	if err != nil {
		return nil, err
	}
	if len(invoices) == 0 {
		// No debt: the whole receipt is a prepayment credit.
		if err := recordPrepaymentCredit(ctx, q, app); err != nil {
			return nil, err
		}
		return &ReceiptOutcome{
			Allocated:   money.Zero(),
			Prepayment:  app.Amount,
			Allocations: nil,
		}, nil
	}

	lines, err := loadOpenLines(ctx, q, app.TenantID, invoices)
	if err != nil {
		return nil, err
	}

	plan := PlanAllocation(AllocationRequest{
		Receipt:      app.Amount,
		HintVotehead: app.HintVotehead,
		Rule:         rule,
		Lines:        lines,
	})

	outcome := &ReceiptOutcome{
		Allocated:   money.Zero(),
		Prepayment:  plan.Prepayment,
		Allocations: plan.Allocations,
	}
	if len(plan.Allocations) == 0 {
		if err := recordPrepaymentCredit(ctx, q, app); err != nil {
			return nil, err
		}
		return outcome, nil
	}

	byInvoice := make(map[string][]LineAllocation)
	order := make([]string, 0, len(invoices))
	for _, line := range plan.Allocations {
		if _, seen := byInvoice[line.InvoiceID]; !seen {
			order = append(order, line.InvoiceID)
		}
		byInvoice[line.InvoiceID] = append(byInvoice[line.InvoiceID], line)
	}

	for _, invoiceID := range order {
		invoice, ok := invoices[invoiceID]
		if !ok {
			continue
		}
		allocations := byInvoice[invoiceID]
		if err := applyInvoiceAllocations(ctx, q, app, invoice, allocations, &outcome.Allocated); err != nil {
			return nil, err
		}
		outcome.InvoiceIDs = append(outcome.InvoiceIDs, invoiceID)
	}

	if plan.Prepayment.IsPositive() {
		if err := recordPrepaymentCredit(ctx, q, app); err != nil {
			return nil, err
		}
	}
	return outcome, nil
}

// lockOpenInvoices takes a row lock on every invoice that can still accept
// money, in a deterministic order, and returns them keyed by id.
func lockOpenInvoices(ctx context.Context, q allocQueryer, tenantID, learnerID, onlyInvoiceID string) (map[string]*lockedInvoice, error) {
	query := `
		SELECT invoice_id::text, status, total_amount::text, amount_paid::text, amount_outstanding::text
		  FROM invoices
		 WHERE tenant_id = $1 AND learner_id = $2
		   AND amount_outstanding > 0
		   AND status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE')`
	args := []interface{}{tenantID, learnerID}
	if onlyInvoiceID != "" {
		query += ` AND invoice_id = $3::uuid`
		args = append(args, onlyInvoiceID)
	}
	query += ` ORDER BY invoice_id FOR UPDATE`
	rows, err := q.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make(map[string]*lockedInvoice)
	for rows.Next() {
		var inv lockedInvoice
		if err := rows.Scan(&inv.ID, &inv.Status, &inv.Total, &inv.Paid, &inv.Outstanding); err != nil {
			return nil, err
		}
		out[inv.ID] = &inv
	}
	return out, rows.Err()
}

// loadOpenLines reads every billable line of the locked invoices and caps the
// line balances at the invoice's authoritative outstanding figure, so a legacy
// invoice-level payment (which has no line) shrinks the pool rather than being
// paid twice.
func loadOpenLines(ctx context.Context, q allocQueryer, tenantID string, invoices map[string]*lockedInvoice) ([]LineState, error) {
	type lineRow struct {
		state       LineState
		remaining   string
		invoiceID   string
		termStart   time.Time
		lineStatus  string
		lineAmount  string
		allocatedAt string
	}

	all := make([]LineState, 0, 16)
	for _, invoiceID := range sortedInvoiceIDs(invoices) {
		invoice := invoices[invoiceID]
		rows, err := q.QueryContext(ctx, `
			SELECT l.line_id::text,
			       COALESCE(fc.votehead_id::text, ''),
			       COALESCE(t.start_date, i.issue_date, i.created_at::date)::date,
			       (l.line_amount - COALESCE(la.allocated, 0))::text,
			       l.status
			  FROM invoice_lines l
			  JOIN invoices i ON i.invoice_id = l.invoice_id AND i.tenant_id = l.tenant_id
			  LEFT JOIN terms t ON t.term_id = COALESCE(l.term_id, i.term_id) AND t.tenant_id = l.tenant_id
			  LEFT JOIN fee_categories fc ON fc.category_id = l.category_id
			  LEFT JOIN (
			      SELECT invoice_line_id, SUM(allocated_amount) AS allocated
			        FROM payment_allocations
			       WHERE tenant_id = $1 AND invoice_line_id IS NOT NULL
			       GROUP BY invoice_line_id
			  ) la ON la.invoice_line_id = l.line_id
			 WHERE l.tenant_id = $1 AND i.invoice_id = $2::uuid
			 ORDER BY 3, 2, 1`, tenantID, invoiceID)
		if err != nil {
			return nil, err
		}

		lines := make([]LineState, 0, 8)
		var termStart time.Time
		for rows.Next() {
			var (
				lineID, votehead, remaining, status string
				started                             time.Time
			)
			if err := rows.Scan(&lineID, &votehead, &started, &remaining, &status); err != nil {
				rows.Close()
				return nil, err
			}
			if termStart.IsZero() || started.Before(termStart) {
				termStart = started
			}
			lines = append(lines, LineState{
				LineID:      lineID,
				InvoiceID:   invoiceID,
				VoteheadID:  votehead,
				TermStart:   started,
				Outstanding: money.New(remaining),
				Cancelled:   strings.EqualFold(status, "CANCELLED"),
			})
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, err
		}

		pool := money.New(invoice.Outstanding)
		if termStart.IsZero() {
			termStart = time.Now()
		}
		all = append(all, capToPool(lines, pool, invoiceID, termStart)...)
	}
	return all, nil
}

// capToPool makes the line balances add up to the invoice's outstanding figure.
// Lines that exceed the pool are trimmed oldest first (legacy receipt order);
// a pool larger than the lines leaves a synthetic invoice-level balance.
func capToPool(lines []LineState, pool money.Decimal, invoiceID string, termStart time.Time) []LineState {
	var sum money.Decimal
	for _, line := range lines {
		if line.Cancelled {
			continue
		}
		sum = sum.Add(line.Outstanding)
	}

	trim := sum.Sub(pool)
	if trim.IsPositive() {
		for i := range lines {
			if !trim.IsPositive() {
				break
			}
			if lines[i].Cancelled || !lines[i].Outstanding.IsPositive() {
				continue
			}
			if lines[i].Outstanding.GreaterThan(trim) {
				lines[i].Outstanding = lines[i].Outstanding.Sub(trim)
				trim = money.Zero()
				break
			}
			trim = trim.Sub(lines[i].Outstanding)
			lines[i].Outstanding = money.Zero()
		}
		return lines
	}

	if shortfall := pool.Sub(sum); shortfall.IsPositive() {
		lines = append(lines, LineState{
			LineID:      syntheticLinePrefix + invoiceID,
			InvoiceID:   invoiceID,
			TermStart:   termStart,
			Outstanding: shortfall,
		})
	}
	return lines
}

func sortedInvoiceIDs(invoices map[string]*lockedInvoice) []string {
	ids := make([]string, 0, len(invoices))
	for id := range invoices {
		ids = append(ids, id)
	}
	// Small maps: a plain insertion sort keeps this dependency-free.
	for i := 1; i < len(ids); i++ {
		for j := i; j > 0 && ids[j] < ids[j-1]; j-- {
			ids[j], ids[j-1] = ids[j-1], ids[j]
		}
	}
	return ids
}

// applyInvoiceAllocations writes one allocation row per line, moves the invoice
// through the state machine and appends the immutable ledger row.
func applyInvoiceAllocations(ctx context.Context, q allocQueryer, app ReceiptApplication, invoice *lockedInvoice, allocations []LineAllocation, allocated *money.Decimal) error {
	var batch money.Decimal
	for _, allocation := range allocations {
		batch = batch.Add(allocation.Amount)
	}
	outstanding := money.New(invoice.Outstanding)
	if batch.GreaterThan(outstanding) {
		batch = outstanding
	}
	if !batch.IsPositive() {
		return nil
	}

	total := money.New(invoice.Total)
	paid := money.New(invoice.Paid)
	newPaid := paid.Add(batch)
	newOutstanding := outstanding.Sub(batch)
	if newOutstanding.IsNegative() {
		newOutstanding = money.Zero()
	}

	nextState, err := TransitionInvoice(NormalizeInvoiceState(invoice.Status), EventApplyCredit, InvoiceContext{
		TotalAmount:       total,
		PaidAmount:        newPaid,
		AmountOutstanding: newOutstanding,
	})
	if err != nil {
		return fmt.Errorf("invoice %s: %w", invoice.ID, err)
	}

	if _, err := q.ExecContext(ctx, `
		UPDATE invoices
		   SET amount_paid = $1::numeric,
		       amount_outstanding = $2::numeric,
		       status = $3,
		       paid_at = CASE WHEN $1::numeric >= $4::numeric THEN COALESCE(paid_at, CURRENT_TIMESTAMP) ELSE paid_at END,
		       updated_at = CURRENT_TIMESTAMP
		 WHERE invoice_id = $5::uuid AND tenant_id = $6`,
		newPaid.StringFixed(2), newOutstanding.StringFixed(2), string(nextState), total.StringFixed(2), invoice.ID, app.TenantID); err != nil {
		return err
	}
	logAllocationTransition(ctx, q, app.TenantID, invoice.ID, invoice.Status, string(nextState), string(EventApplyCredit), app.UserID, "receipt allocation")

	for _, allocation := range allocations {
		lineID := allocation.LineID
		voteheadID := allocation.VoteheadID
		if strings.HasPrefix(lineID, syntheticLinePrefix) {
			lineID = ""
		}
		if _, err := q.ExecContext(ctx, `
			INSERT INTO payment_allocations
			    (tenant_id, payment_id, invoice_id, invoice_line_id, votehead_id,
			     source, rule, allocated_amount, allocated_by, created_by)
			VALUES ($1, $2::uuid, $3::uuid, NULLIF($4, '')::uuid, NULLIF($5, '')::uuid,
			        'RECEIPT', $6, $7::numeric, $8, NULLIF($8, '')::uuid)
			ON CONFLICT DO NOTHING`,
			app.TenantID, app.PaymentID, invoice.ID, lineID, voteheadID,
			string(allocation.Rule), allocation.Amount.StringFixed(2), app.UserID); err != nil {
			return err
		}
		*allocated = allocated.Add(allocation.Amount)
	}

	// Immutable ledger row. The receipt number is per invoice so a receipt
	// covering several invoices cannot collide with itself.
	receiptNumber := app.Reference
	if receiptNumber == "" {
		receiptNumber = app.PaymentID
	}
	receiptNumber = fmt.Sprintf("%s#%s", receiptNumber, shortInvoiceRef(invoice.ID))
	if _, err := q.ExecContext(ctx, `
		INSERT INTO payment_ledger
		    (tenant_id, receipt_number, student_id, invoice_id, amount,
		     balance_before, balance_after, allocated_by)
		VALUES ($1, $2, $3::uuid, $4::uuid, $5::numeric, $6::numeric, $7::numeric, $8)
		ON CONFLICT (tenant_id, receipt_number) DO NOTHING`,
		app.TenantID, receiptNumber, app.LearnerID, invoice.ID, batch.StringFixed(2),
		outstanding.StringFixed(2), newOutstanding.StringFixed(2), ledgerActor(app.UserID)); err != nil {
		return err
	}

	invoice.Status = string(nextState)
	invoice.Paid = newPaid.StringFixed(2)
	invoice.Outstanding = newOutstanding.StringFixed(2)
	return nil
}

func ledgerActor(userID string) string {
	if strings.TrimSpace(userID) == "" {
		return "SYSTEM_WORKER"
	}
	return userID
}

func shortInvoiceRef(id string) string {
	if len(id) < 8 {
		return id
	}
	return id[:8]
}

// recordPrepaymentCredit parks money that exceeds the learner's debt as a
// liability. It is never revenue and never a votehead balance.
func recordPrepaymentCredit(ctx context.Context, q allocQueryer, app ReceiptApplication) error {
	if !app.Amount.IsPositive() {
		return nil
	}
	_, err := q.ExecContext(ctx, `
		INSERT INTO credits (tenant_id, learner_id, amount, currency, reason,
		                     source_payment_id, created_by, applied_amount, status)
		SELECT $1, $2::uuid, $3::numeric, 'KES', 'UNAPPLIED_RECEIPT',
		       $4::uuid, NULLIF($5, '')::uuid, 0, 'UNAPPLIED'
		 WHERE NOT EXISTS (
		     SELECT 1 FROM credits
		      WHERE tenant_id = $1 AND source_payment_id = $4::uuid
		 )`,
		app.TenantID, app.LearnerID, app.Amount.StringFixed(2), app.PaymentID, app.UserID)
	return err
}

// ReceiptSummary is what the reversal needs to know about one allocation.
type receiptAllocation struct {
	AllocationID string
	InvoiceID    string
	LineID       string
	Amount       string
	VoteheadID   string
}

// ReverseReceipt voids a receipt by posting negative allocation rows that point
// at the originals and walking each invoice back down. It refuses while a
// prepayment credit created by the receipt has already been spent, because a
// partial silent reversal is precisely what a bursar must be told about.
func ReverseReceipt(ctx context.Context, q allocQueryer, tenantID, userID, paymentID, reason string) error {
	rows, err := q.QueryContext(ctx, `
		SELECT allocation_id::text, invoice_id::text, COALESCE(invoice_line_id::text, ''),
		       allocated_amount::text, COALESCE(votehead_id::text, '')
		  FROM payment_allocations
		 WHERE tenant_id = $1 AND payment_id = $2::uuid
		   AND source = 'RECEIPT' AND reverses_allocation_id IS NULL
		   AND allocated_amount > 0
		 FOR UPDATE`, tenantID, paymentID)
	if err != nil {
		return err
	}
	var originals []receiptAllocation
	for rows.Next() {
		var row receiptAllocation
		if err := rows.Scan(&row.AllocationID, &row.InvoiceID, &row.LineID, &row.Amount, &row.VoteheadID); err != nil {
			rows.Close()
			return err
		}
		originals = append(originals, row)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	if len(originals) == 0 {
		return errors.New("no allocations to reverse for this receipt")
	}

	var spent int
	if err := q.QueryRowContext(ctx, `
		SELECT count(*) FROM credits
		 WHERE tenant_id = $1 AND source_payment_id = $2::uuid AND applied_amount > 0`,
		tenantID, paymentID).Scan(&spent); err != nil {
		return err
	}
	if spent > 0 {
		return errors.New("this receipt's prepayment has already been applied to other lines; reverse those applications first")
	}

	byInvoice := make(map[string][]receiptAllocation)
	for _, row := range originals {
		byInvoice[row.InvoiceID] = append(byInvoice[row.InvoiceID], row)
	}

	for invoiceID, allocations := range byInvoice {
		var total, paid, outstanding, status string
		if err := q.QueryRowContext(ctx, `
			SELECT total_amount::text, amount_paid::text, amount_outstanding::text, status
			  FROM invoices
			 WHERE tenant_id = $1 AND invoice_id = $2::uuid
			 FOR UPDATE`, tenantID, invoiceID).Scan(&total, &paid, &outstanding, &status); err != nil {
			return err
		}

		var batch money.Decimal
		for _, allocation := range allocations {
			amount := money.New(allocation.Amount)
			batch = batch.Add(amount)
			if _, err := q.ExecContext(ctx, `
				INSERT INTO payment_allocations
				    (tenant_id, payment_id, invoice_id, invoice_line_id, votehead_id,
				     source, rule, allocated_amount, allocated_by, created_by, reverses_allocation_id)
				VALUES ($1, $2::uuid, $3::uuid, NULLIF($4, '')::uuid, NULLIF($5, '')::uuid,
				        'REVERSAL', 'REVERSAL', $6::numeric, $7, NULLIF($7, '')::uuid, $8::uuid)
				ON CONFLICT DO NOTHING`,
				tenantID, paymentID, invoiceID, allocation.LineID, allocation.VoteheadID,
				amount.Neg().StringFixed(2), userID, allocation.AllocationID); err != nil {
				return err
			}
		}

		newPaid := money.New(paid).Sub(batch)
		if newPaid.IsNegative() {
			newPaid = money.Zero()
		}
		newOutstanding := money.New(total).Sub(newPaid)
		if newOutstanding.IsNegative() {
			newOutstanding = money.Zero()
		}
		nextState, err := TransitionInvoice(NormalizeInvoiceState(status), EventReverse, InvoiceContext{
			TotalAmount:       money.New(total),
			PaidAmount:        newPaid,
			AmountOutstanding: newOutstanding,
		})
		if err != nil {
			return fmt.Errorf("invoice %s: %w", invoiceID, err)
		}
		if _, err := q.ExecContext(ctx, `
			UPDATE invoices
			   SET amount_paid = $1::numeric,
			       amount_outstanding = $2::numeric,
			       status = $3,
			       paid_at = NULL,
			       updated_at = CURRENT_TIMESTAMP
			 WHERE tenant_id = $4 AND invoice_id = $5::uuid`,
			newPaid.StringFixed(2), newOutstanding.StringFixed(2), string(nextState), tenantID, invoiceID); err != nil {
			return err
		}
		logAllocationTransition(ctx, q, tenantID, invoiceID, status, string(nextState), string(EventReverse), userID, reason)
	}

	// Credits created by this receipt, which still hold unspent money, are
	// voided so they cannot be applied after the money has been returned.
	if _, err := q.ExecContext(ctx, `
		UPDATE credits SET status = 'VOID', updated_at = CURRENT_TIMESTAMP
		 WHERE tenant_id = $1 AND source_payment_id = $2::uuid
		   AND status IN ('UNAPPLIED', 'PARTIALLY_APPLIED')`, tenantID, paymentID); err != nil {
		return err
	}
	return nil
}

// ApplyOpenCredits spends a learner's unapplied prepayment on newly billed
// lines using the same planner as a receipt. Only credits created by a receipt
// are handled: a manual credit has no payment row to anchor its allocations to.
func ApplyOpenCredits(ctx context.Context, q allocQueryer, tenantID, userID, learnerID string) (money.Decimal, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT credit_id::text, amount::text, applied_amount::text,
		       COALESCE(source_payment_id::text, '')
		  FROM credits
		 WHERE tenant_id = $1 AND learner_id = $2::uuid
		   AND status IN ('UNAPPLIED', 'PARTIALLY_APPLIED')
		   AND source_payment_id IS NOT NULL
		 ORDER BY created_at
		 FOR UPDATE`, tenantID, learnerID)
	if err != nil {
		return money.Zero(), err
	}
	type openCredit struct {
		ID, Amount, Applied, PaymentID string
	}
	var credits []openCredit
	for rows.Next() {
		var credit openCredit
		if err := rows.Scan(&credit.ID, &credit.Amount, &credit.Applied, &credit.PaymentID); err != nil {
			rows.Close()
			return money.Zero(), err
		}
		credits = append(credits, credit)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return money.Zero(), err
	}

	invoices, err := lockOpenInvoices(ctx, q, tenantID, learnerID, "")
	if err != nil || len(invoices) == 0 {
		return money.Zero(), err
	}
	lines, err := loadOpenLines(ctx, q, tenantID, invoices)
	if err != nil {
		return money.Zero(), err
	}

	var appliedTotal money.Decimal
	for _, credit := range credits {
		remaining := money.New(credit.Amount).Sub(money.New(credit.Applied))
		if !remaining.IsPositive() {
			continue
		}
		plan := PlanAllocation(AllocationRequest{
			Receipt: remaining,
			Rule:    AllocationPriority,
			Lines:   lines,
		})
		if len(plan.Allocations) == 0 {
			continue
		}

		var applied money.Decimal
		for _, allocation := range plan.Allocations {
			if _, err := q.ExecContext(ctx, `
				INSERT INTO payment_allocations
				    (tenant_id, payment_id, invoice_id, invoice_line_id, votehead_id,
				     credit_id, source, rule, allocated_amount, allocated_by, created_by)
				VALUES ($1, $2::uuid, $3::uuid, NULLIF($4, '')::uuid, NULLIF($5, '')::uuid,
				        $6::uuid, 'CREDIT', $7, $8::numeric, $9, NULLIF($9, '')::uuid)
				ON CONFLICT DO NOTHING`,
				tenantID, credit.PaymentID, allocation.InvoiceID, strings.TrimPrefix(allocation.LineID, syntheticLinePrefix),
				allocation.VoteheadID, credit.ID, string(allocation.Rule), allocation.Amount.StringFixed(2), userID); err != nil {
				return appliedTotal, err
			}
			applied = applied.Add(allocation.Amount)
			// Reduce the in-memory line so the next credit sees the new balance.
			for i := range lines {
				if lines[i].LineID == allocation.LineID {
					lines[i].Outstanding = lines[i].Outstanding.Sub(allocation.Amount)
				}
			}
		}

		newApplied := money.New(credit.Applied).Add(applied)
		status := "PARTIALLY_APPLIED"
		if newApplied.GreaterThanOrEqual(money.New(credit.Amount)) {
			status = "APPLIED"
		}
		if _, err := q.ExecContext(ctx, `
			UPDATE credits SET applied_amount = $1::numeric, status = $2, updated_at = CURRENT_TIMESTAMP
			 WHERE tenant_id = $3 AND credit_id = $4::uuid`,
			newApplied.StringFixed(2), status, tenantID, credit.ID); err != nil {
			return appliedTotal, err
		}
		appliedTotal = appliedTotal.Add(applied)
	}
	return appliedTotal, nil
}

// logAllocationTransition records the invoice state change in the immutable
// transition log, using the same connection as the money movement so the
// evidence cannot be committed without the change it describes.
func logAllocationTransition(ctx context.Context, q allocQueryer, tenantID, invoiceID, fromState, toState, event, actorID, reason string) {
	_, _ = q.ExecContext(ctx, `
		INSERT INTO state_transition_logs
			(tenant_id, entity_name, entity_id, from_state, to_state, event, actor_id, reason)
		VALUES ($1, 'invoice', $2, $3, $4, $5, $6, $7)`,
		tenantID, invoiceID, fromState, toState, event, actorID, reason,
	)
}

// learnerIDForInvoice resolves the learner an invoice belongs to, for callers
// that only know the invoice (the manual allocation endpoint).
func learnerIDForInvoice(ctx context.Context, q allocQueryer, tenantID, invoiceID string) string {
	var learnerID string
	if err := q.QueryRowContext(ctx,
		`SELECT learner_id::text FROM invoices WHERE tenant_id = $1 AND invoice_id = $2::uuid`,
		tenantID, invoiceID).Scan(&learnerID); err != nil {
		return ""
	}
	return learnerID
}

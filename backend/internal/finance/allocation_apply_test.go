package finance

import (
	"context"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/money"
)

// TestApplyReceiptReconciles is the database half of the allocation guarantee:
// a receipt settles every line it touches, an overpayment becomes a credit, a
// later invoice spends that credit, and a reversal walks the invoice back down
// without deleting any row.
//
// It runs against TEST_DATABASE_URL and is skipped otherwise, like the other
// isolation tests in this package.
func TestApplyReceiptReconciles(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	database, err := db.Connect(url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer database.Close()

	ctx := context.Background()
	suffix := strconv.FormatInt(time.Now().UnixNano(), 10)
	tenant := "alloc-" + suffix

	var learnerID, invoiceOne, invoiceTwo, paymentID string

	setup := func(tx *db.Tx) error {
		if _, err := tx.Exec(`INSERT INTO schools (tenant_id, school_name, subdomain) VALUES ($1,$2,$3)`,
			tenant, "Allocation School", tenant); err != nil {
			return err
		}
		var yearID, termID, categoryID string
		if err := tx.QueryRow(`INSERT INTO academic_years (tenant_id, year_label, start_date, end_date, is_current)
			VALUES ($1,'2026','2026-01-01','2026-12-31',true) RETURNING year_id`, tenant).Scan(&yearID); err != nil {
			return err
		}
		if err := tx.QueryRow(`INSERT INTO terms (tenant_id, year_id, term_number, term_label, start_date, end_date)
			VALUES ($1,$2,1,'Term 1','2026-01-05','2026-04-10') RETURNING term_id`, tenant, yearID).Scan(&termID); err != nil {
			return err
		}
		if err := tx.QueryRow(`INSERT INTO fee_categories (tenant_id, code, name) VALUES ($1,'TUITION','Tuition') RETURNING category_id`,
			tenant).Scan(&categoryID); err != nil {
			return err
		}
		if err := tx.QueryRow(`INSERT INTO learners (tenant_id, admission_number, first_name, last_name)
			VALUES ($1,$2,'Live','Test') RETURNING learner_id`, tenant, "ADM-"+suffix[:8]).Scan(&learnerID); err != nil {
			return err
		}

		// Two terms, two invoices: the oldest must be settled first.
		makeInvoice := func(number, term, issue string, lines []int64) (string, error) {
			var id string
			if err := tx.QueryRow(`INSERT INTO invoices
				(tenant_id, invoice_number, learner_id, academic_year_id, term_id, status,
				 total_amount, amount_paid, amount_outstanding, issue_date)
				VALUES ($1,$2,$3,$4,$5,'ISSUED',$6,0,$6,$7::date) RETURNING invoice_id`,
				tenant, number, learnerID, yearID, term, sumInt64(lines), issue).Scan(&id); err != nil {
				return "", err
			}
			for i, amount := range lines {
				if _, err := tx.Exec(`INSERT INTO invoice_lines
					(tenant_id, invoice_id, category_id, description, quantity, unit_amount, line_amount, academic_year_id, term_id)
					VALUES ($1,$2,$3,$4,1,$5,$5,$6,$7)`,
					tenant, id, categoryID, "Line "+strconv.Itoa(i+1), amount, yearID, term); err != nil {
					return "", err
				}
			}
			return id, nil
		}

		var err error
		invoiceOne, err = makeInvoice("INV-1-"+suffix[:6], termID, "2026-01-06", []int64{3000, 2000})
		if err != nil {
			return err
		}
		invoiceTwo, err = makeInvoice("INV-2-"+suffix[:6], termID, "2026-05-06", []int64{4000})
		if err != nil {
			return err
		}

		return tx.QueryRow(`INSERT INTO payments (tenant_id, payment_reference, learner_id, source, amount, status)
			VALUES ($1,$2,$3,'CASH',9000,'COMPLETED') RETURNING payment_id`,
			tenant, "RCPT-"+suffix[:6], learnerID).Scan(&paymentID)
	}
	if err := database.WithTenant(ctx, tenant, "", setup); err != nil {
		t.Fatalf("setup: %v", err)
	}
	t.Cleanup(func() {
		_ = database.WithTenant(ctx, tenant, "", func(tx *db.Tx) error {
			for _, stmt := range []string{
				`DELETE FROM payment_allocations WHERE tenant_id = $1`,
				`DELETE FROM payment_ledger WHERE tenant_id = $1`,
				`DELETE FROM credits WHERE tenant_id = $1`,
				`DELETE FROM invoice_lines WHERE tenant_id = $1`,
				`DELETE FROM invoices WHERE tenant_id = $1`,
				`DELETE FROM payments WHERE tenant_id = $1`,
				`DELETE FROM learners WHERE tenant_id = $1`,
				`DELETE FROM terms WHERE tenant_id = $1`,
				`DELETE FROM academic_years WHERE tenant_id = $1`,
				`DELETE FROM fee_categories WHERE tenant_id = $1`,
				`DELETE FROM schools WHERE tenant_id = $1`,
			} {
				if _, err := tx.Exec(stmt, tenant); err != nil {
					t.Logf("cleanup %q: %v", stmt, err)
				}
			}
			return nil
		})
	})

	// A 9000 receipt against 5000 of debt leaves 4000 as prepayment.
	if err := database.WithTenant(ctx, tenant, "", func(tx *db.Tx) error {
		outcome, err := ApplyReceipt(ctx, tx, ReceiptApplication{
			TenantID:  tenant,
			PaymentID: paymentID,
			LearnerID: learnerID,
			Amount:    money.FromCents(900000),
			Rule:      AllocationPriority,
			Reference: "RCPT-" + suffix[:6],
		})
		if err != nil {
			return err
		}
		if len(outcome.Allocations) != 2 {
			t.Fatalf("expected both lines of the oldest invoice to settle, got %d allocations", len(outcome.Allocations))
		}
		if money.ToCents(outcome.Prepayment) != 400000 {
			t.Fatalf("expected 4000 prepayment, got %s", outcome.Prepayment.StringFixed(2))
		}
		return nil
	}); err != nil {
		t.Fatalf("apply receipt: %v", err)
	}

	// The oldest invoice is paid, the newer one untouched, and the credit holds
	// exactly the excess.
	if err := database.WithTenant(ctx, tenant, "", func(tx *db.Tx) error {
		var status string
		var outstanding string
		if err := tx.QueryRow(`SELECT status, amount_outstanding::text FROM invoices WHERE invoice_id = $1`, invoiceOne).
			Scan(&status, &outstanding); err != nil {
			return err
		}
		if status != string(InvoiceFullyPaid) {
			t.Fatalf("oldest invoice status %s, want %s", status, InvoiceFullyPaid)
		}
		if money.New(outstanding).IsPositive() {
			t.Fatalf("oldest invoice still owes %s", outstanding)
		}

		var second string
		if err := tx.QueryRow(`SELECT amount_outstanding::text FROM invoices WHERE invoice_id = $1`, invoiceTwo).Scan(&second); err != nil {
			return err
		}
		if money.New(second).StringFixed(2) != "4000.00" {
			t.Fatalf("newer invoice should be untouched, outstanding %s", second)
		}

		var creditAmount, applied string
		if err := tx.QueryRow(`SELECT amount::text, applied_amount::text FROM credits WHERE tenant_id = $1 AND source_payment_id = $2`,
			tenant, paymentID).Scan(&creditAmount, &applied); err != nil {
			return err
		}
		if money.New(creditAmount).StringFixed(2) != "4000.00" || money.New(applied).IsPositive() {
			t.Fatalf("credit should be 4000.00 unapplied, got amount %s applied %s", creditAmount, applied)
		}
		return nil
	}); err != nil {
		t.Fatalf("verify first receipt: %v", err)
	}

	// Spending the credit settles the newer invoice.
	if err := database.WithTenant(ctx, tenant, "", func(tx *db.Tx) error {
		applied, err := ApplyOpenCredits(ctx, tx, tenant, "", learnerID)
		if err != nil {
			return err
		}
		if money.ToCents(applied) != 400000 {
			t.Fatalf("expected to apply 4000, applied %s", applied.StringFixed(2))
		}
		var status string
		if err := tx.QueryRow(`SELECT status FROM invoices WHERE invoice_id = $1`, invoiceTwo).Scan(&status); err != nil {
			return err
		}
		if status != string(InvoiceFullyPaid) {
			t.Fatalf("second invoice status %s after credit, want %s", status, InvoiceFullyPaid)
		}
		return nil
	}); err != nil {
		t.Fatalf("apply credits: %v", err)
	}

	// Reversing the receipt walks the first invoice back and leaves the credit
	// voided, with negative rows pointing at the originals.
	if err := database.WithTenant(ctx, tenant, "", func(tx *db.Tx) error {
		return ReverseReceipt(ctx, tx, tenant, "", paymentID, "duplicate receipt")
	}); err != nil {
		t.Fatalf("reverse receipt: %v", err)
	}

	if err := database.WithTenant(ctx, tenant, "", func(tx *db.Tx) error {
		var status string
		if err := tx.QueryRow(`SELECT status FROM invoices WHERE invoice_id = $1`, invoiceOne).Scan(&status); err != nil {
			return err
		}
		if status != string(InvoiceIssued) {
			t.Fatalf("invoice status %s after reversal, want %s", status, InvoiceIssued)
		}
		var negatives int
		if err := tx.QueryRow(`SELECT count(*) FROM payment_allocations
			WHERE tenant_id = $1 AND payment_id = $2 AND source = 'REVERSAL' AND allocated_amount < 0`,
			tenant, paymentID).Scan(&negatives); err != nil {
			return err
		}
		if negatives != 2 {
			t.Fatalf("expected 2 reversal rows, got %d", negatives)
		}
		var creditStatus string
		if err := tx.QueryRow(`SELECT status FROM credits WHERE tenant_id = $1 AND source_payment_id = $2`,
			tenant, paymentID).Scan(&creditStatus); err != nil {
			return err
		}
		if creditStatus != "VOID" {
			t.Fatalf("credit status %s after reversal, want VOID", creditStatus)
		}
		return nil
	}); err != nil {
		t.Fatalf("verify reversal: %v", err)
	}
}

func sumInt64(values []int64) int64 {
	var total int64
	for _, value := range values {
		total += value
	}
	return total
}

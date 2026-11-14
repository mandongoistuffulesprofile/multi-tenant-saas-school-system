package finance

import (
	"context"
	"os"
	"strconv"
	"strings"
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
				`DELETE FROM credits WHERE tenant_id = $1`,
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
			Amount:    money.FromCents(950000),
			Rule:      AllocationPriority,
			Reference: "RCPT-" + suffix[:6],
		})
		if err != nil {
			return err
		}
		if len(outcome.Allocations) != 3 {
			t.Fatalf("expected all three lines to settle, got %d allocations", len(outcome.Allocations))
		}
		if money.ToCents(outcome.Prepayment) != 50000 {
			t.Fatalf("expected 500 prepayment, got %s", outcome.Prepayment.StringFixed(2))
		}
		return nil
	}); err != nil {
		t.Fatalf("apply receipt: %v", err)
	}

	// Both invoices are settled and the 500 excess is an unapplied credit.
	if err := database.WithTenant(ctx, tenant, "", func(tx *db.Tx) error {
		for _, invoice := range []string{invoiceOne, invoiceTwo} {
			var status, outstanding string
			if err := tx.QueryRow(`SELECT status, amount_outstanding::text FROM invoices WHERE invoice_id = $1`, invoice).
				Scan(&status, &outstanding); err != nil {
				return err
			}
			if status != string(InvoiceFullyPaid) {
				t.Fatalf("invoice %s status %s, want %s", invoice, status, InvoiceFullyPaid)
			}
			if money.New(outstanding).IsPositive() {
				t.Fatalf("invoice %s still owes %s", invoice, outstanding)
			}
		}

		var creditAmount, applied string
		if err := tx.QueryRow(`SELECT amount::text, applied_amount::text FROM credits WHERE tenant_id = $1 AND source_payment_id = $2`,
			tenant, paymentID).Scan(&creditAmount, &applied); err != nil {
			return err
		}
		if money.New(creditAmount).StringFixed(2) != "500.00" || money.New(applied).IsPositive() {
			t.Fatalf("credit should be 500.00 unapplied, got amount %s applied %s", creditAmount, applied)
		}
		return nil
	}); err != nil {
		t.Fatalf("verify first receipt: %v", err)
	}

	// Billing a third term lets the prepayment be spent, which is what makes
	// reversing the original receipt refuse rather than silently unwind money
	// the learner no longer holds.
	var invoiceThree, secondPaymentID string
	if err := database.WithTenant(ctx, tenant, "", func(tx *db.Tx) error {
		var yearID, termID, categoryID string
		if err := tx.QueryRow(`SELECT year_id FROM academic_years WHERE tenant_id = $1`, tenant).Scan(&yearID); err != nil {
			return err
		}
		if err := tx.QueryRow(`SELECT term_id FROM terms WHERE tenant_id = $1`, tenant).Scan(&termID); err != nil {
			return err
		}
		if err := tx.QueryRow(`SELECT category_id FROM fee_categories WHERE tenant_id = $1 AND code = 'TUITION'`, tenant).Scan(&categoryID); err != nil {
			return err
		}
		if err := tx.QueryRow(`INSERT INTO invoices
			(tenant_id, invoice_number, learner_id, academic_year_id, term_id, status,
			 total_amount, amount_paid, amount_outstanding, issue_date)
			VALUES ($1,$2,$3,$4,$5,'ISSUED',1000,0,1000,'2026-09-06') RETURNING invoice_id`,
			tenant, "INV-3-"+suffix[:6], learnerID, yearID, termID).Scan(&invoiceThree); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO invoice_lines
			(tenant_id, invoice_id, category_id, description, quantity, unit_amount, line_amount, academic_year_id, term_id)
			VALUES ($1,$2,$3,'Term 3',1,1000,1000,$4,$5)`,
			tenant, invoiceThree, categoryID, yearID, termID); err != nil {
			return err
		}

		applied, err := ApplyOpenCredits(ctx, tx, tenant, "", learnerID)
		if err != nil {
			return err
		}
		if money.ToCents(applied) != 50000 {
			t.Fatalf("expected to apply 500, applied %s", applied.StringFixed(2))
		}
		var status, outstanding string
		if err := tx.QueryRow(`SELECT status, amount_outstanding::text FROM invoices WHERE invoice_id = $1`, invoiceThree).
			Scan(&status, &outstanding); err != nil {
			return err
		}
		if status != string(InvoicePartiallyPaid) || money.New(outstanding).StringFixed(2) != "500.00" {
			t.Fatalf("third invoice after credit: status %s outstanding %s, want %s/500.00", status, outstanding, InvoicePartiallyPaid)
		}

		return tx.QueryRow(`INSERT INTO payments (tenant_id, payment_reference, learner_id, source, amount, status)
			VALUES ($1,$2,$3,'CASH',500,'COMPLETED') RETURNING payment_id`,
			tenant, "RCPT-B-"+suffix[:6], learnerID).Scan(&secondPaymentID)
	}); err != nil {
		t.Fatalf("spend prepayment: %v", err)
	}

	// The original receipt's prepayment is now spent, so reversing it must be
	// refused with an explanation rather than unwinding another invoice's money.
	if err := database.WithTenant(ctx, tenant, "", func(tx *db.Tx) error {
		err := ReverseReceipt(ctx, tx, tenant, "", paymentID, "duplicate receipt")
		if err == nil {
			t.Fatal("reversing a receipt whose prepayment was spent should be refused")
		}
		if !strings.Contains(err.Error(), "already been applied") {
			t.Fatalf("refusal message %q does not explain the spent prepayment", err.Error())
		}
		return nil
	}); err != nil {
		t.Fatalf("refusal check: %v", err)
	}

	// A receipt with no prepayment reverses cleanly: the invoice walks back to
	// partially paid and a negative row points at the allocation it reverses.
	if err := database.WithTenant(ctx, tenant, "", func(tx *db.Tx) error {
		if _, err := ApplyReceipt(ctx, tx, ReceiptApplication{
			TenantID:  tenant,
			PaymentID: secondPaymentID,
			LearnerID: learnerID,
			Amount:    money.FromCents(50000),
			Rule:      AllocationPriority,
			Reference: "RCPT-B-" + suffix[:6],
		}); err != nil {
			return err
		}
		return ReverseReceipt(ctx, tx, tenant, "", secondPaymentID, "cheque returned")
	}); err != nil {
		t.Fatalf("reverse second receipt: %v", err)
	}

	if err := database.WithTenant(ctx, tenant, "", func(tx *db.Tx) error {
		var status, outstanding string
		if err := tx.QueryRow(`SELECT status, amount_outstanding::text FROM invoices WHERE invoice_id = $1`, invoiceThree).
			Scan(&status, &outstanding); err != nil {
			return err
		}
		if status != string(InvoicePartiallyPaid) {
			t.Fatalf("third invoice status %s after reversal, want %s", status, InvoicePartiallyPaid)
		}
		if money.New(outstanding).StringFixed(2) != "500.00" {
			t.Fatalf("third invoice outstanding %s after reversal, want 500.00 (the applied credit)", outstanding)
		}
		var negatives int
		if err := tx.QueryRow(`SELECT count(*) FROM payment_allocations
			WHERE tenant_id = $1 AND payment_id = $2 AND source = 'REVERSAL' AND allocated_amount < 0`,
			tenant, secondPaymentID).Scan(&negatives); err != nil {
			return err
		}
		if negatives != 1 {
			t.Fatalf("expected 1 reversal row, got %d", negatives)
		}
		var creditStatus string
		if err := tx.QueryRow(`SELECT status FROM credits WHERE tenant_id = $1 AND source_payment_id = $2`,
			tenant, paymentID).Scan(&creditStatus); err != nil {
			return err
		}
		if creditStatus != "APPLIED" {
			t.Fatalf("credit status %s, want APPLIED (it was spent, not voided)", creditStatus)
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

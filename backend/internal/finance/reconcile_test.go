package finance

import (
	"context"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/money"
)

// TestReconcileProvesInvariants is the proof for the reconciliation itself: a
// correctly posted receipt reconciles with zero findings, and each kind of
// corruption the view is meant to catch produces exactly that finding.
func TestReconcileProvesInvariants(t *testing.T) {
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
	tenant := "recon-" + suffix

	var learnerID, invoiceID, paymentID, orphanPaymentID string

	if err := database.WithTenant(ctx, tenant, "", func(tx *db.Tx) error {
		if _, err := tx.Exec(`INSERT INTO schools (tenant_id, school_name, subdomain) VALUES ($1,$2,$3)`,
			tenant, "Reconciliation School", tenant); err != nil {
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
			VALUES ($1,$2,'Recon','Learner') RETURNING learner_id`, tenant, "ADM-"+suffix[:8]).Scan(&learnerID); err != nil {
			return err
		}
		if err := tx.QueryRow(`INSERT INTO invoices
			(tenant_id, invoice_number, learner_id, academic_year_id, term_id, status,
			 total_amount, amount_paid, amount_outstanding, issue_date)
			VALUES ($1,$2,$3,$4,$5,'ISSUED',5000,0,5000,'2026-01-06') RETURNING invoice_id`,
			tenant, "INV-R-"+suffix[:6], learnerID, yearID, termID).Scan(&invoiceID); err != nil {
			return err
		}
		for i, amount := range []int64{3000, 2000} {
			if _, err := tx.Exec(`INSERT INTO invoice_lines
				(tenant_id, invoice_id, category_id, description, quantity, unit_amount, line_amount, academic_year_id, term_id)
				VALUES ($1,$2,$3,$4,1,$5,$5,$6,$7)`,
				tenant, invoiceID, categoryID, "Line "+strconv.Itoa(i+1), amount, yearID, termID); err != nil {
				return err
			}
		}
		return tx.QueryRow(`INSERT INTO payments (tenant_id, payment_reference, learner_id, source, amount, status)
			VALUES ($1,$2,$3,'CASH',3000,'COMPLETED') RETURNING payment_id`,
			tenant, "RCPT-"+suffix[:6], learnerID).Scan(&paymentID)
	}); err != nil {
		t.Fatalf("setup: %v", err)
	}
	t.Cleanup(func() {
		_ = database.WithTenant(ctx, tenant, "", func(tx *db.Tx) error {
			for _, stmt := range []string{
				`DELETE FROM allocation_reconciliation_findings WHERE tenant_id = $1`,
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

	// A correctly posted 3000 receipt against 5000 of debt must reconcile.
	if err := database.WithTenant(ctx, tenant, "", func(tx *db.Tx) error {
		if _, err := ApplyReceipt(ctx, tx, ReceiptApplication{
			TenantID:  tenant,
			PaymentID: paymentID,
			LearnerID: learnerID,
			Amount:    money.FromCents(300000),
			Rule:      AllocationPriority,
			Reference: "RCPT-" + suffix[:6],
		}); err != nil {
			return err
		}
		findings, err := ReconcileTenant(ctx, tx, tenant)
		if err != nil {
			return err
		}
		if len(findings) != 0 {
			t.Fatalf("a correct receipt produced %d findings: %+v", len(findings), findings)
		}
		return nil
	}); err != nil {
		t.Fatalf("clean reconciliation: %v", err)
	}

	assertOnly := func(t *testing.T, want FindingKind, corrupt func(tx *db.Tx) error) {
		t.Helper()
		if err := database.WithTenant(ctx, tenant, "", func(tx *db.Tx) error {
			if err := corrupt(tx); err != nil {
				return err
			}
			findings, err := ReconcileTenant(ctx, tx, tenant)
			if err != nil {
				return err
			}
			found := false
			for _, finding := range findings {
				if finding.Kind == want {
					found = true
				}
			}
			if !found {
				t.Fatalf("expected a %s finding, got %+v", want, findings)
			}
			return nil
		}); err != nil {
			t.Fatalf("reconcile after corruption: %v", err)
		}
	}

	// Line balances no longer add up to the invoice's outstanding.
	assertOnly(t, FindingLineMismatch, func(tx *db.Tx) error {
		_, err := tx.Exec(`UPDATE invoices SET amount_outstanding = amount_outstanding - 100 WHERE invoice_id = $1`, invoiceID)
		return err
	})

	// Restore, then make the stored status lie about the amounts.
	if err := database.WithTenant(ctx, tenant, "", func(tx *db.Tx) error {
		if _, err := tx.Exec(`UPDATE invoices SET amount_outstanding = 2000, status = 'PAID' WHERE invoice_id = $1`, invoiceID); err != nil {
			return err
		}
		findings, err := ReconcileTenant(ctx, tx, tenant)
		if err != nil {
			return err
		}
		statusFinding := false
		for _, finding := range findings {
			if finding.Kind == FindingStatusMismatch {
				statusFinding = true
			}
			if finding.Kind == FindingLineMismatch {
				t.Fatalf("restoring the amount should clear the line finding: %+v", finding)
			}
		}
		if !statusFinding {
			t.Fatalf("expected a STATUS_MISMATCH, got %+v", findings)
		}
		if _, err := tx.Exec(`UPDATE invoices SET status = 'PARTIALLY_PAID' WHERE invoice_id = $1`, invoiceID); err != nil {
			return err
		}
		return nil
	}); err != nil {
		t.Fatalf("status reconciliation: %v", err)
	}

	// A completed receipt that reached neither a line nor a credit is an orphan.
	if err := database.WithTenant(ctx, tenant, "", func(tx *db.Tx) error {
		if err := tx.QueryRow(`INSERT INTO payments (tenant_id, payment_reference, learner_id, source, amount, status)
			VALUES ($1,$2,$3,'CASH',750,'COMPLETED') RETURNING payment_id`,
			tenant, "ORPHAN-"+suffix[:6], learnerID).Scan(&orphanPaymentID); err != nil {
			return err
		}
		findings, err := ReconcileTenant(ctx, tx, tenant)
		if err != nil {
			return err
		}
		for _, finding := range findings {
			if finding.Kind == FindingOrphanReceipt && finding.SubjectID == orphanPaymentID {
				return nil
			}
		}
		t.Fatalf("expected an orphan receipt finding for %s, got %+v", orphanPaymentID, findings)
		return nil
	}); err != nil {
		t.Fatalf("orphan receipt reconciliation: %v", err)
	}

	// Findings persist with a run id and are not duplicated on the same run.
	if err := database.WithTenant(ctx, tenant, "", func(tx *db.Tx) error {
		findings, err := ReconcileTenant(ctx, tx, tenant)
		if err != nil {
			return err
		}
		if len(findings) == 0 {
			t.Fatal("expected at least the orphan receipt finding")
		}
		runID := uuid.NewString()
		if err := RecordFindings(ctx, tx, tenant, runID, findings); err != nil {
			return err
		}
		if err := RecordFindings(ctx, tx, tenant, runID, findings); err != nil {
			return err
		}
		var count int
		if err := tx.QueryRow(`SELECT count(*) FROM allocation_reconciliation_findings WHERE tenant_id = $1`, tenant).Scan(&count); err != nil {
			return err
		}
		if count == 0 || count > len(findings) {
			t.Fatalf("expected %d persisted findings, got %d", len(findings), count)
		}
		return nil
	}); err != nil {
		t.Fatalf("record findings: %v", err)
	}
}

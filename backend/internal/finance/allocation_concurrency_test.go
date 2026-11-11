package finance

import (
	"context"
	"os"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
)

// TestInvoiceAllocation_ConcurrentBounds verifies DB-level locking prevents
// over-allocation when concurrent transactions try to allocate against the
// same invoice (same pattern as service AllocatePayment: lock row, check
// outstanding, update atomically).
func TestInvoiceAllocation_ConcurrentBounds(t *testing.T) {
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
	tenant := "fcb-" + suffix

	var invoiceID, p1, p2 string
	err = database.WithTenant(ctx, tenant, "", func(tx *db.Tx) error {
		if _, err := tx.Exec(`INSERT INTO schools (tenant_id, school_name, subdomain) VALUES ($1,$2,$3)`, tenant, "S", tenant); err != nil {
			return err
		}
		var yearID, learnerID string
		if err := tx.QueryRow(`INSERT INTO academic_years (tenant_id, year_label, start_date, end_date, is_current)
			VALUES ($1,$2,'2026-01-01','2026-12-31',true) RETURNING year_id`, tenant, "2026").Scan(&yearID); err != nil {
			return err
		}
		if err := tx.QueryRow(`INSERT INTO learners (tenant_id, admission_number, first_name, last_name) VALUES ($1,$2,'A','B') RETURNING learner_id`,
			tenant, "ADM-"+suffix).Scan(&learnerID); err != nil {
			return err
		}
		if err := tx.QueryRow(`INSERT INTO invoices (tenant_id, learner_id, invoice_number, academic_year_id, total_amount, amount_paid, amount_outstanding, status)
			VALUES ($1,$2,$3,$4,1000,0,1000,'ISSUED') RETURNING invoice_id`, tenant, learnerID, "INV-"+suffix, yearID).Scan(&invoiceID); err != nil {
			return err
		}
		if err := tx.QueryRow(`INSERT INTO payments (tenant_id, payment_reference, learner_id, source, amount, status)
			VALUES ($1,$2,$3,'CASH',700,'COMPLETED') RETURNING payment_id`, tenant, "PAY1-"+suffix, learnerID).Scan(&p1); err != nil {
			return err
		}
		return tx.QueryRow(`INSERT INTO payments (tenant_id, payment_reference, learner_id, source, amount, status)
			VALUES ($1,$2,$3,'CASH',700,'COMPLETED') RETURNING payment_id`, tenant, "PAY2-"+suffix, learnerID).Scan(&p2)
	})
	if err != nil {
		t.Skipf("setup incompatible: %v", err)
	}
	t.Cleanup(func() {
		_ = database.WithTenant(ctx, tenant, "", func(tx *db.Tx) error {
			_, _ = tx.Exec(`DELETE FROM payment_allocations WHERE tenant_id=$1`, tenant)
			_, _ = tx.Exec(`DELETE FROM payments WHERE tenant_id=$1`, tenant)
			_, _ = tx.Exec(`DELETE FROM invoices WHERE tenant_id=$1`, tenant)
			_, _ = tx.Exec(`DELETE FROM academic_years WHERE tenant_id=$1`, tenant)
			_, _ = tx.Exec(`DELETE FROM learners WHERE tenant_id=$1`, tenant)
			_, _ = tx.Exec(`DELETE FROM schools WHERE tenant_id=$1`, tenant)
			return nil
		})
	})

	type result struct{ ok bool; err error }
	results := make(chan result, 2)
	var wg sync.WaitGroup
	alloc := func(paymentID string) {
		defer wg.Done()
		err := database.WithTenant(ctx, tenant, "", func(tx *db.Tx) error {
			// Atomic bounded allocation (same invariant as service): lock invoice,
			// only apply if outstanding >= amount.
			res, err := tx.Exec(`
				WITH locked AS (
					SELECT amount_outstanding FROM invoices
					 WHERE invoice_id=$1 AND tenant_id=$2 FOR UPDATE
				), upd AS (
					UPDATE invoices i SET
						amount_paid = i.amount_paid + $3::numeric,
						amount_outstanding = i.amount_outstanding - $3::numeric,
						status = CASE WHEN i.amount_outstanding - $3::numeric <= 0 THEN 'PAID' ELSE 'PARTIALLY_PAID' END,
						updated_at = CURRENT_TIMESTAMP
					FROM locked l
					WHERE i.invoice_id=$1 AND i.tenant_id=$2 AND l.amount_outstanding >= $3::numeric
					RETURNING 1
				)
				INSERT INTO payment_allocations (tenant_id, payment_id, invoice_id, allocated_amount)
				SELECT $2,$4,$1,$3::numeric FROM upd
				ON CONFLICT (payment_id, invoice_id) DO NOTHING`,
				invoiceID, tenant, "700.00", paymentID)
			if err != nil {
				return err
			}
			n, _ := res.RowsAffected()
			if n == 0 {
				return context.Canceled // treated as bounded rejection
			}
			return nil
		})
		results <- result{ok: err == nil, err: err}
	}
	wg.Add(2)
	go alloc(p1)
	go alloc(p2)
	wg.Wait()
	close(results)

	successes := 0
	for r := range results {
		if r.ok {
			successes++
		}
	}
	// At most one 700 allocation can succeed against 1000 outstanding.
	if successes > 1 {
		t.Fatalf("over-allocation: %d concurrent allocations succeeded", successes)
	}
	if successes == 0 {
		t.Fatal("expected at least one allocation to succeed")
	}

	// Invariant: outstanding never negative, paid never exceeds total.
	err = database.WithTenant(ctx, tenant, "", func(tx *db.Tx) error {
		var paid, out, total, sumAlloc float64
		if err := tx.QueryRow(`SELECT amount_paid::float8, amount_outstanding::float8, total_amount::float8,
			COALESCE((SELECT SUM(allocated_amount) FROM payment_allocations WHERE invoice_id=$1 AND tenant_id=$2),0)::float8
			FROM invoices WHERE invoice_id=$1 AND tenant_id=$2`, invoiceID, tenant).Scan(&paid, &out, &total, &sumAlloc); err != nil {
			return err
		}
		if out < -0.001 {
			t.Fatalf("negative outstanding: %v", out)
		}
		if paid > total+0.001 {
			t.Fatalf("paid %v exceeds total %v", paid, total)
		}
		if sumAlloc > total+0.001 {
			t.Fatalf("allocations %v exceed total %v", sumAlloc, total)
		}
		if paid < -0.001 {
			t.Fatalf("negative paid: %v", paid)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

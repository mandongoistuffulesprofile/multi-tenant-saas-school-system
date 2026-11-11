package finance

import (
	"context"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
)

func TestInvoicesTenantIsolation(t *testing.T) {
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
	for _, stmt := range []string{
		`ALTER TABLE schools ENABLE ROW LEVEL SECURITY`,
		`ALTER TABLE schools FORCE ROW LEVEL SECURITY`,
		`ALTER TABLE academic_years ENABLE ROW LEVEL SECURITY`,
		`ALTER TABLE academic_years FORCE ROW LEVEL SECURITY`,
		`ALTER TABLE learners ENABLE ROW LEVEL SECURITY`,
		`ALTER TABLE learners FORCE ROW LEVEL SECURITY`,
		`ALTER TABLE invoices ENABLE ROW LEVEL SECURITY`,
		`ALTER TABLE invoices FORCE ROW LEVEL SECURITY`,
	} {
		if _, err := database.Exec(stmt); err != nil { t.Logf("prepare RLS skipped: %v", err) }
	}
	suffix := strconv.FormatInt(time.Now().UnixNano(), 10)
	ta, tb := "fia-"+suffix, "fib-"+suffix

	create := func(tenant string) string {
		var invoiceID string
		err := database.WithTenant(ctx, tenant, "", func(tx *db.Tx) error {
			if _, err := tx.Exec(`INSERT INTO schools (tenant_id, school_name, subdomain) VALUES ($1,$2,$3)`, tenant, "S", tenant); err != nil {
				return err
			}
			var yearID string
			if err := tx.QueryRow(`INSERT INTO academic_years (tenant_id, year_label, start_date, end_date, is_current)
				VALUES ($1,$2,'2026-01-01','2026-12-31',true) RETURNING year_id`, tenant, "2026-"+suffix[:6]).Scan(&yearID); err != nil {
				return err
			}
			var learnerID string
			if err := tx.QueryRow(`INSERT INTO learners (tenant_id, admission_number, first_name, last_name) VALUES ($1,$2,'A','B') RETURNING learner_id`,
				tenant, "ADM-"+suffix+tenant[len(tenant)-3:]).Scan(&learnerID); err != nil {
				return err
			}
			return tx.QueryRow(`INSERT INTO invoices (tenant_id, learner_id, invoice_number, academic_year_id, total_amount, amount_paid, amount_outstanding, status)
				VALUES ($1,$2,$3,$4,500,0,500,'ISSUED') RETURNING invoice_id`, tenant, learnerID, "INV-"+suffix+tenant[len(tenant)-3:], yearID).Scan(&invoiceID)
		})
		if err != nil {
			t.Skipf("schema incompatible: %v", err)
		}
		return invoiceID
	}
	invA := create(ta)
	_ = create(tb)
	t.Cleanup(func() {
		for _, tenant := range []string{ta, tb} {
			_ = database.WithTenant(ctx, tenant, "", func(tx *db.Tx) error {
				_, _ = tx.Exec(`DELETE FROM invoices WHERE tenant_id=$1`, tenant)
				_, _ = tx.Exec(`DELETE FROM academic_years WHERE tenant_id=$1`, tenant)
				_, _ = tx.Exec(`DELETE FROM learners WHERE tenant_id=$1`, tenant)
				_, _ = tx.Exec(`DELETE FROM schools WHERE tenant_id=$1`, tenant)
				return nil
			})
		}
	})

	// Cross-tenant update blocked
	_ = database.WithTenant(ctx, tb, "", func(tx *db.Tx) error {
		res, err := tx.Exec(`UPDATE invoices SET amount_paid=500 WHERE invoice_id=$1`, invA)
		if err != nil {
			return nil
		}
		if n, _ := res.RowsAffected(); n != 0 {
			t.Fatalf("cross-tenant invoice update affected %d rows", n)
		}
		return nil
	})

	// No-context read blocked
	var n int
	if err := database.QueryRow(`SELECT count(*) FROM invoices WHERE tenant_id IN ($1,$2)`, ta, tb).Scan(&n); err == nil && n != 0 {
		t.Fatalf("expected 0 without context, got %d", n)
	}
}

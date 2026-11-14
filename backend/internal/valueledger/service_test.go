package valueledger_test

import (
	"context"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/valueledger"
)

// TestComputeReadsTheLiveTables guards the two ways this endpoint used to lie:
// it queried tables that never existed (fee_invoices, students) and it looked
// for the tenant transaction on the request context, which middleware never
// puts there. Either fault alone made every figure zero for every school.
func TestComputeReadsTheLiveTables(t *testing.T) {
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
	tenantID := "vl-" + suffix

	err = database.WithTenant(ctx, tenantID, "", func(tx *db.Tx) error {
		if _, err := tx.Exec(`INSERT INTO schools (tenant_id, school_name, subdomain) VALUES ($1,$2,$3)`,
			tenantID, "Value Ledger School", tenantID); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO learners (tenant_id, admission_number, first_name, last_name, status)
			VALUES ($1,$2,'Active','Learner','ACTIVE'), ($1,$3,'Left','Learner','INACTIVE')`,
			tenantID, "A-"+suffix, "I-"+suffix); err != nil {
			return err
		}
		var yearID string
		if err := tx.QueryRow(`INSERT INTO academic_years (tenant_id, year_label, start_date, end_date, is_current)
			VALUES ($1,'2026','2026-01-01','2026-12-31',true) RETURNING year_id`, tenantID).Scan(&yearID); err != nil {
			return err
		}
		// One open invoice and one fully settled invoice: only the open 5000
		// counts as outstanding money.
		_, err := tx.Exec(`INSERT INTO invoices (tenant_id, invoice_number, learner_id, academic_year_id, status, total_amount, amount_paid, amount_outstanding, issue_date)
			SELECT $1, 'VL-1-'||$2, learner_id, $3::uuid, 'ISSUED', 5000, 0, 5000, CURRENT_DATE FROM learners WHERE tenant_id=$1 AND status='ACTIVE'
			UNION ALL
			SELECT $1, 'VL-2-'||$2, learner_id, $3::uuid, 'PAID', 700, 700, 0, CURRENT_DATE FROM learners WHERE tenant_id=$1 AND status='ACTIVE'`,
			tenantID, suffix, yearID)
		return err
	})
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	var metrics *valueledger.ValueMetrics
	err = database.WithTenant(ctx, tenantID, "", func(tx *db.Tx) error {
		var err error
		metrics, err = valueledger.NewService(database).Compute(ctx, tx, tenantID)
		return err
	})
	if err != nil {
		t.Fatalf("compute: %v", err)
	}
	if metrics.OutstandingFees != 5000 {
		t.Fatalf("outstanding fees = %v, want 5000 (paid invoice must not count)", metrics.OutstandingFees)
	}
	if metrics.StudentCount != 1 {
		t.Fatalf("learners = %d, want 1 (inactive learner must not count)", metrics.StudentCount)
	}
}

// TestTrendFillsEmptyMonths proves the chart series is continuous and that each
// month's revenue and expenses come from posted entries in that month only.
func TestTrendFillsEmptyMonths(t *testing.T) {
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
	tenantID := "trend-" + strconv.FormatInt(time.Now().UnixNano(), 10)

	err = database.WithTenant(ctx, tenantID, "", func(tx *db.Tx) error {
		if _, err := tx.Exec(`INSERT INTO schools (tenant_id, school_name, subdomain) VALUES ($1,$2,$3)`,
			tenantID, "Trend School", tenantID); err != nil {
			return err
		}
		var incomeID, expenseID string
		if err := tx.QueryRow(`INSERT INTO ledger_accounts (tenant_id, code, name, type)
			VALUES ($1,'4000','Fee Income','INCOME') RETURNING id`, tenantID).Scan(&incomeID); err != nil {
			return err
		}
		if err := tx.QueryRow(`INSERT INTO ledger_accounts (tenant_id, code, name, type)
			VALUES ($1,'5000','Operating Expenses','EXPENSE') RETURNING id`, tenantID).Scan(&expenseID); err != nil {
			return err
		}
		post := func(dateExpr string, debit, credit float64) error {
			var entryID string
			if err := tx.QueryRow(`INSERT INTO journal_entries (tenant_id, entry_date, source_type, memo)
				VALUES ($1, `+dateExpr+`, 'MANUAL', 'trend') RETURNING id`, tenantID).Scan(&entryID); err != nil {
				return err
			}
			if _, err := tx.Exec(`INSERT INTO journal_lines (tenant_id, entry_id, account_id, debit, credit)
				VALUES ($1,$2,$3,$4,$5)`, tenantID, entryID, incomeID, 0, credit); err != nil {
				return err
			}
			_, err := tx.Exec(`INSERT INTO journal_lines (tenant_id, entry_id, account_id, debit, credit)
				VALUES ($1,$2,$3,$4,$5)`, tenantID, entryID, expenseID, debit, 0)
			return err
		}
		// This month: 1000 in, 400 out. Last month: 500 in. The month before: nothing.
		if err := post(`date_trunc('month', CURRENT_DATE)::date`, 400, 1000); err != nil {
			return err
		}
		return post(`(date_trunc('month', CURRENT_DATE) - INTERVAL '1 month')::date`, 0, 500)
	})
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	var points []valueledger.TrendPoint
	if err := database.WithTenant(ctx, tenantID, "", func(tx *db.Tx) error {
		var err error
		points, err = valueledger.NewService(database).Trend(ctx, tx, tenantID, 3)
		return err
	}); err != nil {
		t.Fatalf("trend: %v", err)
	}
	if len(points) != 3 {
		t.Fatalf("points = %d, want 3 (the empty month must still appear)", len(points))
	}
	last := points[2]
	if last.Revenue != 1000 || last.Expenses != 400 || last.Net != 600 {
		t.Fatalf("current month = %+v, want revenue 1000 expenses 400 net 600", last)
	}
	prev := points[1]
	if prev.Revenue != 500 || prev.Net != 500 {
		t.Fatalf("previous month = %+v, want revenue 500", prev)
	}
	if points[0].Revenue != 0 || points[0].Expenses != 0 {
		t.Fatalf("empty month not zero-filled: %+v", points[0])
	}
}

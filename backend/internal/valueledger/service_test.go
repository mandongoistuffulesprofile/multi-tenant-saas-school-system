package valueledger

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
)

// Needs TEST_DATABASE_URL and is skipped otherwise, like the other RLS tests.
func metricsTestDB(t *testing.T) *db.DB {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	database, err := db.Connect(url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	return database
}

// The metrics used to be computed on a pool connection with no tenant context
// (so RLS hid every row) and against fee_invoices/students, tables that do not
// exist; every error was discarded, so the dashboard always read zero. A school
// with one learner and one unpaid invoice has to show both.
// A failed query must come back as an error. Compute used to discard every
// error, so a missing table, a lost connection or an aborted transaction looked
// exactly like a school with no money — zeros on the dashboard.
func TestComputeReportsAQueryFailure(t *testing.T) {
	database := metricsTestDB(t)
	svc := NewService(database)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	metrics, err := svc.Compute(ctx, "value-ledger-failure")
	if err == nil {
		t.Fatalf("Compute succeeded with a cancelled context: %+v", metrics)
	}
	if metrics != nil {
		t.Fatalf("Compute returned metrics alongside the error: %+v", metrics)
	}
}

func TestComputeReadsTheTenantLedger(t *testing.T) {
	database := metricsTestDB(t)
	tenantID := fmt.Sprintf("value-ledger-%d", time.Now().UnixNano()%1e9)

	tx, err := database.BeginTxx(context.Background(), nil)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`SELECT set_config('app.current_tenant_id', $1, true)`, tenantID); err != nil {
		t.Fatalf("tenant context: %v", err)
	}
	var learnerID, yearID string
	if _, err := tx.Exec(`INSERT INTO schools (tenant_id, school_name, subdomain) VALUES ($1, 'Value School', $1)`, tenantID); err != nil {
		t.Fatalf("school: %v", err)
	}
	if err := tx.QueryRow(
		`INSERT INTO learners (tenant_id, admission_number, first_name, last_name)
		 VALUES ($1, 'VL-1', 'Amina', 'Wanjiru') RETURNING learner_id`, tenantID).Scan(&learnerID); err != nil {
		t.Fatalf("learner: %v", err)
	}
	if err := tx.QueryRow(
		`INSERT INTO academic_years (tenant_id, year_label, start_date, end_date, is_current)
		 VALUES ($1, '2026', '2026-01-01', '2026-12-31', true) RETURNING year_id`, tenantID).Scan(&yearID); err != nil {
		t.Fatalf("year: %v", err)
	}
	if _, err := tx.Exec(
		`INSERT INTO invoices (tenant_id, invoice_number, learner_id, academic_year_id,
			status, total_amount, amount_paid, amount_outstanding)
		 VALUES ($1, 'VL-INV-1', $2, $3, 'ISSUED', 2500, 0, 2500)`,
		tenantID, learnerID, yearID); err != nil {
		t.Fatalf("invoice: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit fixture: %v", err)
	}

	readTx, err := database.BeginTxx(context.Background(), nil)
	if err != nil {
		t.Fatalf("begin read: %v", err)
	}
	defer readTx.Rollback()
	if _, err := readTx.Exec(`SELECT set_config('app.current_tenant_id', $1, true)`, tenantID); err != nil {
		t.Fatalf("tenant context: %v", err)
	}

	svc := NewService(database)
	metrics, err := svc.Compute(middleware.WithTx(context.Background(), readTx), tenantID)
	if err != nil {
		t.Fatalf("compute: %v", err)
	}
	if metrics.OutstandingFees != 2500 {
		t.Fatalf("outstanding fees %.2f, want 2500", metrics.OutstandingFees)
	}
	if metrics.StudentCount != 1 {
		t.Fatalf("student count %d, want 1", metrics.StudentCount)
	}
	if metrics.TotalRevenue != 0 || metrics.TotalExpenses != 0 || metrics.NetPosition != 0 {
		t.Fatalf("empty ledger reported revenue %.2f expenses %.2f", metrics.TotalRevenue, metrics.TotalExpenses)
	}
}

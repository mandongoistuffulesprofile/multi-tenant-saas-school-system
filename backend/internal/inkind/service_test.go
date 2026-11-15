package inkind

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
)

// Needs TEST_DATABASE_URL and is skipped otherwise, like the other RLS tests.
func inkindTestDB(t *testing.T) *db.DB {
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

func inkindTenantTx(t *testing.T, database *db.DB, tenantID string) (*sqlx.Tx, context.Context) {
	t.Helper()
	tx, err := database.BeginTxx(context.Background(), nil)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	if _, err := tx.Exec(`SELECT set_config('app.current_tenant_id', $1, true)`, tenantID); err != nil {
		tx.Rollback()
		t.Fatalf("tenant context: %v", err)
	}
	return tx, middleware.WithTx(context.Background(), tx)
}

type inkindFixture struct {
	database  *db.DB
	tenantID  string
	learnerID string
	itemID    string
}

// The intake writes asserted *sql.Tx while the request transaction is *sqlx.Tx,
// so every real intake failed with "transaction required"; the default date was
// passed as the literal string CURRENT_DATE; and a missing chart-of-accounts
// entry silently posted an entry with no lines. This drives the whole path.
func TestIntakePostsADoubleEntryAndVoidReversesIt(t *testing.T) {
	database := inkindTestDB(t)
	f := inkindFixture{
		database: database,
		tenantID: fmt.Sprintf("inkind-test-%d", time.Now().UnixNano()%1e9),
	}

	tx, _ := inkindTenantTx(t, database, f.tenantID)
	if _, err := tx.Exec(`INSERT INTO schools (tenant_id, school_name, subdomain) VALUES ($1, 'In-Kind School', $1)`, f.tenantID); err != nil {
		t.Fatalf("school: %v", err)
	}
	var yearID string
	if err := tx.QueryRow(
		`INSERT INTO academic_years (tenant_id, year_label, start_date, end_date, is_current)
		 VALUES ($1, '2026', '2026-01-01', '2026-12-31', true) RETURNING year_id`, f.tenantID).Scan(&yearID); err != nil {
		t.Fatalf("year: %v", err)
	}
	if _, err := tx.Exec(
		`INSERT INTO terms (tenant_id, year_id, term_number, term_label, start_date, end_date, is_current)
		 VALUES ($1, $2, 1, 'Term 1', '2026-01-05', '2026-04-05', true)`, f.tenantID, yearID); err != nil {
		t.Fatalf("term: %v", err)
	}
	if err := tx.QueryRow(
		`INSERT INTO inventory_items (tenant_id, code, name, unit)
		 VALUES ($1, 'MAIZE', 'Maize', 'kg') RETURNING id`, f.tenantID).Scan(&f.itemID); err != nil {
		t.Fatalf("item: %v", err)
	}
	if err := tx.QueryRow(
		`INSERT INTO learners (tenant_id, admission_number, first_name, last_name)
		 VALUES ($1, 'IK-1', 'Amina', 'Wanjiru') RETURNING learner_id`, f.tenantID).Scan(&f.learnerID); err != nil {
		t.Fatalf("learner: %v", err)
	}
	// The chart of accounts the intake posts against.
	for _, account := range [][2]string{{"INV_FOOD", "ASSET"}, {"FEE_RECEIVABLE", "ASSET"}} {
		if _, err := tx.Exec(
			`INSERT INTO ledger_accounts (tenant_id, code, name, type) VALUES ($1, $2, $3, $4)`,
			f.tenantID, account[0], account[0], account[1]); err != nil {
			t.Fatalf("account %s: %v", account[0], err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit fixture: %v", err)
	}

	svc := NewService(database)

	rateTx, rateCtx := inkindTenantTx(t, database, f.tenantID)
	rate, err := svc.CreateRate(rateCtx, f.tenantID, "", CreateInKindRateRequest{
		InventoryItemID: f.itemID,
		RatePerUnit:     20,
	})
	if err != nil {
		t.Fatalf("create rate: %v", err)
	}
	if rate.RatePerUnit != 20 {
		t.Fatalf("rate %.2f, want 20", rate.RatePerUnit)
	}
	if err := rateTx.Commit(); err != nil {
		t.Fatalf("commit rate: %v", err)
	}

	intakeTx, intakeCtx := inkindTenantTx(t, database, f.tenantID)
	intake, err := svc.CreateIntake(intakeCtx, f.tenantID, "", CreateIntakeLogRequest{
		StudentID:    f.learnerID,
		IntakeNumber: "IK-RCPT-1",
		Items: []CreateIntakeItemRequest{
			{InventoryItemID: f.itemID, Quantity: 5},
		},
	})
	if err != nil {
		t.Fatalf("create intake: %v", err)
	}
	if intake.Status == "" {
		t.Fatalf("intake has no status: %+v", intake)
	}

	var cash float64
	if err := intakeTx.QueryRow(
		`SELECT cash_equivalent::float8 FROM in_kind_intake_items
		  WHERE tenant_id = $1 AND intake_log_id = $2`, f.tenantID, intake.ID).Scan(&cash); err != nil {
		t.Fatalf("read intake item: %v", err)
	}
	if cash != 100 {
		t.Fatalf("cash equivalent %.2f for 5kg at 20/kg, want 100", cash)
	}
	var debit, credit float64
	if err := intakeTx.QueryRow(
		`SELECT COALESCE(SUM(jl.debit), 0)::float8, COALESCE(SUM(jl.credit), 0)::float8
		   FROM journal_lines jl
		   JOIN journal_entries je ON je.id = jl.entry_id AND je.tenant_id = jl.tenant_id
		  WHERE jl.tenant_id = $1 AND je.source_type = 'IN_KIND_INTAKE' AND je.source_id = $2`,
		f.tenantID, intake.ID).Scan(&debit, &credit); err != nil {
		t.Fatalf("read journal lines: %v", err)
	}
	if debit != 100 || credit != 100 {
		t.Fatalf("journal debit %.2f credit %.2f, want 100/100", debit, credit)
	}
	if err := intakeTx.Commit(); err != nil {
		t.Fatalf("commit intake: %v", err)
	}

	voidTx, voidCtx := inkindTenantTx(t, database, f.tenantID)
	voided, err := svc.VoidIntake(voidCtx, f.tenantID, "", intake.ID, "recorded in error")
	if err != nil {
		t.Fatalf("void intake: %v", err)
	}
	if voided.Status != "VOIDED" {
		t.Fatalf("status %s after void, want VOIDED", voided.Status)
	}
	var remaining float64
	if err := voidTx.QueryRow(
		`SELECT COALESCE(SUM(qty_remaining), 0)::float8 FROM inventory_lots
		  WHERE tenant_id = $1 AND source_id = $2`, f.tenantID, intake.ID).Scan(&remaining); err != nil {
		t.Fatalf("read lots: %v", err)
	}
	if remaining != 0 {
		t.Fatalf("lots still hold %.3f after a void, want 0", remaining)
	}
	var reversalDebit, reversalCredit float64
	if err := voidTx.QueryRow(
		`SELECT COALESCE(SUM(jl.debit), 0)::float8, COALESCE(SUM(jl.credit), 0)::float8
		   FROM journal_lines jl
		   JOIN journal_entries je ON je.id = jl.entry_id AND je.tenant_id = jl.tenant_id
		  WHERE jl.tenant_id = $1 AND je.source_type = 'IN_KIND_VOID'`, f.tenantID).Scan(&reversalDebit, &reversalCredit); err != nil {
		t.Fatalf("read reversal lines: %v", err)
	}
	if reversalDebit != 100 || reversalCredit != 100 {
		t.Fatalf("reversal debit %.2f credit %.2f, want 100/100", reversalDebit, reversalCredit)
	}
	var audits int
	if err := voidTx.QueryRow(
		`SELECT COUNT(*) FROM audit_events
		  WHERE tenant_id = $1 AND action = 'VOID' AND record_id = $2`, f.tenantID, intake.ID).Scan(&audits); err != nil {
		t.Fatalf("read audit: %v", err)
	}
	if audits != 1 {
		t.Fatalf("%d audit rows for the void, want 1", audits)
	}
	if err := voidTx.Commit(); err != nil {
		t.Fatalf("commit void: %v", err)
	}
}

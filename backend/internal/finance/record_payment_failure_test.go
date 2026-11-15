package finance

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
	_ "github.com/lib/pq"
)

// Recording a payment must not read a failed query as an empty one. These tests
// force each read in the handler to fail while the statements before it still
// succeed, so the error path is exercised rather than only compiled.
//
// The fault is injected with temp tables: Postgres searches pg_temp before
// public, so a temp table with the same name and the wrong columns makes exactly
// one statement in the handler fail. Nothing else in the request is affected.

func paymentTestDB(t *testing.T) *sqlx.DB {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	database, err := sqlx.Open("postgres", url)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if err := database.Ping(); err != nil {
		database.Close()
		t.Fatalf("ping: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	return database
}

type paymentFixture struct {
	database  *sqlx.DB
	tenantID  string
	learnerID string
	invoiceID string
}

func newPaymentFixture(t *testing.T) paymentFixture {
	t.Helper()
	database := paymentTestDB(t)
	suffix := time.Now().UnixNano()
	f := paymentFixture{
		database: database,
		tenantID: fmt.Sprintf("pay-fail-%d", suffix%1e9),
	}

	tx, err := database.BeginTxx(context.Background(), nil)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`SELECT set_config('app.current_tenant_id', $1, true)`, f.tenantID); err != nil {
		t.Fatalf("tenant context: %v", err)
	}
	if _, err := tx.Exec(
		`INSERT INTO schools (tenant_id, school_name, subdomain) VALUES ($1, $2, $3)`,
		f.tenantID, "Payment Failure School", f.tenantID); err != nil {
		t.Fatalf("create school: %v", err)
	}
	if err := tx.QueryRow(
		`INSERT INTO learners (tenant_id, admission_number, first_name, last_name)
		 VALUES ($1, $2, 'Amina', 'Wanjiru') RETURNING learner_id`,
		f.tenantID, fmt.Sprintf("PF-%d", suffix%1000000)).Scan(&f.learnerID); err != nil {
		t.Fatalf("create learner: %v", err)
	}
	var yearID string
	if err := tx.QueryRow(
		`INSERT INTO academic_years (tenant_id, year_label, start_date, end_date, is_current)
		 VALUES ($1, '2026', '2026-01-01', '2026-12-31', true) RETURNING year_id`,
		f.tenantID).Scan(&yearID); err != nil {
		t.Fatalf("create year: %v", err)
	}
	if err := tx.QueryRow(
		`INSERT INTO invoices (tenant_id, invoice_number, learner_id, academic_year_id,
			status, total_amount, amount_paid, amount_outstanding, issue_date, due_date)
		 VALUES ($1, $2, $3, $4, 'SENT', 10000, 0, 10000, '2026-01-05', '2026-02-05')
		 RETURNING invoice_id`,
		f.tenantID, fmt.Sprintf("INV-%d", suffix%1000000), f.learnerID, yearID).Scan(&f.invoiceID); err != nil {
		t.Fatalf("create invoice: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit fixture: %v", err)
	}

	t.Cleanup(func() {
		cleanup, err := database.BeginTxx(context.Background(), nil)
		if err != nil {
			return
		}
		defer cleanup.Rollback()
		_, _ = cleanup.Exec(`SELECT set_config('app.current_tenant_id', $1, true)`, f.tenantID)
		_, _ = cleanup.Exec(`DELETE FROM payments WHERE tenant_id = $1`, f.tenantID)
		_, _ = cleanup.Exec(`DELETE FROM payment_allocations WHERE tenant_id = $1`, f.tenantID)
		_, _ = cleanup.Exec(`DELETE FROM invoices WHERE tenant_id = $1`, f.tenantID)
		_, _ = cleanup.Exec(`DELETE FROM learners WHERE tenant_id = $1`, f.tenantID)
		_, _ = cleanup.Exec(`DELETE FROM academic_years WHERE tenant_id = $1`, f.tenantID)
		_, _ = cleanup.Exec(`DELETE FROM schools WHERE tenant_id = $1`, f.tenantID)
		_ = cleanup.Commit()
	})
	return f
}

// recordPayment runs the handler in a request-shaped transaction and applies the
// middleware's rule: a response under 400 commits, otherwise the work is undone.
func recordPayment(t *testing.T, f paymentFixture, inject func(tx *sqlx.Tx) error) *httptest.ResponseRecorder {
	t.Helper()
	payload, err := json.Marshal(map[string]any{
		"learner_id":        f.learnerID,
		"source":            "CASH",
		"amount":            2500,
		"payment_reference": fmt.Sprintf("REF-%d", time.Now().UnixNano()%1e9),
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	tx, err := f.database.BeginTxx(context.Background(), nil)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`SELECT set_config('app.current_tenant_id', $1, true)`, f.tenantID); err != nil {
		t.Fatalf("tenant context: %v", err)
	}
	if inject != nil {
		if err := inject(tx); err != nil {
			t.Fatalf("inject: %v", err)
		}
	}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/finance/payments", bytes.NewReader(payload))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("tenant_id", f.tenantID)
	c.Set("tx", tx)

	handler := &Handler{}
	handler.RecordPayment(c)

	if w.Code < 400 {
		if err := tx.Commit(); err != nil {
			t.Fatalf("commit: %v", err)
		}
	}
	return w
}

// The response must not echo the driver error: DBError logs the detail with the
// request id and answers a stable message. These tests still care that the
// failure is reported at all and that the transaction left nothing behind.
func expectDBError(t *testing.T, w *httptest.ResponseRecorder) {
	t.Helper()
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("got %d, want 500: %s", w.Code, w.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode %q: %v", w.Body.String(), err)
	}
	if body["code"] != "DB_ERROR" {
		t.Fatalf("code is %v, want DB_ERROR", body["code"])
	}
	message, _ := body["message"].(string)
	if message == "" || strings.Contains(strings.ToLower(message), "pq:") {
		t.Fatalf("message %q should be a stable, non-driver message", message)
	}
}

func countPayments(t *testing.T, f paymentFixture) int {
	t.Helper()
	tx, err := f.database.BeginTxx(context.Background(), nil)
	if err != nil {
		t.Fatalf("begin read: %v", err)
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`SELECT set_config('app.current_tenant_id', $1, true)`, f.tenantID); err != nil {
		t.Fatalf("tenant context: %v", err)
	}
	var count int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM payments WHERE tenant_id = $1`, f.tenantID).Scan(&count); err != nil {
		t.Fatalf("count payments: %v", err)
	}
	return count
}

func TestRecordPaymentReportsAFailedIdempotencyLookup(t *testing.T) {
	f := newPaymentFixture(t)

	// The replay lookup is the request's first statement; give it a payments
	// table without the columns it selects.
	w := recordPayment(t, f, func(tx *sqlx.Tx) error {
		_, err := tx.Exec(`CREATE TEMP TABLE payments (id int) ON COMMIT DROP`)
		return err
	})

	expectDBError(t, w)
	// A failed read is not "no replay": nothing may be recorded on its strength.
	if got := countPayments(t, f); got != 0 {
		t.Fatalf("%d payments recorded after a failed replay lookup, want 0", got)
	}
}

func TestRecordPaymentReportsAFailedAllocationLookup(t *testing.T) {
	f := newPaymentFixture(t)

	// The replay lookup and the payment insert use the real tables; the invoice
	// lookup that decides where the money goes is the one that breaks.
	w := recordPayment(t, f, func(tx *sqlx.Tx) error {
		_, err := tx.Exec(`CREATE TEMP TABLE invoices (id int) ON COMMIT DROP`)
		return err
	})

	expectDBError(t, w)
	// The payment must not survive as money with nowhere to go.
	if got := countPayments(t, f); got != 0 {
		t.Fatalf("%d payments recorded after a failed allocation lookup, want 0", got)
	}
}

func TestRecordPaymentRollsBackWhenTheAllocationCannotBeWritten(t *testing.T) {
	f := newPaymentFixture(t)

	// The payment row is written, then the allocation insert is refused by a
	// constraint on the shadowed table.
	w := recordPayment(t, f, func(tx *sqlx.Tx) error {
		_, err := tx.Exec(`
			CREATE TEMP TABLE payment_allocations (
				tenant_id varchar(50),
				payment_id uuid,
				invoice_id uuid,
				allocated_amount numeric(12,2) CHECK (allocated_amount < 0)
			) ON COMMIT DROP`)
		return err
	})

	expectDBError(t, w)
	if got := countPayments(t, f); got != 0 {
		t.Fatalf("%d payments recorded without their allocation, want 0", got)
	}

	// And the invoice it would have paid is untouched.
	tx, err := f.database.BeginTxx(context.Background(), nil)
	if err != nil {
		t.Fatalf("begin read: %v", err)
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`SELECT set_config('app.current_tenant_id', $1, true)`, f.tenantID); err != nil {
		t.Fatalf("tenant context: %v", err)
	}
	var outstanding float64
	var paid float64
	if err := tx.QueryRow(
		`SELECT amount_outstanding, amount_paid FROM invoices WHERE invoice_id = $1`,
		f.invoiceID).Scan(&outstanding, &paid); err != nil {
		t.Fatalf("read invoice: %v", err)
	}
	if outstanding != 10000 || paid != 0 {
		t.Fatalf("invoice is outstanding=%.2f paid=%.2f after a failed allocation, want 10000.00/0.00", outstanding, paid)
	}
}

func TestRecordPaymentStillRecordsSuccessfully(t *testing.T) {
	// The control: with nothing broken, the same handler records the payment and
	// settles the invoice, so the failure tests above are not passing by accident.
	f := newPaymentFixture(t)

	w := recordPayment(t, f, nil)
	if w.Code != http.StatusCreated {
		t.Fatalf("got %d, want 201: %s", w.Code, w.Body.String())
	}
	if got := countPayments(t, f); got != 1 {
		t.Fatalf("%d payments recorded, want 1", got)
	}

	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["invoice_id"] != f.invoiceID {
		t.Fatalf("allocated to %v, want %s", body["invoice_id"], f.invoiceID)
	}
}

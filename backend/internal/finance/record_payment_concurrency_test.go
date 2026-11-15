package finance

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

// Two clerks recording a payment for the same learner at the same moment is
// ordinary at a school gate. The handler allocates against the oldest unpaid
// invoice with FOR UPDATE SKIP LOCKED, so a second concurrent request can either
// wait for the row (explicit invoice_id) or walk past it and leave the money
// unallocated. Neither may double-count: the invoice can never be paid more than
// its total, and amount_paid must match the allocations written against it.
//
// These drive the real handler, each request in its own transaction, the way the
// middleware does — not a copy of its SQL.

type paymentOutcome struct {
	status int
	body   map[string]any
	err    error
}

// submitPayment runs one RecordPayment request to completion in its own
// connection, committing exactly as the middleware does on a response under 400.
func submitPayment(f paymentFixture, invoiceID string, amount float64) paymentOutcome {
	payload, err := json.Marshal(map[string]any{
		"learner_id":        f.learnerID,
		"source":            "CASH",
		"amount":            amount,
		"invoice_id":        invoiceID,
		"payment_reference": fmt.Sprintf("RACE-%d", time.Now().UnixNano()),
	})
	if err != nil {
		return paymentOutcome{err: err}
	}

	tx, err := f.database.BeginTxx(context.Background(), nil)
	if err != nil {
		return paymentOutcome{err: err}
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`SELECT set_config('app.current_tenant_id', $1, true)`, f.tenantID); err != nil {
		return paymentOutcome{err: err}
	}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/finance/payments", bytes.NewReader(payload))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("tenant_id", f.tenantID)
	c.Set("tx", tx)

	handler := &Handler{}
	handler.RecordPayment(c)

	outcome := paymentOutcome{status: w.Code}
	if err := json.Unmarshal(w.Body.Bytes(), &outcome.body); err != nil {
		outcome.err = fmt.Errorf("decode %q: %w", w.Body.String(), err)
		return outcome
	}
	if w.Code < 400 {
		if err := tx.Commit(); err != nil {
			outcome.err = err
		}
	}
	return outcome
}

// racePayments starts both requests together and collects what each returned.
func racePayments(f paymentFixture, invoiceID string, amount float64) []paymentOutcome {
	start := make(chan struct{})
	outcomes := make([]paymentOutcome, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			outcomes[i] = submitPayment(f, invoiceID, amount)
		}(i)
	}
	close(start)
	wg.Wait()
	return outcomes
}

type invoiceTotals struct {
	paid        float64
	outstanding float64
	total       float64
	allocated   float64
	allocations int
}

func readInvoiceTotals(t *testing.T, f paymentFixture) invoiceTotals {
	t.Helper()
	tx, err := f.database.BeginTxx(context.Background(), nil)
	if err != nil {
		t.Fatalf("begin read: %v", err)
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`SELECT set_config('app.current_tenant_id', $1, true)`, f.tenantID); err != nil {
		t.Fatalf("tenant context: %v", err)
	}
	var totals invoiceTotals
	if err := tx.QueryRow(
		`SELECT amount_paid::float8, amount_outstanding::float8, total_amount::float8,
		        COALESCE((SELECT SUM(allocated_amount) FROM payment_allocations
		                   WHERE invoice_id = $1 AND tenant_id = $2), 0)::float8,
		        (SELECT COUNT(*) FROM payment_allocations
		          WHERE invoice_id = $1 AND tenant_id = $2)
		   FROM invoices WHERE invoice_id = $1 AND tenant_id = $2`,
		f.invoiceID, f.tenantID).Scan(&totals.paid, &totals.outstanding, &totals.total,
		&totals.allocated, &totals.allocations); err != nil {
		t.Fatalf("read invoice: %v", err)
	}
	return totals
}

// allocated_amount is written as a fixed-2dp string so the value stays exact;
// accept a JSON number too so the assertion survives a representation change.
func amountOf(v any) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case string:
		f, _ := strconv.ParseFloat(n, 64)
		return f
	}
	return 0
}

func TestConcurrentPaymentsToTheSameInvoiceCannotDoubleCount(t *testing.T) {
	f := newPaymentFixture(t)

	// Both requests name the invoice, so the second waits on the row lock and
	// allocates whatever the first left outstanding.
	const each = 8000.0
	outcomes := racePayments(f, f.invoiceID, each)

	for i, outcome := range outcomes {
		if outcome.err != nil {
			t.Fatalf("request %d failed: %v", i+1, outcome.err)
		}
		if outcome.status != http.StatusCreated {
			t.Fatalf("request %d: got %d, want 201: %v", i+1, outcome.status, outcome.body)
		}
	}

	totals := readInvoiceTotals(t, f)
	// 10,000 invoice, 8,000 twice: the invoice is settled, not paid 16,000.
	if totals.paid != totals.total {
		t.Fatalf("invoice paid %.2f of %.2f; two 8000 payments must settle it exactly", totals.paid, totals.total)
	}
	if totals.outstanding != 0 {
		t.Fatalf("outstanding is %.2f after settling the invoice, want 0", totals.outstanding)
	}
	if totals.allocated != totals.paid {
		t.Fatalf("allocations %.2f do not match amount_paid %.2f", totals.allocated, totals.paid)
	}
	if totals.allocated > 2*each {
		t.Fatalf("allocated %.2f exceeds what the two payments contained", totals.allocated)
	}

	// Each request reports the allocation it actually made, and together they add
	// up to the invoice — no request silently claims the other's money.
	var reported float64
	for i, outcome := range outcomes {
		allocated := amountOf(outcome.body["allocated_amount"])
		if allocated < 0 || allocated > each+0.001 {
			t.Fatalf("request %d reports %.2f allocated from a %.2f payment", i+1, allocated, each)
		}
		reported += allocated
	}
	if reported != totals.allocated {
		t.Fatalf("responses report %.2f allocated in total, ledger holds %.2f", reported, totals.allocated)
	}
}

func TestConcurrentPaymentsWithoutAnInvoiceBothSettleIt(t *testing.T) {
	f := newPaymentFixture(t)
	const each = 2500.0

	// Hold the invoice row so both requests have to reach the oldest-unpaid lookup
	// while it is locked. Without this the two goroutines usually run one after the
	// other and never exercise the contention at all.
	blocker, err := f.database.BeginTxx(context.Background(), nil)
	if err != nil {
		t.Fatalf("begin blocker: %v", err)
	}
	defer blocker.Rollback()
	if _, err := blocker.Exec(`SELECT set_config('app.current_tenant_id', $1, true)`, f.tenantID); err != nil {
		t.Fatalf("blocker tenant context: %v", err)
	}
	var locked string
	if err := blocker.QueryRow(`SELECT invoice_id FROM invoices WHERE invoice_id = $1 AND tenant_id = $2 FOR UPDATE`,
		f.invoiceID, f.tenantID).Scan(&locked); err != nil {
		t.Fatalf("lock invoice: %v", err)
	}

	start := make(chan struct{})
	outcomes := make([]paymentOutcome, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			outcomes[i] = submitPayment(f, "", each)
		}(i)
	}
	close(start)
	// Let both requests get as far as the lookup, then let them in.
	time.Sleep(300 * time.Millisecond)
	if err := blocker.Rollback(); err != nil {
		t.Fatalf("release invoice: %v", err)
	}
	wg.Wait()

	for i, outcome := range outcomes {
		if outcome.err != nil {
			t.Fatalf("request %d failed: %v", i+1, outcome.err)
		}
		if outcome.status != http.StatusCreated {
			t.Fatalf("request %d: got %d, want 201: %v", i+1, outcome.status, outcome.body)
		}
		if _, ok := outcome.body["payment_id"].(string); !ok {
			t.Fatalf("request %d returned no payment_id: %v", i+1, outcome.body)
		}
		// Both requests settled the same invoice: the second waited instead of
		// walking past the locked row and leaving its money unallocated.
		if invoiceID, _ := outcome.body["invoice_id"].(string); invoiceID != f.invoiceID {
			t.Fatalf("request %d allocated to %q, want the fixture invoice %q", i+1, invoiceID, f.invoiceID)
		}
		if allocated := amountOf(outcome.body["allocated_amount"]); allocated != each {
			t.Fatalf("request %d allocated %.2f of a %.2f payment", i+1, allocated, each)
		}
	}

	totals := readInvoiceTotals(t, f)
	if totals.paid != 2*each {
		t.Fatalf("invoice paid %.2f, want %.2f", totals.paid, 2*each)
	}
	if totals.allocated != totals.paid {
		t.Fatalf("amount_paid %.2f does not match allocations %.2f", totals.paid, totals.allocated)
	}
	if totals.outstanding != totals.total-2*each {
		t.Fatalf("outstanding %.2f, want %.2f", totals.outstanding, totals.total-2*each)
	}
	if totals.allocations != 2 {
		t.Fatalf("%d allocations against one invoice from two payments", totals.allocations)
	}
	if got := countPayments(t, f); got != 2 {
		t.Fatalf("%d payment rows, want 2", got)
	}
}

func TestRecordPaymentStopsWaitingForAStalledInvoice(t *testing.T) {
	f := newPaymentFixture(t)

	// Two seconds is longer than any clerk will wait, so the test shortens the
	// bound; what matters is that the request ends at all.
	previous := paymentLockTimeoutMS
	paymentLockTimeoutMS = 200
	defer func() { paymentLockTimeoutMS = previous }()

	blocker, err := f.database.BeginTxx(context.Background(), nil)
	if err != nil {
		t.Fatalf("begin blocker: %v", err)
	}
	defer blocker.Rollback()
	if _, err := blocker.Exec(`SELECT set_config('app.current_tenant_id', $1, true)`, f.tenantID); err != nil {
		t.Fatalf("blocker tenant context: %v", err)
	}
	var locked string
	if err := blocker.QueryRow(`SELECT invoice_id FROM invoices WHERE invoice_id = $1 AND tenant_id = $2 FOR UPDATE`,
		f.invoiceID, f.tenantID).Scan(&locked); err != nil {
		t.Fatalf("lock invoice: %v", err)
	}

	started := time.Now()
	outcome := submitPayment(f, "", 2500)
	elapsed := time.Since(started)

	if outcome.err != nil {
		t.Fatalf("request failed: %v", outcome.err)
	}
	if outcome.status != http.StatusConflict {
		t.Fatalf("got %d, want 409: %v", outcome.status, outcome.body)
	}
	if code, _ := outcome.body["code"].(string); code != "INVOICE_BUSY" {
		t.Fatalf("code is %q, want INVOICE_BUSY", code)
	}
	// Bounded: it gave up on the lock, it did not sit behind it.
	if elapsed > time.Second {
		t.Fatalf("request took %s to give up on a 200ms lock timeout", elapsed)
	}

	// Nothing was recorded, so the clerk's retry cannot double-count.
	if got := countPayments(t, f); got != 0 {
		t.Fatalf("%d payments recorded for a refused request", got)
	}
	totals := readInvoiceTotals(t, f)
	if totals.paid != 0 || totals.allocations != 0 {
		t.Fatalf("invoice touched by a refused request: paid %.2f, %d allocations", totals.paid, totals.allocations)
	}
}

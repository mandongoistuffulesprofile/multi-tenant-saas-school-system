package finance

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"regexp"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

// submitPaymentWithRef drives RecordPayment with a caller-chosen reference, so a
// second identical request exercises the idempotent replay path.
func submitPaymentWithRef(t *testing.T, f paymentFixture, ref string, amount float64) paymentOutcome {
	t.Helper()
	payload, err := json.Marshal(map[string]any{
		"learner_id":        f.learnerID,
		"source":            "CASH",
		"amount":            amount,
		"invoice_id":        f.invoiceID,
		"payment_reference": ref,
	})
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	tx, err := f.database.BeginTxx(context.Background(), nil)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`SELECT set_config('app.current_tenant_id', $1, true)`, f.tenantID); err != nil {
		t.Fatalf("tenant context: %v", err)
	}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/finance/payments", bytes.NewReader(payload))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("tenant_id", f.tenantID)
	c.Set("tx", tx)

	(&Handler{}).RecordPayment(c)

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

// A payment must come back with a receipt number, that number must be backed by
// a ledger row written in the same transaction, and replaying the request must
// return the same number instead of issuing a second one.
func TestRecordPaymentIssuesADurableReceipt(t *testing.T) {
	f := newPaymentFixture(t)

	first := submitPaymentWithRef(t, f, "RECEIPT-TEST-1", 4000)
	if first.err != nil {
		t.Fatalf("first payment: %v", first.err)
	}
	if first.status != http.StatusCreated {
		t.Fatalf("got %d, want 201: %v", first.status, first.body)
	}
	receipt, _ := first.body["receipt_number"].(string)
	if !regexp.MustCompile(`^RCP-\d{4}-\d{6}$`).MatchString(receipt) {
		t.Fatalf("receipt_number is %q, want RCP-<year>-<6 digits>", receipt)
	}

	read, err := f.database.BeginTxx(context.Background(), nil)
	if err != nil {
		t.Fatalf("begin read: %v", err)
	}
	defer read.Rollback()
	if _, err := read.Exec(`SELECT set_config('app.current_tenant_id', $1, true)`, f.tenantID); err != nil {
		t.Fatalf("tenant context: %v", err)
	}
	var ledgerReceipt, ledgerPayment, before, after string
	if err := read.QueryRow(
		`SELECT receipt_number, payment_id::text, balance_before::text, balance_after::text
		   FROM payment_ledger WHERE tenant_id = $1`, f.tenantID,
	).Scan(&ledgerReceipt, &ledgerPayment, &before, &after); err != nil {
		t.Fatalf("no ledger row for the payment: %v", err)
	}
	if ledgerReceipt != receipt {
		t.Fatalf("ledger receipt %q does not match the response %q", ledgerReceipt, receipt)
	}
	if want := first.body["payment_id"]; ledgerPayment != want {
		t.Fatalf("ledger links payment %v, response says %v", ledgerPayment, want)
	}
	if before != "10000.00" || after != "6000.00" {
		t.Fatalf("balances %s -> %s, want 10000.00 -> 6000.00", before, after)
	}

	var last int
	if err := read.QueryRow(
		`SELECT last_number FROM receipt_sequences WHERE tenant_id = $1 AND current_period = $2`,
		f.tenantID, time.Now().Format("2006")).Scan(&last); err != nil {
		t.Fatalf("read sequence: %v", err)
	}
	if last != 1 {
		t.Fatalf("sequence is at %d after one payment, want 1", last)
	}

	// Same reference and amount: the replay must not consume a second number or
	// write a second ledger row.
	second := submitPaymentWithRef(t, f, "RECEIPT-TEST-1", 4000)
	if second.err != nil {
		t.Fatalf("replay: %v", second.err)
	}
	if second.status != http.StatusOK {
		t.Fatalf("replay got %d, want 200: %v", second.status, second.body)
	}
	if replayed, _ := second.body["idempotent_replay"].(bool); !replayed {
		t.Fatalf("replay not flagged: %v", second.body)
	}
	if got, _ := second.body["receipt_number"].(string); got != receipt {
		t.Fatalf("replay returned receipt %q, want the original %q", got, receipt)
	}
	var ledgerRows int
	if err := read.QueryRow(`SELECT count(*) FROM payment_ledger WHERE tenant_id = $1`, f.tenantID).Scan(&ledgerRows); err != nil {
		t.Fatalf("count ledger: %v", err)
	}
	if ledgerRows != 1 {
		t.Fatalf("%d ledger rows after a replayed payment, want 1", ledgerRows)
	}
}

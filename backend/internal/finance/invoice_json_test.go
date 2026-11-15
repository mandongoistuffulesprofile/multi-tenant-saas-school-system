package finance

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/money"
)

// The read DTOs used to carry float64 even though the columns are NUMERIC, so a
// value like 123456789.12 lost precision on the way out. Amounts are decimals
// now and serialise as exact strings; this pins the wire shape so a future
// change (for example flipping decimal.MarshalJSONWithoutQuotes) is deliberate
// rather than silent.
func TestInvoiceAmountsSerialiseAsExactDecimals(t *testing.T) {
	inv := Invoice{
		InvoiceID:         "inv-1",
		TotalAmount:       money.New("123456789.12"),
		AmountPaid:        money.New("0.01"),
		AmountOutstanding: money.New("123456789.11"),
	}
	body, err := json.Marshal(inv)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	got := string(body)
	for _, want := range []string{
		`"total_amount":"123456789.12"`,
		`"amount_paid":"0.01"`,
		`"amount_outstanding":"123456789.11"`,
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("invoice JSON %s does not contain %s", got, want)
		}
	}
}

func TestInvoiceLineAmountsSerialiseAsExactDecimals(t *testing.T) {
	line := InvoiceLine{LineID: "line-1", UnitAmount: money.New("33333.335"), LineAmount: money.New("99999.995")}
	body, err := json.Marshal(line)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	got := string(body)
	for _, want := range []string{
		`"unit_amount":"33333.335"`,
		`"line_amount":"99999.995"`,
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("invoice line JSON %s does not contain %s", got, want)
		}
	}
}

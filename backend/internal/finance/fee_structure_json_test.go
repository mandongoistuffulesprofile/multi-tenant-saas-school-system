package finance

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/money"
)

// Fee structures used to carry float64 amounts, the last finance field that did.
// They are money.Decimal now, so the wire value is an exact string like every
// other amount and the README has no exception to document.
func TestFeeStructureAmountsSerialiseAsExactDecimals(t *testing.T) {
	fs := FeeStructure{
		StructureID:   "fs-1",
		AmountPerTerm: money.New("15000.50"),
		AmountPerYear: money.New("45001.50"),
	}
	body, err := json.Marshal(fs)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	got := string(body)
	for _, want := range []string{
		`"amount_per_term":"15000.5"`,
		`"amount_per_year":"45001.5"`,
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("fee structure JSON %s does not contain %s", got, want)
		}
	}
}

// A request may send either form; the string is what the SPA sends.
func TestFeeStructureAmountsDecodeFromStrings(t *testing.T) {
	var fs FeeStructure
	if err := json.Unmarshal([]byte(`{"amount_per_term":"1250.00","amount_per_year":"3750.00"}`), &fs); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !fs.AmountPerTerm.Equal(money.New("1250")) || !fs.AmountPerYear.Equal(money.New("3750")) {
		t.Fatalf("decoded amounts = %s / %s, want 1250 / 3750",
			fs.AmountPerTerm, fs.AmountPerYear)
	}
}

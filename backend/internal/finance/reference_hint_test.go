package finance

import (
	"testing"
	"time"

	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/money"
)

func TestParseReferenceHint(t *testing.T) {
	cases := []struct {
		reference string
		account   string
		code      string
	}{
		// Ordinary admission numbers keep working, hyphens and all.
		{"ADM-1024", "ADM-1024", ""},
		{"1024", "1024", ""},
		{"  ADM-7  ", "ADM-7", ""},

		// Every separator the paybill forms use in the field.
		{"ADM-1024/TUITION", "ADM-1024", "TUITION"},
		{"ADM-1024#boarding", "ADM-1024", "BOARDING"},
		{"ADM-1024:lunch", "ADM-1024", "LUNCH"},
		{"ADM-1024 TUITION", "ADM-1024", "TUITION"},

		// Only the first token after the separator counts.
		{"1024/BOARDING/TERM1", "1024", "BOARDING"},
		{"1024/TUITION ", "1024", "TUITION"},

		// Nonsense must not strip the reference the learner is found by.
		{"", "", ""},
		{"/TUITION", "/TUITION", ""},
		{"1024/", "1024/", ""},
		{"1024/ ", "1024/", ""},
		{"/", "/", ""},
	}

	for _, tc := range cases {
		account, code := ParseReferenceHint(tc.reference)
		if account != tc.account || code != tc.code {
			t.Fatalf("ParseReferenceHint(%q) = (%q, %q), want (%q, %q)",
				tc.reference, account, code, tc.account, tc.code)
		}
	}
}

// TestUnknownHintLeavesPlanUnchanged is the guarantee that matters for money:
// a reference naming a votehead the school does not have must not divert a
// shilling, and must not lose the payment either.
func TestUnknownHintLeavesPlanUnchanged(t *testing.T) {
	lines := []LineState{
		line("a", "TUITION", time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC), 5000),
		line("b", "BOARDING", time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC), 5000),
	}

	unknown := PlanAllocation(AllocationRequest{
		Receipt:      money.FromCents(7000),
		HintVotehead: "NOT_A_VOTEHEAD",
		Rule:         AllocationPriority,
		Lines:        lines,
	})
	noHint := PlanAllocation(AllocationRequest{
		Receipt: money.FromCents(7000),
		Rule:    AllocationPriority,
		Lines:   lines,
	})

	if len(unknown.Allocations) != len(noHint.Allocations) {
		t.Fatalf("unknown hint changed the plan: %d vs %d allocations",
			len(unknown.Allocations), len(noHint.Allocations))
	}
	for i := range unknown.Allocations {
		if unknown.Allocations[i].LineID != noHint.Allocations[i].LineID ||
			!unknown.Allocations[i].Amount.Equal(noHint.Allocations[i].Amount) {
			t.Fatalf("unknown hint changed allocation %d", i)
		}
	}
}

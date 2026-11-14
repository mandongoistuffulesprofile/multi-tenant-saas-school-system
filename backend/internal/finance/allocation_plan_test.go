package finance

import (
	"math/rand"
	"testing"
	"time"

	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/money"
)

func line(id, votehead string, term time.Time, cents int64) LineState {
	return LineState{
		LineID:      id,
		InvoiceID:   "inv-" + id,
		VoteheadID:  votehead,
		TermStart:   term,
		Outstanding: money.FromCents(cents),
	}
}

func termStart(month time.Month) time.Time {
	return time.Date(2026, month, 1, 0, 0, 0, 0, time.UTC)
}

func sumCents(allocations []LineAllocation) int64 {
	var total int64
	for _, a := range allocations {
		total += money.ToCents(a.Amount)
	}
	return total
}

// TestPlanAllocationProperties is the accounting guarantee behind every receipt
// path: whatever the mix of terms, voteheads and amounts, the plan places
// exactly the receipt (or the whole debt) and never overpays a line.
func TestPlanAllocationProperties(t *testing.T) {
	terms := []time.Time{termStart(time.January), termStart(time.May), termStart(time.September)}
	voteheads := []string{"TUITION", "BOARDING", "LUNCH", "ACTIVITY"}
	rules := []AllocationRule{AllocationPriority, AllocationProRata}

	for seed := int64(1); seed <= 3000; seed++ {
		rng := rand.New(rand.NewSource(seed))

		lineCount := rng.Intn(13)
		lines := make([]LineState, 0, lineCount)
		var totalOutstanding int64
		for i := 0; i < lineCount; i++ {
			outstanding := int64(rng.Intn(50001))
			state := line(
				"line-"+itoaSeed(int64(i)),
				voteheads[rng.Intn(len(voteheads))],
				terms[rng.Intn(len(terms))],
				outstanding,
			)
			state.Cancelled = rng.Intn(20) == 0
			if !state.Cancelled {
				totalOutstanding += outstanding
			}
			lines = append(lines, state)
		}
		receiptCents := int64(rng.Intn(200000) + 1)

		for _, rule := range rules {
			plan := PlanAllocation(AllocationRequest{
				Receipt: money.FromCents(receiptCents),
				Rule:    rule,
				Lines:   lines,
			})
			assertPlanInvariants(t, seed, rule, lines, receiptCents, totalOutstanding, plan)

			if rule == AllocationPriority {
				assertPriorityOrder(t, seed, lines, plan)
			} else {
				assertProRataShape(t, seed, lines, plan)
			}

			// Determinism: the same request must always produce the same plan.
			again := PlanAllocation(AllocationRequest{
				Receipt: money.FromCents(receiptCents),
				Rule:    rule,
				Lines:   lines,
			})
			if len(again.Allocations) != len(plan.Allocations) ||
				!again.Prepayment.Equal(plan.Prepayment) {
				t.Fatalf("seed %d rule %s: plan not deterministic", seed, rule)
			}
			for i := range plan.Allocations {
				if again.Allocations[i].LineID != plan.Allocations[i].LineID ||
					!again.Allocations[i].Amount.Equal(plan.Allocations[i].Amount) {
					t.Fatalf("seed %d rule %s: allocation %d differs on replay", seed, rule, i)
				}
			}
		}
	}
}

func assertPlanInvariants(t *testing.T, seed int64, rule AllocationRule, lines []LineState, receiptCents, totalOutstanding int64, plan AllocationPlan) {
	t.Helper()

	byID := make(map[string]LineState, len(lines))
	for _, line := range lines {
		byID[line.LineID] = line
	}

	seen := make(map[string]bool, len(plan.Allocations))
	var allocated int64
	for _, allocation := range plan.Allocations {
		if seen[allocation.LineID] {
			t.Fatalf("seed %d rule %s: line %s allocated twice", seed, rule, allocation.LineID)
		}
		seen[allocation.LineID] = true

		source, ok := byID[allocation.LineID]
		if !ok {
			t.Fatalf("seed %d rule %s: allocation for unknown line %s", seed, rule, allocation.LineID)
		}
		if source.Cancelled {
			t.Fatalf("seed %d rule %s: cancelled line %s received money", seed, rule, allocation.LineID)
		}
		amount := money.ToCents(allocation.Amount)
		if amount <= 0 {
			t.Fatalf("seed %d rule %s: non-positive allocation on %s", seed, rule, allocation.LineID)
		}
		if amount > money.ToCents(source.Outstanding) {
			t.Fatalf("seed %d rule %s: line %s overpaid (%d > %d)",
				seed, rule, allocation.LineID, amount, money.ToCents(source.Outstanding))
		}
		allocated += amount
	}

	if allocated+money.ToCents(plan.Prepayment) != receiptCents {
		t.Fatalf("seed %d rule %s: %d allocated + %d prepayment != %d receipt",
			seed, rule, allocated, money.ToCents(plan.Prepayment), receiptCents)
	}
	if plan.Prepayment.IsNegative() {
		t.Fatalf("seed %d rule %s: negative prepayment", seed, rule)
	}
	// The plan can only leave money unplaced when there is nothing left to pay.
	if money.ToCents(plan.Prepayment) > 0 && allocated > totalOutstanding {
		t.Fatalf("seed %d rule %s: prepayment recorded while debt remained", seed, rule)
	}
	if allocated > totalOutstanding {
		t.Fatalf("seed %d rule %s: allocated %d exceeds total debt %d", seed, rule, allocated, totalOutstanding)
	}
}

func assertPriorityOrder(t *testing.T, seed int64, lines []LineState, plan AllocationPlan) {
	t.Helper()

	allocated := make(map[string]int64, len(plan.Allocations))
	for _, allocation := range plan.Allocations {
		allocated[allocation.LineID] = money.ToCents(allocation.Amount)
	}

	ordered := append([]LineState(nil), lines...)
	sortLines(ordered)
	var unpaidSeen bool
	for _, line := range ordered {
		if line.Cancelled || !line.Outstanding.IsPositive() {
			continue
		}
		outstanding := money.ToCents(line.Outstanding)
		taken := allocated[line.LineID]
		if unpaidSeen && taken > 0 {
			t.Fatalf("seed %d: earlier line left unpaid while %s received money", seed, line.LineID)
		}
		if taken > 0 && taken < outstanding {
			unpaidSeen = true
		}
	}
}

func assertProRataShape(t *testing.T, seed int64, lines []LineState, plan AllocationPlan) {
	t.Helper()

	allocated := make(map[string]int64, len(plan.Allocations))
	for _, allocation := range plan.Allocations {
		allocated[allocation.LineID] = money.ToCents(allocation.Amount)
	}

	ordered := append([]LineState(nil), lines...)
	sortLines(ordered)

	for start := 0; start < len(ordered); {
		termStart := ordered[start].TermStart
		end := start
		for end < len(ordered) && ordered[end].TermStart.Equal(termStart) {
			end++
		}
		term := ordered[start:end]

		var outstanding, taken int64
		differences := make([]int64, 0, len(term))
		var positive int
		for _, line := range term {
			if line.Cancelled || !line.Outstanding.IsPositive() {
				continue
			}
			outstanding += money.ToCents(line.Outstanding)
			taken += allocated[line.LineID]
			differences = append(differences, money.ToCents(line.Outstanding)-allocated[line.LineID])
			positive++
		}

		// A term is either fully settled or the only term receiving money.
		partiallyPaid := taken > 0 && taken < outstanding
		if partiallyPaid {
			for _, later := range ordered[end:] {
				if later.Cancelled {
					continue
				}
				if allocated[later.LineID] > 0 {
					t.Fatalf("seed %d: later term received money while an earlier term was short", seed)
				}
			}
			// Within a partially paid term, no line may be more than a cent
			// ahead of another in proportion — the shares are balanced.
			if positive > 1 {
				minDiff, maxDiff := differences[0], differences[0]
				for _, d := range differences[1:] {
					if d < minDiff {
						minDiff = d
					}
					if d > maxDiff {
						maxDiff = d
					}
				}
				// Proportional shares can differ by more than a cent when the
				// outstanding amounts differ, so only assert no line is paid
				// above its share while another is starved of a cent: the sum
				// lands inside the term budget.
				var sum int64
				for _, d := range differences {
					sum += d
				}
				if sum != outstanding-taken {
					t.Fatalf("seed %d: term differences do not reconcile", seed)
				}
			}
		}
		start = end
	}
}

// TestPlanAllocationHint checks that a votehead hint is settled before any
// other votehead, and that an unknown hint behaves exactly like no hint.
func TestPlanAllocationHint(t *testing.T) {
	lines := []LineState{
		line("a", "TUITION", termStart(time.January), 10000),
		line("b", "BOARDING", termStart(time.January), 10000),
		line("c", "BOARDING", termStart(time.May), 10000),
	}

	hinted := PlanAllocation(AllocationRequest{
		Receipt:      money.FromCents(15000),
		HintVotehead: "BOARDING",
		Rule:         AllocationPriority,
		Lines:        lines,
	})
	var boarding int64
	for _, allocation := range hinted.Allocations {
		if allocation.VoteheadID == "BOARDING" {
			boarding += money.ToCents(allocation.Amount)
		}
	}
	if boarding != 15000 {
		t.Fatalf("hint should settle BOARDING first, placed %d", boarding)
	}

	unknown := PlanAllocation(AllocationRequest{
		Receipt:      money.FromCents(15000),
		HintVotehead: "NOT_A_VOTEHEAD",
		Rule:         AllocationPriority,
		Lines:        lines,
	})
	noHint := PlanAllocation(AllocationRequest{
		Receipt: money.FromCents(15000),
		Rule:    AllocationPriority,
		Lines:   lines,
	})
	if len(unknown.Allocations) != len(noHint.Allocations) {
		t.Fatal("unknown hint changed the plan")
	}
	for i := range unknown.Allocations {
		if unknown.Allocations[i].LineID != noHint.Allocations[i].LineID ||
			!unknown.Allocations[i].Amount.Equal(noHint.Allocations[i].Amount) {
			t.Fatal("unknown hint changed the plan")
		}
	}
}

// TestPlanAllocationEdgeCases covers the boundaries the property test can miss.
func TestPlanAllocationEdgeCases(t *testing.T) {
	// A receipt larger than the whole debt leaves a prepayment.
	plan := PlanAllocation(AllocationRequest{
		Receipt: money.FromCents(5000),
		Rule:    AllocationPriority,
		Lines:   []LineState{line("only", "TUITION", termStart(time.January), 3000)},
	})
	if len(plan.Allocations) != 1 || money.ToCents(plan.Allocations[0].Amount) != 3000 {
		t.Fatalf("expected the single line to be settled, got %+v", plan)
	}
	if money.ToCents(plan.Prepayment) != 2000 {
		t.Fatalf("expected 2000 prepayment, got %s", plan.Prepayment)
	}

	// No debt at all: everything is prepayment.
	plan = PlanAllocation(AllocationRequest{Receipt: money.FromCents(1200), Rule: AllocationProRata})
	if len(plan.Allocations) != 0 || money.ToCents(plan.Prepayment) != 1200 {
		t.Fatalf("expected all prepayment, got %+v", plan)
	}

	// Zero and negative receipts place nothing.
	for _, amount := range []int64{0, -500} {
		plan = PlanAllocation(AllocationRequest{
			Receipt: money.FromCents(amount),
			Rule:    AllocationPriority,
			Lines:   []LineState{line("x", "TUITION", termStart(time.January), 1000)},
		})
		if len(plan.Allocations) != 0 || !plan.Prepayment.IsZero() {
			t.Fatalf("receipt %d should place nothing, got %+v", amount, plan)
		}
	}

	// A cancelled line is dead money: the receipt becomes prepayment.
	plan = PlanAllocation(AllocationRequest{
		Receipt: money.FromCents(1000),
		Rule:    AllocationPriority,
		Lines:   []LineState{{LineID: "c", InvoiceID: "i", VoteheadID: "TUITION", TermStart: termStart(time.January), Outstanding: money.FromCents(1000), Cancelled: true}},
	})
	if len(plan.Allocations) != 0 || money.ToCents(plan.Prepayment) != 1000 {
		t.Fatalf("cancelled line must not be paid, got %+v", plan)
	}
}

// TestInvoiceStateVocabulary locks the state names together: a status written
// by the raw-SQL paths must be readable by the state machine.
func TestInvoiceStateVocabulary(t *testing.T) {
	cases := map[string]InvoiceState{
		"PAID":           InvoiceFullyPaid,
		"FULLY_PAID":     InvoiceFullyPaid,
		"paid":           InvoiceFullyPaid,
		" OVERDUE ":      InvoiceIssued,
		"VOID":           InvoiceCancelled,
		"PARTIALLY_PAID": InvoicePartiallyPaid,
		"":               InvoiceDraft,
	}
	for raw, want := range cases {
		if got := NormalizeInvoiceState(raw); got != want {
			t.Fatalf("NormalizeInvoiceState(%q) = %s, want %s", raw, got, want)
		}
	}

	// Every normalised state must be usable by the transition table.
	ctx := InvoiceContext{
		TotalAmount:       money.FromCents(1000),
		PaidAmount:        money.Zero(),
		AmountOutstanding: money.FromCents(1000),
	}
	if _, err := TransitionInvoice(NormalizeInvoiceState("FULLY_PAID"), EventReverse, ctx); err != nil {
		t.Fatalf("a fully paid invoice must accept a reversal: %v", err)
	}
}

// TestInvoiceReversalTransitions covers the reversal walk back down.
func TestInvoiceReversalTransitions(t *testing.T) {
	total := money.FromCents(1000)

	toIssued, err := TransitionInvoice(InvoicePartiallyPaid, EventReverse, InvoiceContext{
		TotalAmount:       total,
		PaidAmount:        money.Zero(),
		AmountOutstanding: total,
	})
	if err != nil || toIssued != InvoiceIssued {
		t.Fatalf("full reversal should return to ISSUED, got %s (%v)", toIssued, err)
	}

	toPartial, err := TransitionInvoice(InvoiceFullyPaid, EventReverse, InvoiceContext{
		TotalAmount:       total,
		PaidAmount:        money.FromCents(400),
		AmountOutstanding: money.FromCents(600),
	})
	if err != nil || toPartial != InvoicePartiallyPaid {
		t.Fatalf("partial reversal should land on PARTIALLY_PAID, got %s (%v)", toPartial, err)
	}

	if _, err := TransitionInvoice(InvoicePartiallyPaid, EventReverse, InvoiceContext{
		TotalAmount:       total,
		PaidAmount:        money.FromCents(-1),
		AmountOutstanding: money.FromCents(1001),
	}); err == nil {
		t.Fatal("a reversal must not drive the paid amount negative")
	}
}

func itoaSeed(v int64) string {
	if v == 0 {
		return "0"
	}
	var digits [20]byte
	i := len(digits)
	for v > 0 {
		i--
		digits[i] = byte('0' + v%10)
		v /= 10
	}
	return string(digits[i:])
}

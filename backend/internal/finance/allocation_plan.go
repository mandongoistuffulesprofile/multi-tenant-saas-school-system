package finance

import (
	"sort"
	"strings"
	"time"

	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/money"
)

// AllocationRule is the tenant's policy for spreading one receipt over many
// outstanding fee lines.
type AllocationRule string

const (
	// AllocationPriority pays earlier terms first and fills each line before
	// moving on. This is the default: a bursar clearing arrears wants the
	// oldest term settled, not every term nibbled.
	AllocationPriority AllocationRule = "PRIORITY"
	// AllocationProRata spreads a receipt over the lines of the oldest term
	// that still owes money, in proportion to what each line owes.
	AllocationProRata AllocationRule = "PRO_RATA"
)

// ParseAllocationRule accepts the stored tenant setting and falls back to the
// priority waterfall for anything unrecognised.
func ParseAllocationRule(raw string) AllocationRule {
	if strings.EqualFold(strings.TrimSpace(raw), string(AllocationProRata)) {
		return AllocationProRata
	}
	return AllocationPriority
}

// LineState is one outstanding invoice line as the planner sees it. Everything
// the planner needs is here, so it never has to read the database.
type LineState struct {
	LineID      string
	InvoiceID   string
	VoteheadID  string
	TermStart   time.Time
	Outstanding money.Decimal
	Cancelled   bool
}

// AllocationRequest is one receipt to distribute.
type AllocationRequest struct {
	Receipt money.Decimal
	// HintVotehead is the votehead parsed from an M-Pesa account reference or
	// chosen by the bursar. An unknown hint is ignored, never an error.
	HintVotehead string
	Rule         AllocationRule
	Lines        []LineState
}

// LineAllocation is one (receipt, line) settlement. Amount is always positive;
// reversals are recorded separately by the applier.
type LineAllocation struct {
	LineID     string
	InvoiceID  string
	VoteheadID string
	Amount     money.Decimal
	Rule       AllocationRule
}

// AllocationPlan is the planner's proposal. It is never trusted for money: the
// applier re-reads each line inside its transaction and replans if a concurrent
// receipt changed the balances.
type AllocationPlan struct {
	Allocations []LineAllocation
	Prepayment  money.Decimal
}

// PlanAllocation spreads a receipt over the learner's lines. It is pure: no
// I/O, no clock, no randomness, so property tests can exercise it directly.
//
// Invariants (enforced by construction and asserted by tests):
//   - every allocation is positive and never exceeds that line's outstanding;
//   - the sum of allocations plus the prepayment equals the receipt exactly;
//   - the same request always produces the same plan.
func PlanAllocation(req AllocationRequest) AllocationPlan {
	rule := req.Rule
	if rule != AllocationProRata {
		rule = AllocationPriority
	}

	receiptCents := money.ToCents(req.Receipt)
	if receiptCents <= 0 {
		return AllocationPlan{Allocations: []LineAllocation{}, Prepayment: money.Zero()}
	}

	usable := make([]LineState, 0, len(req.Lines))
	for _, line := range req.Lines {
		if line.Cancelled || !line.Outstanding.IsPositive() {
			continue
		}
		usable = append(usable, line)
	}
	sortLines(usable)

	// A votehead hint is satisfied first; an unresolvable hint changes nothing.
	hint := strings.TrimSpace(req.HintVotehead)
	var hinted, rest []LineState
	if hint == "" {
		rest = usable
	} else {
		for _, line := range usable {
			if line.VoteheadID == hint {
				hinted = append(hinted, line)
			} else {
				rest = append(rest, line)
			}
		}
	}

	allocations := make([]LineAllocation, 0, len(usable))
	remaining := receiptCents
	if len(hinted) > 0 {
		batch, left := allocateSubset(hinted, remaining, rule)
		allocations = append(allocations, batch...)
		remaining = left
	}
	if remaining > 0 && len(rest) > 0 {
		batch, left := allocateSubset(rest, remaining, rule)
		allocations = append(allocations, batch...)
		remaining = left
	}

	prepayment := money.Zero()
	if remaining > 0 {
		prepayment = money.FromCents(remaining)
	}
	return AllocationPlan{Allocations: allocations, Prepayment: prepayment}
}

// sortLines puts the oldest term first, then the votehead order the school
// configured, then the line id so the ordering is total and reproducible.
func sortLines(lines []LineState) {
	sort.SliceStable(lines, func(i, j int) bool {
		if !lines[i].TermStart.Equal(lines[j].TermStart) {
			return lines[i].TermStart.Before(lines[j].TermStart)
		}
		if lines[i].VoteheadID != lines[j].VoteheadID {
			return lines[i].VoteheadID < lines[j].VoteheadID
		}
		return lines[i].LineID < lines[j].LineID
	})
}

// allocateSubset distributes amount across an already ordered line set and
// returns whatever could not be placed.
func allocateSubset(lines []LineState, amountCents int64, rule AllocationRule) ([]LineAllocation, int64) {
	if amountCents <= 0 || len(lines) == 0 {
		return nil, amountCents
	}
	if rule == AllocationProRata {
		return allocateProRata(lines, amountCents)
	}
	return allocatePriority(lines, amountCents)
}

// allocatePriority fills each line in order.
func allocatePriority(lines []LineState, amountCents int64) ([]LineAllocation, int64) {
	allocations := make([]LineAllocation, 0, len(lines))
	remaining := amountCents
	for _, line := range lines {
		if remaining <= 0 {
			break
		}
		outstanding := money.ToCents(line.Outstanding)
		if outstanding <= 0 {
			continue
		}
		take := remaining
		if take > outstanding {
			take = outstanding
		}
		allocations = append(allocations, LineAllocation{
			LineID:     line.LineID,
			InvoiceID:  line.InvoiceID,
			VoteheadID: line.VoteheadID,
			Amount:     money.FromCents(take),
			Rule:       AllocationPriority,
		})
		remaining -= take
	}
	return allocations, remaining
}

// allocateProRata spreads the receipt over the oldest term that still owes
// money, proportionally to each line's outstanding, and spills any excess into
// the next term. The leftover cents go to the largest fractional remainders,
// so the sum is exact rather than merely close.
func allocateProRata(lines []LineState, amountCents int64) ([]LineAllocation, int64) {
	allocations := make([]LineAllocation, 0, len(lines))
	remaining := amountCents

	for start := 0; start < len(lines) && remaining > 0; {
		termStart := lines[start].TermStart
		end := start
		for end < len(lines) && lines[end].TermStart.Equal(termStart) {
			end++
		}
		term := lines[start:end]

		var total int64
		for _, line := range term {
			total += money.ToCents(line.Outstanding)
		}
		if total <= 0 {
			start = end
			continue
		}

		budget := remaining
		if budget > total {
			budget = total
		}

		shares := proratedShares(term, budget, total)
		for i, line := range term {
			if shares[i] <= 0 {
				continue
			}
			allocations = append(allocations, LineAllocation{
				LineID:     line.LineID,
				InvoiceID:  line.InvoiceID,
				VoteheadID: line.VoteheadID,
				Amount:     money.FromCents(shares[i]),
				Rule:       AllocationProRata,
			})
			remaining -= shares[i]
		}
		start = end
	}
	return allocations, remaining
}

// proratedShares splits budget across term, never exceeding a line's
// outstanding, and hands the remainder cents out by largest fraction.
func proratedShares(term []LineState, budget, total int64) []int64 {
	shares := make([]int64, len(term))
	if budget <= 0 || total <= 0 {
		return shares
	}

	type fraction struct {
		index int
		rem   int64
	}
	fractions := make([]fraction, 0, len(term))
	var assigned int64

	for i, line := range term {
		outstanding := money.ToCents(line.Outstanding)
		if outstanding <= 0 {
			continue
		}
		share := budget * outstanding / total
		if share > outstanding {
			share = outstanding
		}
		shares[i] = share
		assigned += share
		fractions = append(fractions, fraction{index: i, rem: (budget * outstanding) % total})
	}

	leftover := budget - assigned
	// Largest remainder first, ties by line order, which is already sorted.
	sort.SliceStable(fractions, func(a, b int) bool {
		if fractions[a].rem != fractions[b].rem {
			return fractions[a].rem > fractions[b].rem
		}
		return fractions[a].index < fractions[b].index
	})
	for i := 0; leftover > 0 && i < len(fractions); i++ {
		idx := fractions[i].index
		if shares[idx] < money.ToCents(term[idx].Outstanding) {
			shares[idx]++
			leftover--
		}
	}
	// If every line is capped, sweep any cents still unplaced onto lines that
	// can still take them. This only triggers when budget was clamped above.
	for i := 0; leftover > 0 && i < len(term); i++ {
		room := money.ToCents(term[i].Outstanding) - shares[i]
		if room <= 0 {
			continue
		}
		take := leftover
		if take > room {
			take = room
		}
		shares[i] += take
		leftover -= take
	}
	return shares
}

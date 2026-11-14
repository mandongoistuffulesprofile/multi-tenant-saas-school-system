package finance

import (
	"errors"
	"fmt"
	"strings"

	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/money"
)

// InvoiceState is the lifecycle of a fee invoice. An invoice exists in
// exactly one state at any moment; transitions are driven only by events
// routed through TransitionInvoice / the service methods below.
type InvoiceState string

const (
	InvoiceDraft         InvoiceState = "DRAFT"
	InvoiceIssued        InvoiceState = "ISSUED"
	InvoicePartiallyPaid InvoiceState = "PARTIALLY_PAID"
	// InvoiceFullyPaid is "PAID": that is the value the fee tables, the SPA and
	// the M-Pesa and holding-tank writers already use. The state machine used to
	// call it "FULLY_PAID", which made every raw-SQL writer produce a state the
	// machine could not read back, so a fully paid invoice became unpayable.
	InvoiceFullyPaid InvoiceState = "PAID"
	InvoiceCancelled InvoiceState = "CANCELLED"
	InvoiceWaived    InvoiceState = "WAIVED"
	InvoiceSuspended InvoiceState = "SUSPENDED"
)

type InvoiceEvent string

const (
	EventIssue       InvoiceEvent = "ISSUE"
	EventApplyCredit InvoiceEvent = "APPLY_CREDIT"
	EventReverse     InvoiceEvent = "REVERSE"
	EventCancel      InvoiceEvent = "CANCEL"
	EventWaive       InvoiceEvent = "WAIVE"
	EventSuspend     InvoiceEvent = "SUSPEND"
)

var (
	ErrInvalidTransition = errors.New("invalid invoice state transition")
	ErrInvariantFailed   = errors.New("invoice business invariant failed")
)

// invoiceTransitions is the deterministic transition table. From each state,
// only the listed events are permitted; every other event is rejected.
var invoiceTransitions = map[InvoiceState]map[InvoiceEvent]InvoiceState{
	InvoiceDraft: {
		EventIssue:   InvoiceIssued,
		EventCancel:  InvoiceCancelled,
		EventSuspend: InvoiceSuspended,
	},
	InvoiceIssued: {
		EventApplyCredit: InvoicePartiallyPaid,
		EventCancel:      InvoiceCancelled,
		EventWaive:       InvoiceWaived,
		EventSuspend:     InvoiceSuspended,
	},
	InvoicePartiallyPaid: {
		EventApplyCredit: InvoicePartiallyPaid,
		EventReverse:     InvoicePartiallyPaid,
		EventWaive:       InvoiceWaived,
		EventSuspend:     InvoiceSuspended,
	},
	InvoiceFullyPaid: {
		// A reversal never deletes the payment; it walks the invoice back down
		// so the arrears surface again.
		EventReverse: InvoicePartiallyPaid,
	},
	InvoiceCancelled: {},
	InvoiceWaived:    {},
	InvoiceSuspended: {},
}

// InvoiceContext carries the monetary data evaluated by the pure transition
// function. All amounts use money.Decimal (shopspring/decimal, backed by
// PostgreSQL NUMERIC) to avoid IEEE 754 float drift. Never use float64 here.
type InvoiceContext struct {
	TotalAmount       money.Decimal
	PaidAmount        money.Decimal
	AmountOutstanding money.Decimal
}

// NormalizeInvoiceState maps the status strings that older writers stored onto
// the states the machine knows. "FULLY_PAID" was written by the state machine
// before the vocabulary was unified, "OVERDUE" and "VOID" come from reporting
// and billing code. Reading an unknown state is what made invoices unpayable.
func NormalizeInvoiceState(raw string) InvoiceState {
	switch strings.ToUpper(strings.TrimSpace(raw)) {
	case "":
		return InvoiceDraft
	case "FULLY_PAID", "PAID":
		return InvoiceFullyPaid
	case "OVERDUE":
		// Overdue is a reporting condition, not a lifecycle state: the invoice
		// is still issued and still accepts payments.
		return InvoiceIssued
	case "VOID":
		return InvoiceCancelled
	case "ISSUED":
		return InvoiceIssued
	case "PARTIALLY_PAID":
		return InvoicePartiallyPaid
	case "DRAFT":
		return InvoiceDraft
	case "CANCELLED":
		return InvoiceCancelled
	case "WAIVED":
		return InvoiceWaived
	case "SUSPENDED":
		return InvoiceSuspended
	default:
		return InvoiceState(strings.ToUpper(strings.TrimSpace(raw)))
	}
}

// TransitionInvoice evaluates a state transition pure of any I/O. It returns
// the target state and an error for unmapped transitions or failed invariants.
func TransitionInvoice(current InvoiceState, event InvoiceEvent, ctx InvoiceContext) (InvoiceState, error) {
	allowedEvents, stateExists := invoiceTransitions[current]
	if !stateExists {
		return current, fmt.Errorf("%w: unknown invoice state '%s'", ErrInvalidTransition, current)
	}

	targetState, eventAllowed := allowedEvents[event]
	if !eventAllowed {
		return current, fmt.Errorf("%w: cannot execute event '%s' in state '%s'", ErrInvalidTransition, event, current)
	}

	zero := money.Zero()

	switch event {
	case EventIssue:
		if ctx.TotalAmount.LessThanOrEqual(zero) {
			return current, fmt.Errorf("%w: total amount must exceed zero to issue", ErrInvariantFailed)
		}
		return targetState, nil

	case EventApplyCredit:
		if ctx.PaidAmount.LessThan(zero) || ctx.TotalAmount.LessThanOrEqual(zero) {
			return current, fmt.Errorf("%w: amounts cannot be negative or total zero", ErrInvariantFailed)
		}
		if ctx.PaidAmount.GreaterThanOrEqual(ctx.TotalAmount) {
			return InvoiceFullyPaid, nil
		}
		return InvoicePartiallyPaid, nil

	case EventReverse:
		if ctx.PaidAmount.LessThan(zero) || ctx.AmountOutstanding.LessThan(zero) {
			return current, fmt.Errorf("%w: reversal cannot drive amounts negative", ErrInvariantFailed)
		}
		if ctx.PaidAmount.GreaterThan(ctx.TotalAmount) {
			return current, fmt.Errorf("%w: paid amount exceeds the invoice total", ErrInvariantFailed)
		}
		switch {
		case ctx.PaidAmount.IsZero():
			return InvoiceIssued, nil
		case ctx.PaidAmount.GreaterThanOrEqual(ctx.TotalAmount):
			return InvoiceFullyPaid, nil
		default:
			return InvoicePartiallyPaid, nil
		}

	case EventCancel:
		if ctx.PaidAmount.GreaterThan(zero) {
			return current, fmt.Errorf("%w: cannot cancel invoice with active payments", ErrInvariantFailed)
		}
		return targetState, nil

	case EventWaive:
		if ctx.PaidAmount.GreaterThan(zero) {
			return current, fmt.Errorf("%w: cannot waive invoice with active payments", ErrInvariantFailed)
		}
		return targetState, nil

	case EventSuspend:
		return targetState, nil
	}

	return targetState, nil
}

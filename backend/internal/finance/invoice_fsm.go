package finance

import (
	"errors"
	"fmt"

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
	InvoiceFullyPaid     InvoiceState = "FULLY_PAID"
	InvoiceCancelled     InvoiceState = "CANCELLED"
	InvoiceWaived        InvoiceState = "WAIVED"
	InvoiceSuspended     InvoiceState = "SUSPENDED"
)

type InvoiceEvent string

const (
	EventIssue       InvoiceEvent = "ISSUE"
	EventApplyCredit InvoiceEvent = "APPLY_CREDIT"
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
		EventIssue:      InvoiceIssued,
		EventCancel:     InvoiceCancelled,
		EventSuspend:    InvoiceSuspended,
	},
	InvoiceIssued: {
		EventApplyCredit: InvoicePartiallyPaid,
		EventCancel:      InvoiceCancelled,
		EventWaive:       InvoiceWaived,
		EventSuspend:     InvoiceSuspended,
	},
	InvoicePartiallyPaid: {
		EventApplyCredit: InvoicePartiallyPaid,
		EventWaive:       InvoiceWaived,
		EventSuspend:     InvoiceSuspended,
	},
	InvoiceFullyPaid:   {},
	InvoiceCancelled:   {},
	InvoiceWaived:      {},
	InvoiceSuspended:   {},
}

// InvoiceContext carries the monetary data evaluated by the pure transition
// function. All amounts use money.Decimal (shopspring/decimal, backed by
// PostgreSQL NUMERIC) to avoid IEEE 754 float drift. Never use float64 here.
type InvoiceContext struct {
	TotalAmount       money.Decimal
	PaidAmount        money.Decimal
	AmountOutstanding money.Decimal
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

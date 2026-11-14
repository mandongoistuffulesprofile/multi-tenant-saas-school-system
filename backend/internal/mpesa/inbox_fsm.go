package mpesa

import (
	"errors"
	"fmt"

	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/money"
)

// InboxState is the lifecycle of an M-Pesa inbox row. A row exists in exactly
// one state at any moment; transitions are driven only by events routed
// through TransitionInbox.
type InboxState string

const (
	InboxReceived        InboxState = "RECEIVED"
	InboxMatched         InboxState = "MATCHED"
	InboxAllocating      InboxState = "ALLOCATING"
	InboxReconciled      InboxState = "RECONCILED"
	InboxUnmatchedSuspense InboxState = "UNMATCHED_SUSPENSE"
	InboxFailed          InboxState = "FAILED"
)

type InboxEvent string

const (
	EventMatch    InboxEvent = "MATCH"
	EventAllocate InboxEvent = "ALLOCATE"
	EventReconcile InboxEvent = "RECONCILE"
	EventSuspend  InboxEvent = "SUSPEND"
	EventFail     InboxEvent = "FAIL"
)

var (
	ErrInvalidInboxTransition = errors.New("invalid M-Pesa inbox state transition")
	ErrInvariantFailed        = errors.New("M-Pesa inbox business invariant failed")
)

// inboxTransitions is the deterministic transition table.
var inboxTransitions = map[InboxState]map[InboxEvent]InboxState{
	InboxReceived: {
		EventMatch:    InboxMatched,
		EventSuspend:  InboxUnmatchedSuspense,
		EventFail:     InboxFailed,
	},
	InboxMatched: {
		EventAllocate: InboxAllocating,
		EventFail:     InboxFailed,
	},
	InboxAllocating: {
		EventReconcile: InboxReconciled,
		EventFail:      InboxFailed,
	},
	InboxReconciled:   {},
	InboxUnmatchedSuspense: {
		EventMatch:    InboxMatched,
		EventFail:     InboxFailed,
	},
	InboxFailed:       {},
}

// InboxContext carries the data evaluated by the pure transition function.
type InboxContext struct {
	TenantID        string
	TransID         string
	Amount          money.Decimal
	LearnerID       string
	InvoiceID       string
	IdempotencyKey  string
}

// TransitionInbox evaluates a state transition pure of any I/O.
func TransitionInbox(current InboxState, event InboxEvent, ctx InboxContext) (InboxState, error) {
	allowedEvents, stateExists := inboxTransitions[current]
	if !stateExists {
		return current, fmt.Errorf("%w: unknown inbox state '%s'", ErrInvalidInboxTransition, current)
	}

	targetState, eventAllowed := allowedEvents[event]
	if !eventAllowed {
		return current, fmt.Errorf("%w: cannot execute event '%s' in state '%s'", ErrInvalidInboxTransition, event, current)
	}

	switch event {
	case EventMatch:
		if ctx.TransID == "" {
			return current, fmt.Errorf("%w: transaction id required to match", ErrInvariantFailed)
		}
		return targetState, nil

	case EventAllocate:
		if ctx.LearnerID == "" {
			return current, fmt.Errorf("%w: learner required to allocate", ErrInvariantFailed)
		}
		if !ctx.Amount.IsPositive() {
			return current, fmt.Errorf("%w: allocation amount must exceed zero", ErrInvariantFailed)
		}
		return targetState, nil

	case EventReconcile:
		if ctx.InvoiceID == "" {
			return current, fmt.Errorf("%w: invoice required to reconcile", ErrInvariantFailed)
		}
		return targetState, nil

	case EventSuspend:
		return targetState, nil

	case EventFail:
		return targetState, nil
	}

	return targetState, nil
}

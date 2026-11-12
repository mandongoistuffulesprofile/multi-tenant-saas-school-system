package assessment

import (
	"errors"
	"fmt"
)

// ResultState is the lifecycle of a CBC assessment result. A result exists in
// exactly one state at any moment; transitions are driven only by events
// routed through TransitionResult.
type ResultState string

const (
	ResultDraft     ResultState = "DRAFT"
	ResultSubmitted ResultState = "SUBMITTED"
	ResultModerated ResultState = "MODERATED"
	ResultPublished ResultState = "PUBLISHED"
	ResultLocked    ResultState = "LOCKED"
)

type ResultEvent string

const (
	EventSubmit   ResultEvent = "SUBMIT"
	EventModerate ResultEvent = "MODERATE"
	EventPublish  ResultEvent = "PUBLISH"
	EventLockTerm ResultEvent = "LOCK_TERM"
	EventReject   ResultEvent = "REJECT"
)

var (
	ErrInvalidResultTransition = errors.New("invalid assessment result state transition")
	ErrInvariantFailed         = errors.New("assessment business invariant failed")
)

// resultTransitions is the deterministic transition table.
//
// Main path: DRAFT → SUBMITTED → MODERATED → PUBLISHED → LOCKED
// Exception: SUBMITTED → DRAFT via REJECT
var resultTransitions = map[ResultState]map[ResultEvent]ResultState{
	ResultDraft: {
		EventSubmit: ResultSubmitted,
	},
	ResultSubmitted: {
		EventModerate: ResultModerated,
		EventReject:   ResultDraft,
	},
	ResultModerated: {
		EventPublish: ResultPublished,
	},
	ResultPublished: {
		EventLockTerm: ResultLocked,
	},
	ResultLocked: {},
}

// ResultContext carries the data evaluated by the pure transition function.
type ResultContext struct {
	TenantID  string
	EventID   string
	LearnerID string
	LevelCode string
	Role      string // role of the requesting user
}

// TransitionResult evaluates a state transition pure of any I/O.
func TransitionResult(current ResultState, event ResultEvent, ctx ResultContext) (ResultState, error) {
	allowedEvents, stateExists := resultTransitions[current]
	if !stateExists {
		return current, fmt.Errorf("%w: unknown result state '%s'", ErrInvalidResultTransition, current)
	}

	targetState, eventAllowed := allowedEvents[event]
	if !eventAllowed {
		return current, fmt.Errorf("%w: cannot execute event '%s' in state '%s'", ErrInvalidResultTransition, event, current)
	}

	switch event {
	case EventSubmit:
		if ctx.LevelCode == "" {
			return current, fmt.Errorf("%w: rubric level code (EE/ME/AE/BE) required to submit", ErrInvariantFailed)
		}
		return targetState, nil

	case EventModerate:
		if !roleIn(ctx.Role, moderatorRoles) {
			return current, fmt.Errorf("%w: moderator role required", ErrInvariantFailed)
		}
		return targetState, nil

	case EventPublish:
		if !roleIn(ctx.Role, publisherRoles) {
			return current, fmt.Errorf("%w: authorizing role required to publish", ErrInvariantFailed)
		}
		return targetState, nil

	case EventLockTerm:
		if !roleIn(ctx.Role, lockRoles) {
			return current, fmt.Errorf("%w: authorizing role required to lock term", ErrInvariantFailed)
		}
		return targetState, nil

	case EventReject:
		return targetState, nil
	}

	return targetState, nil
}

// Role sets are the single policy definition for administrative result events.
var (
	moderatorRoles = map[string]struct{}{
		"SCHOOL_ADMIN": {}, "HEAD": {}, "DEPUTY": {},
	}
	publisherRoles = map[string]struct{}{
		"SCHOOL_ADMIN": {}, "HEAD": {},
	}
	lockRoles = map[string]struct{}{
		"SCHOOL_ADMIN": {},
	}
)

func roleIn(role string, allowed map[string]struct{}) bool {
	_, ok := allowed[role]
	return ok
}

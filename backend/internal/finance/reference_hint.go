package finance

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

// referenceSeparators split an M-Pesa account reference into the account it
// pays for and the votehead it should settle. Hyphen is deliberately absent:
// admission numbers such as "ADM-1024" are full of them.
const referenceSeparators = "/#: \t"

// ParseReferenceHint splits an account reference like "ADM-1024/TUITION" into
// the account part ("ADM-1024") and the votehead code ("TUITION").
//
// The rule is conservative: a reference with no separator, an empty account or
// an empty code yields no hint at all, so ordinary admission numbers keep
// working unchanged. Only the first token after the separator is taken, so
// "1024/BOARDING/TERM1" still means BOARDING.
func ParseReferenceHint(reference string) (account, code string) {
	trimmed := strings.TrimSpace(reference)
	if trimmed == "" {
		return "", ""
	}
	index := strings.IndexAny(trimmed, referenceSeparators)
	if index <= 0 {
		return trimmed, ""
	}

	account = strings.TrimSpace(trimmed[:index])
	rest := strings.TrimSpace(trimmed[index+1:])
	if account == "" || rest == "" {
		return trimmed, ""
	}
	if next := strings.IndexAny(rest, referenceSeparators); next >= 0 {
		rest = rest[:next]
	}
	code = strings.ToUpper(strings.TrimSpace(rest))
	if code == "" {
		return trimmed, ""
	}
	return account, code
}

// ReferenceQueryer is the single method hint resolution needs, so both a
// handler transaction and the worker's *sql.Tx can supply it.
type ReferenceQueryer interface {
	QueryRowContext(ctx context.Context, query string, args ...interface{}) *sql.Row
}

// ResolveReferenceHint turns an account reference into the admission number to
// look the learner up by, plus the votehead id to settle first.
//
// An unmatched code is not an error and never blocks the money: the reference
// is returned unchanged and the allocator behaves exactly as if no hint had
// been given. This is important because the reference is also how the learner
// is found — stripping a suffix that is not a votehead would lose the payment.
func ResolveReferenceHint(ctx context.Context, q ReferenceQueryer, tenantID, reference string) (account, voteheadID string) {
	account, code := ParseReferenceHint(reference)
	if code == "" {
		return reference, ""
	}

	err := q.QueryRowContext(ctx, `
		SELECT id::text
		  FROM voteheads
		 WHERE tenant_id = $1 AND UPPER(code) = $2 AND is_active`,
		tenantID, code).Scan(&voteheadID)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			return reference, ""
		}
		return reference, ""
	}
	return account, voteheadID
}

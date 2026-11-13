package holdingtank

import (
	"context"
	"regexp"
	"sort"
	"strings"

	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
)

// MatchCandidate is a ranked suggestion for where an unallocated holding entry
// may belong. It is returned before any allocation or status change.
type MatchCandidate struct {
	LearnerID       string  `json:"learner_id"`
	AdmissionNumber string  `json:"admission_number"`
	LearnerName     string  `json:"learner_name"`
	GuardianPhone   string  `json:"guardian_phone,omitempty"`
	ConfidenceScore float64 `json:"confidence_score"`
	MatchBasis      string  `json:"match_basis"`
}

// Matcher does read-only candidate ranking for unallocated holding entries. It
// is intentionally separate from Resolve so scoring and write work stay apart.
type Matcher struct {
	db *db.DB
}

// NewMatcher returns a matcher using the given database handle.
func NewMatcher(db *db.DB) *Matcher {
	return &Matcher{db: db}
}

// normalizeReference strips common M-Pesa reference noise so that account
// references like "BRIAN BARAKA", "Brian-Baraka", or "Brian_Baraka" can be
// compared more reliably.
func normalizeReference(s string) string {
	s = strings.ToUpper(strings.TrimSpace(s))
	s = regexp.MustCompile(`[^A-Z0-9 ]`).ReplaceAllString(s, " ")
	s = regexp.MustCompile(`\s+`).ReplaceAllString(s, " ")
	return strings.TrimSpace(s)
}

// normalizeName is a lighter normalization for name tokens: uppercase and
// collapse whitespace.
func normalizeName(s string) string {
	return strings.TrimSpace(strings.ToUpper(strings.Join(
		regexp.MustCompile(`\s+`).Split(strings.TrimSpace(s), -1), " ")))
}

// nameTokenSimilarity is a simple overlap-based heuristic. It is not a full
// phonetic engine; it is meant to rank obvious cases and to fail safe when
// the names diverge.
func nameTokenSimilarity(a, b string) float64 {
	ta := tokenSet(normalizeName(a))
	tb := tokenSet(normalizeName(b))
	if len(ta) == 0 && len(tb) == 0 {
		return 1
	}
	if len(ta) == 0 || len(tb) == 0 {
		return 0
	}
	intersection := 0
	for tk := range ta {
		if tb[tk] {
			intersection++
		}
	}
	union := len(ta) + len(tb) - intersection
	if union == 0 {
		return 0
	}
	return float64(intersection) / float64(union)
}

func tokenSet(s string) map[string]bool {
	tokens := regexp.MustCompile(`\s+`).Split(s, -1)
	out := make(map[string]bool, len(tokens))
	for _, t := range tokens {
		if t != "" {
			out[t] = true
		}
	}
	return out
}

type candidate struct {
	mc      MatchCandidate
	score   float64
	basis   string
	primary bool
}

// FindCandidates returns ranked suggestions for unallocated holding entries.
// It queries learners (with primary guardian phone) and the M-Pesa inbox for
// the entry’s incoming message context, then scores each learner.
func (m *Matcher) FindCandidates(
	ctx context.Context,
	tenantID string,
	entry HoldingEntry,
) ([]MatchCandidate, error) {
	q := m.q(ctx)

	// Pull inbox context for the entry if available. The holding tank entry's
	// reference often corresponds to an inbox trans_id or paybill reference;
	// sender_name / sender_phone are useful for scoring.
	var inboxSenderName string
	var inboxSenderPhone string
	var inboxAccountRef string
	if entry.Reference != "" {
		err := q.QueryRowContext(ctx, `
			SELECT sender_name, sender_phone, account_reference
			FROM mpesa_raw_inbox
			WHERE tenant_id = $1 AND trans_id = $2
			LIMIT 1`, tenantID, entry.Reference).Scan(
			&inboxSenderName, &inboxSenderPhone, &inboxAccountRef,
		)
		if err != nil && err != db.ErrNoRows {
			return nil, err
		}
		if err == nil {
			if inboxSenderName != "" {
				entry.ReceiverName = inboxSenderName
			}
			if inboxSenderPhone != "" {
				entry.ReceiverPhone = inboxSenderPhone
			}
			if inboxAccountRef != "" {
				entry.AccountReference = inboxAccountRef
			}
		}
	}

	// Learners for this tenant, with primary guardian phone where present.
	rows, err := q.QueryContext(ctx, `
		SELECT l.learner_id, l.admission_number,
		       l.first_name || ' ' || l.last_name,
		       COALESCE(gd.phone_number, ''),
		       l.status
		FROM learners l
		LEFT JOIN learner_guardians lg ON lg.learner_id = l.learner_id AND lg.is_primary_payer
		LEFT JOIN guardians gd ON gd.guardian_id = lg.guardian_id
		WHERE l.tenant_id = $1
		ORDER BY l.last_name, l.first_name`, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []MatchCandidate
	for rows.Next() {
		var id, admission, name, guardian, status string
		if err := rows.Scan(&id, &admission, &name, &guardian, &status); err != nil {
			return nil, err
		}
		if status != "ACTIVE" {
			continue
		}

		c, ok := scoreCandidate(entry, admission, name, guardian)
		if !ok {
			continue
		}
		c.LearnerID = id
		c.AdmissionNumber = admission
		c.LearnerName = name
		if guardian != "" {
			c.GuardianPhone = guardian
		}
		out = append(out, c.mc)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	sort.Slice(out, func(i, j int) bool {
		if out[i].ConfidenceScore != out[j].ConfidenceScore {
			return out[i].ConfidenceScore > out[j].ConfidenceScore
		}
		return out[i].AdmissionNumber < out[j].AdmissionNumber
	})

	if len(out) > 10 {
		out = out[:10]
	}
	return out, nil
}

func scoreCandidate(entry HoldingEntry, admission, learnerName, guardianPhone string) (MatchCandidate, bool) {
	c := MatchCandidate{
		AdmissionNumber: admission,
		LearnerName:     learnerName,
		GuardianPhone:   guardianPhone,
		ConfidenceScore: 0,
	}

	refNorm := normalizeReference(entry.AccountReference)
	if refNorm == "" {
		refNorm = normalizeReference(entry.Reference)
	}
	admissionNorm := normalizeReference(admission)

	// Direct admission key match against the account reference.
	if refNorm != "" && admissionNorm != "" && refNorm == admissionNorm {
		c.ConfidenceScore = 1
		c.MatchBasis = "exact_admission_reference"
		return c, true
	}

	// Receiver phone matched to primary guardian phone.
	if entry.ReceiverPhone != "" && guardianPhone != "" {
		if strings.EqualFold(entry.ReceiverPhone, guardianPhone) {
			c.ConfidenceScore = 0.9
			c.MatchBasis = "guardian_phone_match"
			c.primary = true
			return c, true
		}
	}

	// Name overlap with the inbox sender name, if present.
	if entry.ReceiverName != "" && learnerName != "" {
		sim := nameTokenSimilarity(entry.ReceiverName, learnerName)
		if sim >= 0.75 {
			score := 0.7 + sim*0.2
			if score > c.ConfidenceScore {
				c.ConfidenceScore = score
				c.MatchBasis = "sender_name_similarity"
			}
		}
	}

	// Fallback: partial admission reference match when the account reference
	// contains the admission number or vice-versa.
	if refNorm != "" && admissionNorm != "" {
		if strings.Contains(refNorm, admissionNorm) || strings.Contains(admissionNorm, refNorm) {
			if c.ConfidenceScore < 0.6 {
				c.ConfidenceScore = 0.6
				c.MatchBasis = "partial_admission_reference"
			}
		}
	}

	if c.ConfidenceScore >= 0.6 {
		return c, true
	}
	return c, false
}

// Query helpers for the matcher. These keep the matcher consistent with the
// rest of the package by reusing the request-scoped transaction when present.

func (m *Matcher) q(ctx context.Context) queryer {
	if tx := middleware.TxFromContext(ctx); tx != nil {
		return tx
	}
	return m.db
}

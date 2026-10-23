package audit

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/jmoiron/sqlx"
)

// Service writes audit events to the audit_log table.
// Events are fire-and-forget — failures are logged, never block the request.
type Service struct {
	db *sqlx.DB
}

func NewService(db *sqlx.DB) *Service {
	return &Service{db: db}
}

// Event represents a single audit entry.
type Event struct {
	ID        int64
	UserID    *string
	Event     string
	IP        *string
	UserAgent *string
	RequestID *string
	Metadata  map[string]any
	CreatedAt time.Time
}

// Log writes an audit event. Non-blocking — errors are swallowed.
func (s *Service) Log(event string, userID *string, ip, userAgent, requestID *string, metadata map[string]any) {
	if metadata == nil {
		metadata = map[string]any{}
	}
	go func() {
		_, err := s.db.Exec(
			`INSERT INTO audit_log (user_id, event, ip, user_agent, request_id, metadata)
			 VALUES ($1, $2, $3, $4, $5, $6)`,
			userID, event, ip, userAgent, requestID, metadata,
		)
		if err != nil {
			fmt.Printf("audit log failed: %v\n", err)
		}
	}()
}

// ListRecent returns the most recent audit events.
func (s *Service) ListRecent(limit int) ([]Event, error) {
	rows, err := s.db.Query(
		`SELECT id, user_id, event, ip, user_agent, request_id, created_at
	       FROM audit_log ORDER BY created_at DESC LIMIT $1`,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []Event
	for rows.Next() {
		var e Event
		if err := rows.Scan(&e.ID, &e.UserID, &e.Event, &e.IP, &e.UserAgent, &e.RequestID, &e.CreatedAt); err != nil {
			return nil, err
		}
		events = append(events, e)
	}
	return events, nil
}

var _ = sql.ErrNoRows

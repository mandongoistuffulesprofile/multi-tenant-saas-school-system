package outbox

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
)

type OutboxEvent struct {
	OutboxID      string                 `json:"outbox_id"`
	AggregateType string                 `json:"aggregate_type"`
	AggregateID   string                 `json:"aggregate_id"`
	EventType     string                 `json:"event_type"`
	EventID       string                 `json:"event_id"`
	Payload       map[string]interface{} `json:"payload"`
	TenantID      string                 `json:"tenant_id"`
	Status        string                 `json:"status"`
	CreatedAt     time.Time              `json:"created_at"`
	AttemptCount  int                    `json:"attempt_count"`
}

type queryer interface {
	QueryContext(ctx context.Context, query string, args ...interface{}) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...interface{}) *sql.Row
	ExecContext(ctx context.Context, query string, args ...interface{}) (sql.Result, error)
	Query(query string, args ...interface{}) (*sql.Rows, error)
	QueryRow(query string, args ...interface{}) *sql.Row
	Exec(query string, args ...interface{}) (sql.Result, error)
}

type Service struct {
	database *db.DB
}

func NewService(database *db.DB) *Service {
	return &Service{database: database}
}

func (s *Service) getQueryer(ctx context.Context) queryer {
	if tx := middleware.TxFromContext(ctx); tx != nil {
		return tx
	}
	return s.database
}

func (s *Service) Publish(ctx context.Context, aggregateType, aggregateID, eventType, eventID, tenantID string, payload map[string]interface{}) error {
	payloadJSON, _ := json.Marshal(payload)
	q := s.getQueryer(ctx)

	_, err := q.ExecContext(ctx,
		`INSERT INTO outbox (aggregate_type, aggregate_id, event_type, event_id, payload, tenant_id, status)
		 VALUES ($1, $2, $3, $4, $5, $6, 'PENDING')`,
		aggregateType, aggregateID, eventType, eventID, string(payloadJSON), tenantID,
	)
	if err != nil {
		return fmt.Errorf("failed to publish outbox event: %w", err)
	}
	return nil
}

func (s *Service) PublishWithTx(tx *db.Tx, aggregateType, aggregateID, eventType, eventID, tenantID string, payload map[string]interface{}) error {
	payloadJSON, _ := json.Marshal(payload)

	_, err := tx.Exec(
		`INSERT INTO outbox (aggregate_type, aggregate_id, event_type, event_id, payload, tenant_id, status)
		 VALUES ($1, $2, $3, $4, $5, $6, 'PENDING')`,
		aggregateType, aggregateID, eventType, eventID, string(payloadJSON), tenantID,
	)
	if err != nil {
		return fmt.Errorf("failed to publish outbox event in transaction: %w", err)
	}
	return nil
}

func (s *Service) GetPending(ctx context.Context, tenantID string, limit int) ([]OutboxEvent, error) {
	q := s.getQueryer(ctx)
	rows, err := q.QueryContext(ctx,
		`SELECT outbox_id, aggregate_type, aggregate_id, event_type, event_id, payload, tenant_id, status, created_at
		 FROM outbox
		 WHERE status = 'PENDING' AND tenant_id = $1
		 ORDER BY created_at ASC
		 LIMIT $2`,
		tenantID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []OutboxEvent
	for rows.Next() {
		var e OutboxEvent
		var payloadJSON []byte
		if err := rows.Scan(&e.OutboxID, &e.AggregateType, &e.AggregateID, &e.EventType, &e.EventID, &payloadJSON, &e.TenantID, &e.Status, &e.CreatedAt); err != nil {
			return nil, err
		}
		json.Unmarshal(payloadJSON, &e.Payload)
		events = append(events, e)
	}
	return events, rows.Err()
}

func (s *Service) MarkPublished(ctx context.Context, outboxID string, tenantID string) error {
	q := s.getQueryer(ctx)
	_, err := q.ExecContext(ctx,
		`UPDATE outbox SET status = 'PUBLISHED', published_at = CURRENT_TIMESTAMP WHERE outbox_id = $1 AND tenant_id = $2`,
		outboxID, tenantID,
	)
	return err
}

func (s *Service) MarkFailed(ctx context.Context, outboxID string, tenantID string) error {
	q := s.getQueryer(ctx)
	_, err := q.ExecContext(ctx,
		`UPDATE outbox SET status = 'FAILED', attempt_count = attempt_count + 1 WHERE outbox_id = $1 AND tenant_id = $2`,
		outboxID, tenantID,
	)
	return err
}

package outbox

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
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

type Service struct {
	database *db.DB
}

func NewService(database *db.DB) *Service {
	return &Service{database: database}
}

func (s *Service) Publish(aggregateType, aggregateID, eventType, eventID, tenantID string, payload map[string]interface{}) error {
	payloadJSON, _ := json.Marshal(payload)

	_, err := s.database.Exec(
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

func (s *Service) GetPending(limit int) ([]OutboxEvent, error) {
	rows, err := s.database.Query(
		`SELECT outbox_id, aggregate_type, aggregate_id, event_type, event_id, payload, tenant_id, status, created_at
		 FROM outbox
		 WHERE status = 'PENDING'
		 ORDER BY created_at ASC
		 LIMIT $1`,
		limit,
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
	return events, nil
}

func (s *Service) MarkPublished(outboxID string) error {
	_, err := s.database.Exec(
		`UPDATE outbox SET status = 'PUBLISHED', published_at = CURRENT_TIMESTAMP WHERE outbox_id = $1`,
		outboxID,
	)
	return err
}

func (s *Service) MarkFailed(outboxID string) error {
	_, err := s.database.Exec(
		`UPDATE outbox SET status = 'FAILED', attempt_count = attempt_count + 1 WHERE outbox_id = $1`,
		outboxID,
	)
	return err
}

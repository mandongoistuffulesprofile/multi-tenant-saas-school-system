package outbox

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"
)

// Handler processes one event. Returning an error schedules a retry with
// exponential backoff; after maxAttempts the row becomes FAILED and is left for
// an operator instead of blocking the queue.
type Handler func(context.Context, OutboxEvent) error

const maxAttempts = 8

// Drain claims up to limit due events with FOR UPDATE SKIP LOCKED. The handler
// runs while the rows are locked, so two API instances cannot process the same
// event. Keep handlers short and idempotent.
func (s *Service) Drain(ctx context.Context, limit int, handler Handler) (int, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}

	tx, err := s.database.BeginTxx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("outbox drain begin: %w", err)
	}
	defer tx.Rollback()

	rows, err := tx.QueryContext(ctx, `
		SELECT outbox_id, aggregate_type, aggregate_id, event_type, event_id,
		       payload, tenant_id, status, created_at, attempt_count
		FROM outbox
		WHERE status = 'PENDING' AND next_attempt_at <= CURRENT_TIMESTAMP
		ORDER BY next_attempt_at, created_at
		LIMIT $1
		FOR UPDATE SKIP LOCKED`, limit)
	if err != nil {
		return 0, fmt.Errorf("outbox claim: %w", err)
	}

	events := make([]OutboxEvent, 0, limit)
	for rows.Next() {
		var e OutboxEvent
		var payload []byte
		if err := rows.Scan(&e.OutboxID, &e.AggregateType, &e.AggregateID, &e.EventType,
			&e.EventID, &payload, &e.TenantID, &e.Status, &e.CreatedAt, &e.AttemptCount); err != nil {
			rows.Close()
			return 0, fmt.Errorf("outbox scan: %w", err)
		}
		if len(payload) > 0 {
			e.Payload = map[string]interface{}{}
			_ = jsonUnmarshal(payload, &e.Payload)
		}
		events = append(events, e)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}

	for _, event := range events {
		if handler != nil {
			err = handler(ctx, event)
		}
		if err == nil {
			_, err = tx.ExecContext(ctx, `
				UPDATE outbox
				SET status = 'PUBLISHED', published_at = CURRENT_TIMESTAMP, last_error = NULL
				WHERE outbox_id = $1`, event.OutboxID)
			if err != nil {
				return 0, err
			}
			continue
		}

		attempts := event.AttemptCount + 1
		if attempts >= maxAttempts {
			_, err = tx.ExecContext(ctx, `
				UPDATE outbox
				SET status = 'FAILED', attempt_count = attempt_count + 1, last_error = $2
				WHERE outbox_id = $1`, event.OutboxID, err.Error())
		} else {
			backoff := time.Duration(1<<uint(attempts)) * time.Minute
			_, err = tx.ExecContext(ctx, `
				UPDATE outbox
				SET attempt_count = attempt_count + 1,
				    next_attempt_at = CURRENT_TIMESTAMP + $2::interval,
				    last_error = $3
				WHERE outbox_id = $1`, event.OutboxID, backoff.String(), err.Error())
		}
		if err != nil {
			return 0, err
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("outbox commit: %w", err)
	}
	return len(events), nil
}

// StartWorker drains until ctx is cancelled. It is deliberately serial: one
// API instance owns the queue at this scale, and SKIP LOCKED makes a second
// instance safe if it is ever added.
func (s *Service) StartWorker(ctx context.Context, interval time.Duration, handler Handler) {
	if interval <= 0 {
		interval = 10 * time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			n, err := s.Drain(ctx, 100, handler)
			if err != nil {
				slog.Error("outbox_drain_failed", "error", err)
				continue
			}
			if n > 0 {
				slog.Info("outbox_drained", "events", n)
			}
		}
	}
}

// jsonUnmarshal is a tiny indirection so worker.go does not import encoding/json
// only for one call; it keeps the error intentionally ignored because a bad
// payload should not stop the queue (the handler sees an empty map).
func jsonUnmarshal(data []byte, v any) error {
	return json.Unmarshal(data, v)
}

package outbox

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"time"
)

// tableName is the single canonical outbox table. Migration 0001 creates
// `outbox`; migration 0006 adds next_attempt_at/last_error. The worker used to
// read a nonexistent `correlation_outbox` with columns that were never
// migrated, so queued events were never dispatched.
const tableName = "outbox"

const (
	maxAttempts   = 5
	batchSize     = 25
	maxBackoffSec = 30 * 60
)

type Event struct {
	ID            string          `json:"id"`
	TenantID      string          `json:"tenant_id"`
	Topic         string          `json:"topic"`
	Payload       json.RawMessage `json:"payload"`
	Attempts      int             `json:"attempts"`
	AggregateType string          `json:"aggregate_type"`
	AggregateID   string          `json:"aggregate_id"`
}

type Dispatcher interface {
	Dispatch(ctx context.Context, topic string, payload []byte) error
}

type OutboxWorker struct {
	db         *sql.DB
	dispatcher Dispatcher
	logger     *slog.Logger
}

func NewOutboxWorker(db *sql.DB, d Dispatcher, l *slog.Logger) *OutboxWorker {
	return &OutboxWorker{db: db, dispatcher: d, logger: l}
}

func (w *OutboxWorker) Run(ctx context.Context) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			w.flush(ctx)
		}
	}
}

func (w *OutboxWorker) flush(ctx context.Context) {
	tx, err := w.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		w.logger.Error("Could not start outbox transaction", "error", err)
		return
	}
	defer tx.Rollback()

	// event_type is the dispatch topic. next_attempt_at gates retries so a
	// failed event is not hammered on every tick.
	query := `
		SELECT outbox_id, tenant_id, aggregate_type, aggregate_id, event_type,
		       payload, attempt_count
		FROM ` + tableName + `
		WHERE (status IN ('PENDING', 'FAILED')
		       OR (status = 'PROCESSING' AND next_attempt_at <= NOW()))
		  AND attempt_count < $1
		  AND next_attempt_at <= NOW()
		ORDER BY created_at ASC
		LIMIT $2
		FOR UPDATE SKIP LOCKED`

	rows, err := tx.QueryContext(ctx, query, maxAttempts, batchSize)
	if err != nil {
		w.logger.Error("Querying outbox failed", "error", err)
		return
	}

	var events []Event
	for rows.Next() {
		var e Event
		var payload []byte
		if err := rows.Scan(&e.ID, &e.TenantID, &e.AggregateType, &e.AggregateID,
			&e.Topic, &payload, &e.Attempts); err != nil {
			w.logger.Error("Scanning outbox event failed", "error", err)
			continue
		}
		e.Payload = payload
		events = append(events, e)
	}
	rows.Close()

	// Claim the batch with a 2-minute lease in next_attempt_at. A crashed
	// worker's PROCESSING rows become eligible again when the lease expires.
	for _, e := range events {
		if _, err := tx.ExecContext(ctx,
			`UPDATE `+tableName+`
			 SET status = 'PROCESSING', next_attempt_at = NOW() + INTERVAL '2 minutes'
			 WHERE outbox_id = $1`, e.ID); err != nil {
			w.logger.Error("Claiming outbox event failed", "error", err, "outbox_id", e.ID)
		}
	}

	if err := tx.Commit(); err != nil {
		w.logger.Error("Committing outbox claim failed", "error", err)
		return
	}

	// Dispatch outside the transaction so a slow provider never holds a row
	// lock, then record the terminal state.
	for _, e := range events {
		dispatchErr := w.dispatcher.Dispatch(ctx, e.Topic, e.Payload)
		w.resolveEvent(ctx, e.ID, e.Attempts, dispatchErr)
	}
}

func (w *OutboxWorker) resolveEvent(ctx context.Context, eventID string, attempts int, dispatchErr error) {
	if dispatchErr == nil {
		if _, err := w.db.ExecContext(ctx, `
			UPDATE `+tableName+`
			SET status = 'PUBLISHED', published_at = NOW(), last_error = NULL
			WHERE outbox_id = $1`, eventID); err != nil {
			w.logger.Error("Marking outbox event published failed", "error", err, "outbox_id", eventID)
		}
		return
	}

	nextAttempt := attempts + 1
	backoffSeconds := nextAttempt * nextAttempt * 10
	if backoffSeconds > maxBackoffSec {
		backoffSeconds = maxBackoffSec
	}
	status := "FAILED"
	if nextAttempt >= maxAttempts {
		status = "DEAD_LETTER"
	}
	if _, err := w.db.ExecContext(ctx, `
		UPDATE `+tableName+`
		SET attempt_count = $1,
		    status = $2,
		    next_attempt_at = NOW() + ($3 || ' seconds')::INTERVAL,
		    last_error = $4
		WHERE outbox_id = $5`, nextAttempt, status, backoffSeconds, dispatchErr.Error(), eventID); err != nil {
		w.logger.Error("Recording outbox failure failed", "error", err, "outbox_id", eventID)
	}
}

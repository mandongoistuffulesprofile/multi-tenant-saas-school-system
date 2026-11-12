package outbox

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"time"
)

type Event struct {
	ID         string          `json:"id"`
	TenantID   string          `json:"tenant_id"`
	Topic      string          `json:"topic"`
	Payload    json.RawMessage `json:"payload"`
	Attempts   int             `json:"attempts"`
	AggregateType string       `json:"aggregate_type"`
	AggregateID string         `json:"aggregate_id"`
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

	// Claim records with lease timeout (5 minutes) for stranded records
	query := `
		SELECT outbox_id, tenant_id, aggregate_type, aggregate_id, event_type, event_id, payload, attempt_count
		FROM correlation_outbox
		WHERE status IN ('PENDING', 'FAILED') 
		  AND attempts < 5 
		  AND (locked_until IS NULL OR locked_until < NOW())
		ORDER BY created_at ASC
		LIMIT 25
		FOR UPDATE SKIP LOCKED;
	`

	rows, err := tx.QueryContext(ctx, query)
	if err != nil {
		w.logger.Error("Querying outbox failed", "error", err)
		return
	}
	defer rows.Close()

	var events []Event
	for rows.Next() {
		var e Event
		var payload []byte
		if err := rows.Scan(&e.ID, &e.TenantID, &e.AggregateType, &e.AggregateID, &e.Topic, &e.Attempts, &payload, &e.Attempts); err == nil {
			e.Payload = payload
			events = append(events, e)
		}
	}
	rows.Close()

	if len(events) == 0 {
		return
	}

	// Mark in-flight with a lock lease (2 minutes)
	lockQuery := `UPDATE correlation_outbox SET locked_until = NOW() + INTERVAL '2 minutes' WHERE outbox_id = $1`
	for _, e := range events {
		_, _ = tx.ExecContext(ctx, lockQuery, e.ID)
	}

	if err := tx.Commit(); err != nil {
		return
	}

	// Process deliveries outside transaction lock
	for _, e := range events {
		err := w.dispatcher.Dispatch(ctx, e.Topic, e.Payload)
		w.resolveEvent(ctx, e.ID, e.Attempts, err)
	}
}

func (w *OutboxWorker) resolveEvent(ctx context.Context, eventID string, attempts int, err error) {
	if err == nil {
		_, _ = w.db.ExecContext(ctx, `
			UPDATE correlation_outbox 
			SET status = 'SENT', processed_at = NOW(), locked_until = NULL 
			WHERE outbox_id = $1`, eventID)
	} else {
		nextAttempt := attempts + 1
		backoffSeconds := nextAttempt * nextAttempt * 10
		_, _ = w.db.ExecContext(ctx, `
			UPDATE correlation_outbox 
			SET attempts = $1, 
			    status = CASE WHEN $1 >= 5 THEN 'DEAD_LETTER' ELSE 'FAILED' END,
			    locked_until = NOW() + ($2 || ' seconds')::INTERVAL,
			    last_error = $3
			WHERE outbox_id = $4`, nextAttempt, backoffSeconds, err.Error(), eventID)
	}
}
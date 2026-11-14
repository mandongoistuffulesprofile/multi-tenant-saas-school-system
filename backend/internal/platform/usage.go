package platform

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jmoiron/sqlx"
)

// UsageWorker records monthly usage per school in tenant_usage.
//
// Why a snapshot at all: the flows (SMS, payments, reports, assessments, gate
// taps) can be counted from their source tables for any month, but the stock
// figures — learners on the roll and active staff — have no history table worth
// trusting, so they are counted for the month they are recorded in and carried
// by that row afterwards. Re-running a month rewrites it, which keeps the
// current month honest as it progresses.
// txBeginner is satisfied by *db.DB and *sqlx.DB, so callers pass whichever
// they already hold.
type txBeginner interface {
	BeginTxx(ctx context.Context, opts *sql.TxOptions) (*sqlx.Tx, error)
	QueryContext(ctx context.Context, query string, args ...interface{}) (*sql.Rows, error)
}

type UsageWorker struct {
	db     txBeginner
	logger *slog.Logger
}

func NewUsageWorker(db txBeginner, logger *slog.Logger) *UsageWorker {
	if logger == nil {
		logger = slog.Default()
	}
	return &UsageWorker{db: db, logger: logger}
}

// Start records usage immediately and then once a day.
func (w *UsageWorker) Start(ctx context.Context, interval time.Duration) {
	if count, err := w.RunOnce(ctx, 12); err != nil {
		w.logger.Error("usage snapshot failed", "error", err)
	} else {
		w.logger.Info("usage snapshot written", "tenants", count)
	}

	ticker := time.NewTicker(interval)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				w.logger.Info("terminating usage snapshot worker")
				return
			case <-ticker.C:
				if _, err := w.RunOnce(ctx, 12); err != nil {
					w.logger.Error("usage snapshot failed", "error", err)
				}
			}
		}
	}()
}

// RunOnce snapshots every school for the last `months` months and returns the
// number of tenants written.
func (w *UsageWorker) RunOnce(ctx context.Context, months int) (int, error) {
	if w == nil || w.db == nil {
		return 0, errors.New("usage worker has no database")
	}
	if months <= 0 {
		months = 1
	}
	if months > 36 {
		months = 36
	}

	tx, err := w.db.BeginTxx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return 0, fmt.Errorf("begin usage tx: %w", err)
	}
	defer tx.Rollback()

	// Workers need to enumerate tenants; the schools policy allows this only
	// when app.worker is set.
	if _, err := tx.ExecContext(ctx, "SELECT set_config('app.worker', 'on', true)"); err != nil {
		return 0, err
	}
	var tenants []string
	if err := tx.SelectContext(ctx, &tenants, `SELECT tenant_id FROM schools ORDER BY tenant_id`); err != nil {
		return 0, fmt.Errorf("list tenants: %w", err)
	}

	written := 0
	for _, tenantID := range tenants {
		if _, err := tx.ExecContext(ctx, "SELECT set_config('app.current_tenant_id', $1, true)", tenantID); err != nil {
			return written, err
		}
		if err := SnapshotTenant(ctx, tx, tenantID, months); err != nil {
			return written, fmt.Errorf("tenant %s: %w", tenantID, err)
		}
		written++
	}
	return written, tx.Commit()
}

// SnapshotTenant writes one row per month for a single school. It is exported so
// tests (and any backfill command) can run it against a tenant-scoped
// transaction without enumerating every school.
func SnapshotTenant(ctx context.Context, tx *sqlx.Tx, tenantID string, months int) error {
	if months <= 0 {
		months = 1
	}
	now := time.Now().UTC()
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)

	for i := months - 1; i >= 0; i-- {
		start := monthStart.AddDate(0, -i, 0)
		end := start.AddDate(0, 1, 0)
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO tenant_usage (
				tenant_id, period_month, active_learners, active_staff, sms_sent,
				reports_generated, assessments_recorded, payments_processed, gate_taps, storage_mb
			) VALUES (
				$1::varchar, $2::date,
				(SELECT count(*) FROM learners l
				  WHERE l.tenant_id = $1::varchar
				    AND COALESCE(l.admitted_on::timestamp, l.created_at) < $3::timestamptz
				    AND NOT EXISTS (
				      SELECT 1 FROM learner_status_history h
				      WHERE h.learner_id = l.learner_id
				        AND lower(h.new_status) IN ('inactive', 'left', 'transferred', 'graduated')
				        AND h.changed_at < $3::timestamptz
				    )),
				(SELECT count(*) FROM tenant_memberships m
				  WHERE m.tenant_id = $1::varchar AND m.status = 'ACTIVE' AND m.created_at < $3::timestamptz),
				(SELECT count(*) FROM outbound_messages
				  WHERE tenant_id = $1::varchar AND channel = 'SMS' AND created_at >= $2::timestamptz AND created_at < $3::timestamptz),
				(SELECT count(*) FROM report_runs
				  WHERE tenant_id = $1::varchar AND created_at >= $2::timestamptz AND created_at < $3::timestamptz),
				(SELECT count(*) FROM assessment_results
				  WHERE tenant_id = $1::varchar AND server_ts >= $2::timestamptz AND server_ts < $3::timestamptz),
				(SELECT count(*) FROM payments
				  WHERE tenant_id = $1::varchar AND status = 'COMPLETED' AND created_at >= $2::timestamptz AND created_at < $3::timestamptz),
				(SELECT count(*) FROM gate_events
				  WHERE tenant_id = $1::varchar AND event_ts >= $2::timestamptz AND event_ts < $3::timestamptz),
				0
			)
			ON CONFLICT (tenant_id, period_month) DO UPDATE SET
				active_learners = EXCLUDED.active_learners,
				active_staff = EXCLUDED.active_staff,
				sms_sent = EXCLUDED.sms_sent,
				reports_generated = EXCLUDED.reports_generated,
				assessments_recorded = EXCLUDED.assessments_recorded,
				payments_processed = EXCLUDED.payments_processed,
				gate_taps = EXCLUDED.gate_taps,
				updated_at = CURRENT_TIMESTAMP`,
			tenantID, start, end); err != nil {
			return fmt.Errorf("snapshot %s: %w", start.Format("2006-01"), err)
		}
	}
	return nil
}

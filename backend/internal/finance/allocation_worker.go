package finance

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/money"
)

type AllocationWorker struct {
	db     *sql.DB
	logger *slog.Logger
}

func NewAllocationWorker(db *sql.DB, logger *slog.Logger) *AllocationWorker {
	return &AllocationWorker{db: db, logger: logger}
}

func (w *AllocationWorker) Start(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	go func() {
		for {
			select {
			case <-ctx.Done():
				w.logger.Info("Terminating M-Pesa allocation worker")
				return
			case <-ticker.C:
				if err := w.processBatch(ctx); err != nil {
					w.logger.Error("Error processing M-Pesa batch", "error", err)
				}
			}
		}
	}()
}

func (w *AllocationWorker) processBatch(ctx context.Context) error {
	tx, err := w.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return fmt.Errorf("failed to begin worker tx: %w", err)
	}
	defer tx.Rollback()

	// Select next unallocated payments locking only target rows
	// Process in tenant order for deterministic locking
	selectQuery := `
		SELECT id, tenant_id, trans_id, trans_amount::text, bill_ref_number
		FROM mpesa_inbox
		WHERE status = 'PENDING'
		ORDER BY tenant_id, created_at ASC
		LIMIT 20
		FOR UPDATE SKIP LOCKED;
	`
	rows, err := tx.QueryContext(ctx, selectQuery)
	if err != nil {
		return err
	}
	defer rows.Close()

	type Item struct {
		ID       string
		TenantID string
		TransID  string
		Amount   string
		BillRef  string
	}
	var batch []Item

	for rows.Next() {
		var it Item
		if err := rows.Scan(&it.ID, &it.TenantID, &it.TransID, &it.Amount, &it.BillRef); err != nil {
			return err
		}
		batch = append(batch, it)
	}
	rows.Close()

	for _, item := range batch {
		if err := w.allocatePayment(ctx, tx, item.ID, item.TenantID, item.TransID, item.Amount, item.BillRef); err != nil {
			w.logger.Error("Failed to allocate payment item", "trans_id", item.TransID, "error", err)
			_, _ = tx.ExecContext(ctx, `
				UPDATE mpesa_inbox 
				SET status = 'FAILED', error_message = $1, retry_count = retry_count + 1, updated_at = NOW() 
				WHERE id = $2`, err.Error(), item.ID)
		} else {
			_, _ = tx.ExecContext(ctx, `
				UPDATE mpesa_inbox 
				SET status = 'PROCESSED', updated_at = NOW() 
				WHERE id = $1`, item.ID)
		}
	}

	return tx.Commit()
}

func (w *AllocationWorker) allocatePayment(ctx context.Context, tx *sql.Tx, inboxID, tenantID, transID, amountStr, admissionNo string) error {
	// Set RLS scope dynamically for each allocation unit
	if _, err := tx.ExecContext(ctx, "SELECT set_config('app.current_tenant_id', $1, true)", tenantID); err != nil {
		return err
	}

	// Snap the inbox amount (NUMERIC read as text) to exact decimal cents.
	allocAmount := money.New(amountStr)
	if allocAmount.LessThanOrEqual(money.Zero()) {
		return fmt.Errorf("allocation amount must exceed zero")
	}

	// 1. Resolve student by admission number. A reference like
	// "ADM-1024/TUITION" names a votehead as well; the account part is what the
	// learner is looked up by, and an unknown code leaves the reference alone.
	accountRef, voteheadHint := ResolveReferenceHint(ctx, tx, tenantID, admissionNo)
	var studentID string
	err := tx.QueryRowContext(ctx, `
		SELECT learner_id FROM learners 
		WHERE admission_number = $1 AND tenant_id = $2`, accountRef, tenantID).Scan(&studentID)
	if err == sql.ErrNoRows {
		return fmt.Errorf("student admission %s not found for tenant %s", admissionNo, tenantID)
	} else if err != nil {
		return err
	}

	// Record the receipt as a payment so allocations, the ledger and the
	// receipts list all agree on where the money came from. A replayed callback
	// resolves to the existing row instead of posting twice.
	var paymentID string
	err = tx.QueryRowContext(ctx, `
		INSERT INTO payments (tenant_id, payment_reference, learner_id, source, amount,
			currency, status, mpesa_trans_id, idempotency_key)
		VALUES ($1, $2, $3, 'MPESA', $4::numeric, 'KES', 'COMPLETED', $5, $6)
		ON CONFLICT (tenant_id, mpesa_trans_id) WHERE mpesa_trans_id IS NOT NULL DO NOTHING
		RETURNING payment_id`,
		tenantID, "MPESA-"+transID, studentID, allocAmount.StringFixed(2), transID,
		tenantID+":mpesa:"+transID).Scan(&paymentID)
	if errors.Is(err, sql.ErrNoRows) {
		if err := tx.QueryRowContext(ctx,
			`SELECT payment_id FROM payments WHERE tenant_id = $1 AND mpesa_trans_id = $2`,
			tenantID, transID).Scan(&paymentID); err != nil {
			return err
		}
	} else if err != nil {
		return err
	}

	// One planner for every receipt path: oldest term first, then the lines of
	// that term, with anything beyond the debt parked as an unapplied credit.
	if _, err := ApplyReceipt(ctx, tx, ReceiptApplication{
		TenantID:     tenantID,
		UserID:       "SYSTEM_WORKER",
		PaymentID:    paymentID,
		LearnerID:    studentID,
		Amount:       allocAmount,
		HintVotehead: voteheadHint,
		Rule:         AllocationPriority,
		Reference:    transID,
	}); err != nil {
		return err
	}

	return nil
}

package finance

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"time"
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
		SELECT id, tenant_id, trans_id, trans_amount, bill_ref_number
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
		Amount   float64
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

func (w *AllocationWorker) allocatePayment(ctx context.Context, tx *sql.Tx, inboxID, tenantID, transID string, amount float64, admissionNo string) error {
	// Set RLS scope dynamically for each allocation unit
	if _, err := tx.ExecContext(ctx, "SELECT set_config('app.current_tenant_id', $1, true)", tenantID); err != nil {
		return err
	}

	// 1. Resolve student by admission number
	var studentID string
	err := tx.QueryRowContext(ctx, `
		SELECT learner_id FROM learners 
		WHERE admission_number = $1 AND tenant_id = $2`, admissionNo, tenantID).Scan(&studentID)
	if err == sql.ErrNoRows {
		return fmt.Errorf("student admission %s not found for tenant %s", admissionNo, tenantID)
	} else if err != nil {
		return err
	}

	// 2. Select invoices for update to prevent concurrent race conditions
	// Deterministic lock ordering: ORDER BY due_date ASC NULLS LAST
	rows, err := tx.QueryContext(ctx, `
		SELECT invoice_id, (total_amount - amount_paid) as remaining_balance 
		FROM invoices 
		WHERE learner_id = $1 AND tenant_id = $2 AND status IN ('ISSUED','PARTIALLY_PAID','OVERDUE')
		ORDER BY due_date ASC NULLS LAST, created_at
		FOR UPDATE`, studentID, tenantID)
	if err != nil {
		return err
	}
	defer rows.Close()

	remainingPayment := amount
	for rows.Next() && remainingPayment > 0 {
		var invoiceID string
		var remainingBalance float64
		if err := rows.Scan(&invoiceID, &remainingBalance); err != nil {
			return err
		}

		allocation := remainingPayment
		if allocation > remainingBalance {
			allocation = remainingBalance
		}

		// Update Invoice atomically
		newBalance := remainingBalance - allocation
		newStatus := "PARTIALLY_PAID"
		if newBalance <= 0.005 { // Account for floating point
			newStatus = "PAID"
			newBalance = 0
		}

		_, err = tx.ExecContext(ctx, `
			UPDATE invoices 
			SET amount_paid = amount_paid + $1, status = $2, amount_outstanding = GREATEST(amount_outstanding - $1, 0), updated_at = NOW()
			WHERE invoice_id = $3 AND tenant_id = $4`, allocation, newStatus, invoiceID, tenantID)
		if err != nil {
			return err
		}

		// Ledger write - immutable forensic record
		_, err = tx.ExecContext(ctx, `
			INSERT INTO payment_ledger (
				tenant_id, inbox_id, receipt_number, student_id, invoice_id, 
				amount, balance_before, balance_after, allocated_by
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'SYSTEM_WORKER')`,
			tenantID, inboxID, transID, studentID, invoiceID, allocation, remainingBalance, newBalance)
		if err != nil {
			return err
		}

		remainingPayment -= allocation
	}

	return nil
}
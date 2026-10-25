package daraja

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
)

type C2BCallback struct {
	TransactionType string `json:"TransactionType"`
	TransID         string `json:"TransID"`
	TransTime       string `json:"TransTime"`
	TransAmount     string `json:"TransAmount"`
	BusinessShortCode string `json:"BusinessShortCode"`
	BillRefNumber   string `json:"BillRefNumber"`
	MSISDN          string `json:"MSISDN"`
	FirstName       string `json:"FirstName"`
}

type MpesaService struct {
	db *sql.DB
}

func NewMpesaService(db *sql.DB) *MpesaService {
	return &MpesaService{db: db}
}

// GeneratePassword calculates Daraja API authorization password
func GeneratePassword(shortcode, passkey string, timestamp time.Time) string {
	ts := timestamp.Format("20060102150405")
	raw := fmt.Sprintf("%s%s%s", shortcode, passkey, ts)
	return base64.StdEncoding.EncodeToString([]byte(raw))
}

// ProcessCallback handles Daraja validation/confirmation with strict idempotency and fee allocation
func (s *MpesaService) ProcessCallback(ctx context.Context, tenantID uuid.UUID, body []byte) (map[string]interface{}, error) {
	var cb C2BCallback
	if err := json.Unmarshal(body, &cb); err != nil {
		return nil, fmt.Errorf("invalid json callback: %w", err)
	}

	var amountFloat float64
	fmt.Sscanf(cb.TransAmount, "%f", &amountFloat)
	amountCents := int64(amountFloat * 100)

	// Execute within strict transaction isolation
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	// 1. Lock tenant context
	if _, err := tx.ExecContext(ctx, fmt.Sprintf("SET LOCAL app.current_tenant_id = '%s'", tenantID.String())); err != nil {
		return nil, err
	}

	// 2. Strict TransID Idempotency: Insert transaction record
	var mpesaID uuid.UUID
	insertTxSQL := `
		INSERT INTO mpesa_transactions (tenant_id, trans_id, trans_time, trans_amount_cents, msisdn, bill_ref_number, raw_payload)
		VALUES ($1, $2, NOW(), $3, $4, $5, $6)
		ON CONFLICT (trans_id) DO NOTHING
		RETURNING id;
	`
	err = tx.QueryRowContext(ctx, insertTxSQL, tenantID, cb.TransID, amountCents, cb.MSISDN, cb.BillRefNumber, body).Scan(&mpesaID)
	if errors.Is(err, sql.ErrNoRows) {
		// Already processed. Return 200 immediately to prevent Safaricom retry storm.
		return map[string]interface{}{"ResultCode": 0, "ResultDesc": "Duplicate TransID accepted"}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("transaction insert failed: %w", err)
	}

	// 3. Match Student Admission Number (BillRefNumber)
	var studentID uuid.UUID
	err = tx.QueryRowContext(ctx, "SELECT id FROM students WHERE admission_number = $1 AND tenant_id = $2", cb.BillRefNumber, tenantID).Scan(&studentID)
	if err == nil {
		// 4. Allocate payment against oldest unpaid invoices for student
		rows, qErr := tx.QueryContext(ctx, `
			SELECT i.id, i.total_cents - COALESCE(SUM(fa.allocated_cents), 0) AS remaining_cents
			FROM invoices i
			LEFT JOIN fee_allocations fa ON fa.invoice_id = i.id
			WHERE i.student_id = $1 AND i.tenant_id = $2
			GROUP BY i.id, i.total_cents
			HAVING i.total_cents - COALESCE(SUM(fa.allocated_cents), 0) > 0
			ORDER BY i.created_at ASC
		`, studentID, tenantID)

		if qErr == nil {
			defer rows.Close()
			unallocated := amountCents

			for rows.Next() && unallocated > 0 {
				var invID uuid.UUID
				var remaining int64
				if err := rows.Scan(&invID, &remaining); err != nil {
					continue
				}

				allocation := unallocated
				if allocation > remaining {
					allocation = remaining
				}

				_, _ = tx.ExecContext(ctx, `
					INSERT INTO fee_allocations (tenant_id, invoice_id, mpesa_transaction_id, allocated_cents)
					VALUES ($1, $2, $3, $4)
				`, tenantID, invID, mpesaID, allocation)

				unallocated -= allocation
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return map[string]interface{}{"ResultCode": 0, "ResultDesc": "Success"}, nil
}

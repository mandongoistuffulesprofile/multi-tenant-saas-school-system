package mpesa

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/database"
)

// C2BCallbackPayload represents the inbound Safaricom C2B confirmation JSON
type C2BCallbackPayload struct {
	TransactionType   string  `json:"TransactionType"`
	TransID           string  `json:"TransID"`
	TransTime         string  `json:"TransTime"`
	TransAmount       float64 `json:"TransAmount,string"`
	BusinessShortCode string  `json:"BusinessShortCode"`
	BillRefNumber     string  `json:"BillRefNumber"` // Student Admission Number
	MSISDN            string  `json:"MSISDN"`
	FirstName         string  `json:"FirstName"`
}

type DarajaService struct {
	dbPool *pgxpool.Pool
}

func NewDarajaService(pool *pgxpool.Pool) *DarajaService {
	return &DarajaService{dbPool: pool}
}

// HandleValidation responds immediately to Safaricom C2B validation queries
func (s *DarajaService) HandleValidation(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"ResultCode": 0, "ResultDesc": "Accepted"}`))
}

// HandleConfirmation processes payment, deduplicates by TransID, and auto-allocates to invoices
func (s *DarajaService) HandleConfirmation(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var payload C2BCallbackPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid payload", http.StatusBadRequest)
		return
	}

	defer func() {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"ResultCode": 0, "ResultDesc": "Confirmation processed"}`))
	}()

	if s.dbPool == nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	var studentID, tenantID uuid.UUID
	err := s.dbPool.QueryRow(ctx, `
		SELECT id, tenant_id FROM students WHERE UPPER(admission_number) = UPPER($1) LIMIT 1
	`, payload.BillRefNumber).Scan(&studentID, &tenantID)

	if err != nil {
		return
	}

	_ = database.RunInTenantTx(ctx, s.dbPool, tenantID, func(tx pgx.Tx) error {
		rawJSON, _ := json.Marshal(payload)

		var paymentID uuid.UUID
		err := tx.QueryRow(ctx, `
			INSERT INTO payments (tenant_id, student_id, mpesa_trans_id, payment_method, amount, phone_number, raw_payload)
			VALUES ($1, $2, $3, 'MPESA', $4, $5, $6)
			ON CONFLICT (mpesa_trans_id) DO NOTHING
			RETURNING id
		`, tenantID, studentID, payload.TransID, payload.TransAmount, payload.MSISDN, rawJSON).Scan(&paymentID)

		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("failed to insert payment: %w", err)
		}

		rows, err := tx.Query(ctx, `
			SELECT i.id, i.total_amount, COALESCE(SUM(fa.allocated_amount), 0) AS total_allocated
			FROM invoices i
			LEFT JOIN fee_allocations fa ON i.id = fa.invoice_id
			WHERE i.tenant_id = $1 AND i.student_id = $2
			GROUP BY i.id, i.total_amount, i.invoice_date
			HAVING COALESCE(SUM(fa.allocated_amount), 0) < i.total_amount
			ORDER BY i.invoice_date ASC
		`, tenantID, studentID)
		if err != nil {
			return err
		}
		defer rows.Close()

		remainingAmount := payload.TransAmount

		type InvBal struct {
			ID      uuid.UUID
			Balance float64
		}
		var invoicesToPay []InvBal

		for rows.Next() {
			var invID uuid.UUID
			var totalAmt, allocAmt float64
			if err := rows.Scan(&invID, &totalAmt, &allocAmt); err == nil {
				invoicesToPay = append(invoicesToPay, InvBal{ID: invID, Balance: totalAmt - allocAmt})
			}
		}

		for _, inv := range invoicesToPay {
			if remainingAmount <= 0 {
				break
			}
			alloc := remainingAmount
			if alloc > inv.Balance {
				alloc = inv.Balance
			}
			_, err = tx.Exec(ctx, `
				INSERT INTO fee_allocations (tenant_id, invoice_id, payment_id, allocated_amount)
				VALUES ($1, $2, $3, $4)
			`, tenantID, inv.ID, paymentID, alloc)
			if err != nil {
				return err
			}
			remainingAmount -= alloc
		}

		return nil
	})
}

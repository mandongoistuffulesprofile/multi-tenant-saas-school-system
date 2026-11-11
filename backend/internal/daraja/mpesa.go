package daraja

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

type C2BCallback struct {
	TransactionType   string `json:"TransactionType"`
	TransID           string `json:"TransID"`
	TransTime         string `json:"TransTime"`
	TransAmount       string `json:"TransAmount"`
	BusinessShortCode string `json:"BusinessShortCode"`
	BillRefNumber     string `json:"BillRefNumber"`
	MSISDN            string `json:"MSISDN"`
	FirstName         string `json:"FirstName"`
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

// ProcessCallback handles Daraja validation/confirmation by persisting to the
// durable mpesa_raw_inbox (idempotent on tenant+trans_id). Allocation and
// receipt creation are performed by the inbox worker, keeping callbacks fast
// and retry-safe.
func (s *MpesaService) ProcessCallback(ctx context.Context, tenantID uuid.UUID, body []byte) (map[string]interface{}, error) {
	var cb C2BCallback
	if err := json.Unmarshal(body, &cb); err != nil {
		return nil, fmt.Errorf("invalid json callback: %w", err)
	}
	if cb.TransID == "" {
		return nil, fmt.Errorf("missing TransID")
	}

	amountStr := strings.TrimSpace(cb.TransAmount)
	var amtCheck float64
	if _, err := fmt.Sscanf(amountStr, "%f", &amtCheck); err != nil || amtCheck <= 0 {
		return nil, fmt.Errorf("invalid amount")
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, "SELECT set_config('app.current_tenant_id', $1, true)", tenantID.String()); err != nil {
		return nil, err
	}

	_, err = tx.ExecContext(ctx, `
		INSERT INTO mpesa_raw_inbox
			(tenant_id, trans_id, sender_phone, sender_name, amount, account_reference, raw_payload)
		VALUES ($1, $2, $3, $4, $5::numeric, $6, $7)
		ON CONFLICT (tenant_id, trans_id) DO NOTHING`,
		tenantID.String(), cb.TransID, cb.MSISDN, cb.FirstName, amountStr, cb.BillRefNumber, body)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("inbox insert failed: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return map[string]interface{}{"ResultCode": 0, "ResultDesc": "Accepted"}, nil
}


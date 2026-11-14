// Package mpesa ingests Safaricom Daraja callbacks.
//
// The callback path is deliberately dumb: validate, resolve the tenant, write
// one row to mpesa_raw_inbox, return 200. Allocation to invoices happens in a
// worker. This keeps Safaricom's timeout budget (and its retries) away from
// business logic, and makes every callback replayable.
package mpesa

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
)

// C2BCallbackPayload is the Safaricom C2B confirmation body.
// TransAmount may be sent as a JSON number or string; accept both.
type C2BCallbackPayload struct {
	TransactionType   string          `json:"TransactionType"`
	TransID           string          `json:"TransID"`
	TransTime         string          `json:"TransTime"`
	TransAmount       json.RawMessage `json:"TransAmount"`
	BusinessShortCode string          `json:"BusinessShortCode"`
	BillRefNumber     string          `json:"BillRefNumber"`
	MSISDN            string          `json:"MSISDN"`
	FirstName         string          `json:"FirstName"`
}

func parseAmount(raw json.RawMessage) (string, error) {
	s := strings.TrimSpace(string(raw))
	s = strings.Trim(s, "\"")
	if s == "" || s == "null" {
		return "", fmt.Errorf("missing amount")
	}
	// Validate numeric format; keep as string for numeric(12,2) precision.
	var f float64
	if err := json.Unmarshal([]byte(s), &f); err != nil {
		return "", err
	}
	if f <= 0 {
		return "", fmt.Errorf("amount must be positive")
	}
	return s, nil
}

// queryer is the write surface for persisting a callback. It is satisfied by
// the request-scoped transaction when a tenant context exists on the request,
// and by the pooled DB otherwise (cross-tenant fallback).
type queryer interface {
	ExecContext(ctx context.Context, query string, args ...interface{}) (sql.Result, error)
}

type Service struct {
	database *db.DB
}

func NewService(database *db.DB) *Service {
	return &Service{database: database}
}

func (s *Service) insertRawInbox(ctx context.Context, q queryer, tenantID, amount string, payload C2BCallbackPayload) error {
	raw, _ := json.Marshal(payload)
	_, err := q.ExecContext(ctx, `
		INSERT INTO mpesa_raw_inbox
			(tenant_id, trans_id, sender_phone, sender_name, amount, account_reference, raw_payload)
		VALUES ($1, $2, $3, $4, $5, $6::numeric, $7)
		ON CONFLICT (tenant_id, trans_id) DO NOTHING`,
		tenantID, payload.TransID, payload.MSISDN, payload.FirstName,
		amount, payload.BillRefNumber, raw)
	return err
}

// HandleC2B is the public callback. It must never require a JWT: Safaricom
// cannot present one. A shared token (and optional IP allowlist) is the
// compensating control.
func (s *Service) HandleC2B(c *gin.Context) {
	if c.Request.Method != http.MethodPost {
		c.JSON(http.StatusMethodNotAllowed, gin.H{"ResultCode": 1, "ResultDesc": "Method not allowed"})
		return
	}

	if !s.authorised(c) {
		c.JSON(http.StatusUnauthorized, gin.H{"ResultCode": 1, "ResultDesc": "Unauthorized"})
		return
	}

	var payload C2BCallbackPayload
	if err := json.NewDecoder(http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20)).Decode(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ResultCode": 1, "ResultDesc": "Invalid payload"})
		return
	}
	amount, err := parseAmount(payload.TransAmount)
	if err != nil || payload.TransID == "" || payload.BusinessShortCode == "" {
		c.JSON(http.StatusBadRequest, gin.H{"ResultCode": 1, "ResultDesc": "Missing TransID, BusinessShortCode or amount"})
		return
	}

	ctx := c.Request.Context()

	// Prefer the request-scoped tenant transaction when a tenant context
	// exists on the request. Safaricom callbacks carry no JWT, so the normal
	// path falls through to the cross-tenant fallback below: resolve the
	// tenant from the shortcode and write in a dedicated tenant-scoped tx.
	if tx := middleware.TxFromGin(c); tx != nil && c.GetString(middleware.ContextTenantID) != "" {
		if err := s.insertRawInbox(ctx, tx, c.GetString(middleware.ContextTenantID), amount, payload); err != nil {
			// Do NOT acknowledge: a 5xx makes Safaricom retry.
			log.Printf("mpesa: persist failed for trans %s: %v", payload.TransID, err)
			c.JSON(http.StatusInternalServerError, gin.H{"ResultCode": 1, "ResultDesc": "Temporary failure"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ResultCode": 0, "ResultDesc": "Accepted"})
		return
	}

	// Cross-tenant fallback: no tenant context on the request, so resolve the
	// tenant from the shortcode and persist in its own tenant-scoped tx.
	tenantID, err := s.resolveTenant(ctx, payload.BusinessShortCode, payload.BillRefNumber)
	if err != nil {
		// Unknown shortcode: accept and park it for manual review rather than
		// making Safaricom retry forever.
		log.Printf("mpesa: unknown shortcode %s for trans %s: %v", payload.BusinessShortCode, payload.TransID, err)
		c.JSON(http.StatusOK, gin.H{"ResultCode": 0, "ResultDesc": "Accepted for review"})
		return
	}

	err = s.database.WithTenant(ctx, tenantID, "", func(tx *db.Tx) error {
		return s.insertRawInbox(ctx, tx, tenantID, amount, payload)
	})
	if err != nil {
		// Do NOT acknowledge: a 5xx makes Safaricom retry.
		log.Printf("mpesa: persist failed for trans %s: %v", payload.TransID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"ResultCode": 1, "ResultDesc": "Temporary failure"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"ResultCode": 0, "ResultDesc": "Accepted"})
}

// authorised requires at least one of MPESA_WEBHOOK_TOKEN or
// MPESA_ALLOWED_IPS to be configured. If neither is set, every callback is
// rejected: Daraja callbacks have no cryptographic signature, so an empty
// configuration must fail closed rather than silently accept fake callbacks.
func (s *Service) authorised(c *gin.Context) bool {
	want := strings.TrimSpace(os.Getenv("MPESA_WEBHOOK_TOKEN"))
	allow := strings.TrimSpace(os.Getenv("MPESA_ALLOWED_IPS"))

	if want == "" && allow == "" {
		return false
	}

	if want != "" {
		if c.GetHeader("X-Webhook-Token") != want {
			return false
		}
	}

	if allow != "" {
		client := c.ClientIP()
		for _, ip := range strings.Split(allow, ",") {
			if strings.TrimSpace(ip) == client {
				return true
			}
		}
		return false
	}

	return true
}

func (s *Service) resolveTenant(ctx context.Context, shortcode, billRefNumber string) (string, error) {
	// First try exact match on shortcode (for dedicated shortcodes per tenant)
	var tenantID string
	err := s.database.QueryRowContext(ctx,
		`SELECT tenant_id FROM school_payment_channels
		 WHERE shortcode_or_account = $1 AND status = 'ACTIVE'
		 LIMIT 1`, shortcode).Scan(&tenantID)
	if err == nil {
		return tenantID, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}

	// If no exact match or multiple tenants share the shortcode,
	// disambiguate using the BillRefNumber prefix.
	// Convention: BillRefNumber format is "<TENANT_PREFIX>-<REFERENCE>"
	// e.g., "MND-1042" where "MND" is the tenant prefix (subdomain).
	if billRefNumber != "" {
		// Extract prefix before first hyphen
		prefix := billRefNumber
		if idx := strings.Index(billRefNumber, "-"); idx > 0 {
			prefix = billRefNumber[:idx]
		}
		// Look up tenant by subdomain prefix
		err = s.database.QueryRowContext(ctx,
			`SELECT tenant_id FROM schools
			 WHERE status = 'ACTIVE' AND subdomain = $1
			 LIMIT 1`, strings.ToLower(prefix)).Scan(&tenantID)
		if err == nil {
			return tenantID, nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return "", err
		}
	}

	return "", fmt.Errorf("no active channel for shortcode %s (ref: %s)", shortcode, billRefNumber)
}

// ProcessInbox allocates pending callbacks. It is safe to run repeatedly and
// from more than one worker: rows are claimed with SKIP LOCKED.
func (s *Service) ensureHoldingTankRow(ctx context.Context, tenantTx *db.Tx, tenantID, transID, amount, accountRef string) {
	_, _ = tenantTx.ExecContext(ctx,
		`INSERT INTO mpesa_holding_tank
			(tenant_id, trans_id, sender_phone, sender_name, amount, reference, status, created_at)
		SELECT $1, $2, sender_phone, sender_name, $3::numeric, $4, 'UNALLOCATED', now()
		FROM mpesa_raw_inbox
		WHERE inbox_id = $2
		  AND processing_status = 'MANUAL_REVIEW'
		  AND NOT EXISTS (
		    SELECT 1 FROM mpesa_holding_tank
		     WHERE tenant_id = $1 AND trans_id = $2
		  )
		ON CONFLICT (tenant_id, trans_id) DO NOTHING`,
		tenantID, transID, amount, accountRef)
}

// ProcessInbox allocates pending callbacks. It is safe to run repeatedly and
// from more than one worker: rows are claimed with SKIP LOCKED.
func (s *Service) ProcessInbox(ctx context.Context, limit int) (int, error) {
	tx, err := s.database.BeginTxx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	// Cross-tenant read is explicit and confined to the worker transaction.
	if _, err := tx.ExecContext(ctx, "SET LOCAL app.worker = 'on'"); err != nil {
		return 0, err
	}

	rows, err := tx.QueryContext(ctx, `
		SELECT inbox_id, tenant_id, trans_id, amount::text, COALESCE(account_reference,'')
		FROM mpesa_raw_inbox
		WHERE processing_status = 'PENDING' AND next_attempt_at <= now()
		ORDER BY received_at
		LIMIT $1
		FOR UPDATE SKIP LOCKED`, limit)
	if err != nil {
		return 0, err
	}

	type item struct {
		id       string
		tenantID string
		transID  string
		amount   string
		ref      string
	}
	var items []item
	for rows.Next() {
		var it item
		if err := rows.Scan(&it.id, &it.tenantID, &it.transID, &it.amount, &it.ref); err != nil {
			rows.Close()
			return 0, err
		}
		items = append(items, it)
	}
	rows.Close()

	processed := 0
	for _, it := range items {
		// Each tenant's allocation runs in its own isolated transaction
		// to prevent cross-tenant context leakage within a single tx.
		err := s.database.WithTenant(ctx, it.tenantID, "", func(tenantTx *db.Tx) error {
			status, processErr := s.allocate(ctx, tenantTx.Tx, it.tenantID, it.transID, it.ref, it.amount)
			if processErr != nil {
				status = "FAILED"
				_, _ = tenantTx.ExecContext(ctx, `
					UPDATE mpesa_raw_inbox
					SET attempts = attempts + 1,
					    error_log = $1,
					    next_attempt_at = now() + (LEAST(3600, power(2, attempts)) || ' seconds')::interval,
					    processing_status = CASE WHEN attempts + 1 >= 10 THEN 'MANUAL_REVIEW' ELSE 'PENDING' END
					WHERE inbox_id = $2`, processErr.Error(), it.id)

				// When allocation cannot find a learner by the account reference,
				// move the uncredited payment into the bursar-visible holding tank
				// instead of leaving it hidden in mpesa_raw_inbox. This is the fix
				// for the "Bwawa la M-Pesa" scenario: the mother's KES 5,000 must
				// still appear on the holding-tank screen for manual allocation.
				s.ensureHoldingTankRow(ctx, tenantTx, it.tenantID, it.transID, it.amount, it.ref)

				log.Printf("mpesa: allocation failed for %s: %v", it.transID, processErr)
				return nil // don't fail the whole batch
			}

			_, _ = tenantTx.ExecContext(ctx, `
				UPDATE mpesa_raw_inbox
				SET processing_status = $1, processed_at = now(), error_log = NULL
				WHERE inbox_id = $2`, status, it.id)
			return nil
		})
		if err != nil {
			// Log error but continue processing other tenants
			log.Printf("mpesa: tenant tx failed for %s: %v", it.tenantID, err)
			continue
		}
		processed++
	}

	if err := tx.Commit(); err != nil {
		return processed, err
	}
	return processed, nil
}

func (s *Service) allocate(ctx context.Context, tx *sqlx.Tx, tenantID, transID, billRef, amount string) (string, error) {
	if billRef == "" {
		return "MANUAL_REVIEW", fmt.Errorf("no account reference")
	}

	var learnerID string
	err := tx.QueryRowContext(ctx,
		`SELECT learner_id FROM learners WHERE tenant_id = $1 AND upper(admission_number) = upper($2)`,
		tenantID, billRef).Scan(&learnerID)
	if errors.Is(err, sql.ErrNoRows) {
		return "MANUAL_REVIEW", fmt.Errorf("no learner with admission number %q", billRef)
	}
	if err != nil {
		return "", err
	}

	var paymentID string
	err = tx.QueryRowContext(ctx, `
		INSERT INTO payments
			(tenant_id, payment_reference, learner_id, source, amount, status, mpesa_trans_id, idempotency_key)
		VALUES ($1, $2, $3, 'MPESA', $4::numeric, 'COMPLETED', $5, $6)
		ON CONFLICT (tenant_id, mpesa_trans_id) WHERE mpesa_trans_id IS NOT NULL DO NOTHING
		RETURNING payment_id`,
		tenantID, "MPESA-"+transID, learnerID, amount, transID, tenantID+":"+transID).Scan(&paymentID)
	if errors.Is(err, sql.ErrNoRows) {
		return "PROCESSED", nil // already allocated; replay is a no-op
	}
	if err != nil {
		return "", err
	}

	rows, err := tx.QueryContext(ctx, `
		SELECT invoice_id
		FROM invoices
		WHERE tenant_id = $1 AND learner_id = $2 AND amount_outstanding > 0
		  AND status IN ('ISSUED','PARTIALLY_PAID','OVERDUE')
		ORDER BY due_date NULLS LAST, created_at
		FOR UPDATE`, tenantID, learnerID)
	if err != nil {
		return "", err
	}
	var invoiceIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return "", err
		}
		invoiceIDs = append(invoiceIDs, id)
	}
	rows.Close()

	for _, invoiceID := range invoiceIDs {
		var rem string
		if err := tx.QueryRowContext(ctx, `
			SELECT GREATEST($1::numeric - COALESCE(SUM(pa.allocated_amount),0), 0)::text
			FROM payment_allocations pa WHERE pa.tenant_id = $2 AND pa.payment_id = $3`,
			amount, tenantID, paymentID).Scan(&rem); err != nil {
			return "", err
		}
		if rem == "0" || rem == "0.00" || rem == "0.0" {
			break
		}
		var alloc string
		err := tx.QueryRowContext(ctx, `
			SELECT LEAST($1::numeric, amount_outstanding)::text
			FROM invoices WHERE invoice_id = $2 AND tenant_id = $3 FOR UPDATE`,
			rem, invoiceID, tenantID).Scan(&alloc)
		if err != nil {
			return "", err
		}
		if alloc == "0" || alloc == "0.00" || alloc == "0.0" {
			continue
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO payment_allocations (tenant_id, payment_id, invoice_id, allocated_amount)
			VALUES ($1, $2, $3, $4::numeric)
			ON CONFLICT (payment_id, invoice_id) DO NOTHING`,
			tenantID, paymentID, invoiceID, alloc); err != nil {
			return "", err
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE invoices
			SET amount_paid = amount_paid + $1::numeric,
			    amount_outstanding = amount_outstanding - $1::numeric,
			    status = CASE WHEN amount_outstanding - $1::numeric <= 0 THEN 'PAID' ELSE 'PARTIALLY_PAID' END,
			    paid_at = CASE WHEN amount_outstanding - $1::numeric <= 0 THEN COALESCE(paid_at, now()) ELSE paid_at END,
			    updated_at = now()
			WHERE invoice_id = $2 AND tenant_id = $3`,
			alloc, invoiceID, tenantID); err != nil {
			return "", err
		}
	}

	msg := fmt.Sprintf("Payment received: KES %s (Ref %s). Thank you.", amount, transID)
	idem := "mpesa-receipt:" + tenantID + ":" + transID
	_, _ = tx.ExecContext(ctx, `
		INSERT INTO outbound_messages (tenant_id, recipient_type, recipient_id, channel, recipient_address, body_text, status, idempotency_key)
		SELECT $1, 'GUARDIAN', g.guardian_id, 'SMS',
		       COALESCE(NULLIF(g.phone_number,''), NULLIF(u.phone_number,'')),
		       $2, 'QUEUED', $4
		  FROM learner_guardians lg
		  JOIN guardians g ON g.guardian_id = lg.guardian_id AND g.tenant_id = $1
		  LEFT JOIN users u ON u.user_id = g.user_id
		 WHERE lg.learner_id = $3
		   AND COALESCE(NULLIF(g.phone_number,''), NULLIF(u.phone_number,'')) IS NOT NULL
		   AND NOT EXISTS (
		     SELECT 1 FROM outbound_messages om
		      WHERE om.tenant_id = $1 AND om.channel = 'SMS'
		        AND (om.idempotency_key = $4 OR (om.body_text = $2 AND om.recipient_address = COALESCE(NULLIF(g.phone_number,''), NULLIF(u.phone_number,''))))
		   )
		 ORDER BY lg.is_primary_payer DESC NULLS LAST, lg.created_at
		 LIMIT 1
		ON CONFLICT (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
		tenantID, msg, learnerID, idem,
	)

	return "PROCESSED", nil
}

// StartWorker drains the inbox until ctx is cancelled.
func (s *Service) StartWorker(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if n, err := s.ProcessInbox(ctx, 50); err != nil {
				log.Printf("mpesa worker: %v", err)
			} else if n > 0 {
				log.Printf("mpesa worker: allocated %d payment(s)", n)
			}
		}
	}
}

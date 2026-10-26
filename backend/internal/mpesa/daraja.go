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
type C2BCallbackPayload struct {
	TransactionType   string  `json:"TransactionType"`
	TransID           string  `json:"TransID"`
	TransTime         string  `json:"TransTime"`
	TransAmount       float64 `json:"TransAmount,string"`
	BusinessShortCode string  `json:"BusinessShortCode"`
	BillRefNumber     string  `json:"BillRefNumber"`
	MSISDN            string  `json:"MSISDN"`
	FirstName         string  `json:"FirstName"`
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

func (s *Service) insertRawInbox(ctx context.Context, q queryer, tenantID string, payload C2BCallbackPayload) error {
	raw, _ := json.Marshal(payload)
	_, err := q.ExecContext(ctx, `
		INSERT INTO mpesa_raw_inbox
			(tenant_id, trans_id, sender_phone, sender_name, amount, account_reference, raw_payload)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (tenant_id, trans_id) DO NOTHING`,
		tenantID, payload.TransID, payload.MSISDN, payload.FirstName,
		payload.TransAmount, payload.BillRefNumber, raw)
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
	if payload.TransID == "" || payload.BusinessShortCode == "" || payload.TransAmount <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ResultCode": 1, "ResultDesc": "Missing TransID, BusinessShortCode or amount"})
		return
	}

	ctx := c.Request.Context()

	// Prefer the request-scoped tenant transaction when a tenant context
	// exists on the request. Safaricom callbacks carry no JWT, so the normal
	// path falls through to the cross-tenant fallback below: resolve the
	// tenant from the shortcode and write in a dedicated tenant-scoped tx.
	if tx := middleware.TxFromGin(c); tx != nil && c.GetString(middleware.ContextTenantID) != "" {
		if err := s.insertRawInbox(ctx, tx, c.GetString(middleware.ContextTenantID), payload); err != nil {
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
	tenantID, err := s.resolveTenant(ctx, payload.BusinessShortCode)
	if err != nil {
		// Unknown shortcode: accept and park it for manual review rather than
		// making Safaricom retry forever.
		log.Printf("mpesa: unknown shortcode %s for trans %s: %v", payload.BusinessShortCode, payload.TransID, err)
		c.JSON(http.StatusOK, gin.H{"ResultCode": 0, "ResultDesc": "Accepted for review"})
		return
	}

	err = s.database.WithTenant(ctx, tenantID, "", func(tx *db.Tx) error {
		return s.insertRawInbox(ctx, tx, tenantID, payload)
	})
	if err != nil {
		// Do NOT acknowledge: a 5xx makes Safaricom retry.
		log.Printf("mpesa: persist failed for trans %s: %v", payload.TransID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"ResultCode": 1, "ResultDesc": "Temporary failure"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"ResultCode": 0, "ResultDesc": "Accepted"})
}

func (s *Service) authorised(c *gin.Context) bool {
	if want := strings.TrimSpace(os.Getenv("MPESA_WEBHOOK_TOKEN")); want != "" {
		if c.GetHeader("X-Webhook-Token") != want {
			return false
		}
	}
	if allow := strings.TrimSpace(os.Getenv("MPESA_ALLOWED_IPS")); allow != "" {
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

func (s *Service) resolveTenant(ctx context.Context, shortcode string) (string, error) {
	var tenantID string
	err := s.database.QueryRowContext(ctx,
		`SELECT tenant_id FROM school_payment_channels
		 WHERE shortcode_or_account = $1 AND status = 'ACTIVE'
		 LIMIT 2`, shortcode).Scan(&tenantID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", fmt.Errorf("no active channel for shortcode %s", shortcode)
	}
	return tenantID, err
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
		SELECT inbox_id, tenant_id, trans_id, amount, COALESCE(account_reference,'')
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
		amount   float64
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
		if _, err := tx.ExecContext(ctx,
			"SELECT set_config('app.current_tenant_id', $1, true)", it.tenantID); err != nil {
			return processed, err
		}

		status, processErr := s.allocate(ctx, tx, it.tenantID, it.transID, it.ref, it.amount)
		if processErr != nil {
			status = "FAILED"
			_, _ = tx.ExecContext(ctx, `
				UPDATE mpesa_raw_inbox
				SET attempts = attempts + 1,
				    error_log = $1,
				    next_attempt_at = now() + (LEAST(3600, power(2, attempts)) || ' seconds')::interval,
				    processing_status = CASE WHEN attempts + 1 >= 10 THEN 'MANUAL_REVIEW' ELSE 'PENDING' END
				WHERE inbox_id = $2`, processErr.Error(), it.id)
			log.Printf("mpesa: allocation failed for %s: %v", it.transID, processErr)
			continue
		}

		_, _ = tx.ExecContext(ctx, `
			UPDATE mpesa_raw_inbox
			SET processing_status = $1, processed_at = now(), error_log = NULL
			WHERE inbox_id = $2`, status, it.id)
		processed++
	}

	if err := tx.Commit(); err != nil {
		return processed, err
	}
	return processed, nil
}

func (s *Service) allocate(ctx context.Context, tx *sqlx.Tx, tenantID, transID, billRef string, amount float64) (string, error) {
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
		VALUES ($1, $2, $3, 'MPESA', $4, 'COMPLETED', $5, $6)
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
		SELECT invoice_id, amount_outstanding
		FROM invoices
		WHERE tenant_id = $1 AND learner_id = $2 AND amount_outstanding > 0
		  AND status IN ('ISSUED','PARTIALLY_PAID','OVERDUE')
		ORDER BY due_date NULLS LAST, created_at`, tenantID, learnerID)
	if err != nil {
		return "", err
	}
	type openInvoice struct {
		id      string
		balance float64
	}
	var invoices []openInvoice
	for rows.Next() {
		var inv openInvoice
		if err := rows.Scan(&inv.id, &inv.balance); err != nil {
			rows.Close()
			return "", err
		}
		invoices = append(invoices, inv)
	}
	rows.Close()

	remaining := amount
	for _, inv := range invoices {
		if remaining <= 0 {
			break
		}
		alloc := remaining
		if alloc > inv.balance {
			alloc = inv.balance
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO payment_allocations (tenant_id, payment_id, invoice_id, allocated_amount)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (payment_id, invoice_id) DO NOTHING`,
			tenantID, paymentID, inv.id, alloc); err != nil {
			return "", err
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE invoices
			SET amount_paid = amount_paid + $1,
			    amount_outstanding = GREATEST(amount_outstanding - $1, 0),
			    status = CASE WHEN amount_outstanding - $1 <= 0 THEN 'PAID' ELSE 'PARTIALLY_PAID' END,
			    paid_at = CASE WHEN amount_outstanding - $1 <= 0 THEN now() ELSE paid_at END,
			    updated_at = now()
			WHERE invoice_id = $2 AND tenant_id = $3`,
			alloc, inv.id, tenantID); err != nil {
			return "", err
		}
		remaining -= alloc
	}

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

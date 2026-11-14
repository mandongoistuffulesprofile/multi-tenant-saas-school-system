package finance

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/money"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/validation"
)

// MPESAEvent is one C2B receipt from the durable inbox. The inbox is written by
// the Safaricom callback before any allocation, so this is the authoritative
// list of money that reached the school but may not yet be on a learner.
type MPESAEvent struct {
	EventID      string  `json:"event_id"`
	TransID      string  `json:"trans_id"`
	TransTime    string  `json:"trans_time"`
	Amount       float64 `json:"amount"`
	BillRef      string  `json:"bill_ref,omitempty"`
	MSISDNMasked string  `json:"msisdn_masked,omitempty"`
	Status       string  `json:"status"`
	Error        string  `json:"error,omitempty"`
}

// MPESAEventStats powers the ledger header without a second round trip.
type MPESAEventStats struct {
	Total       int `json:"total"`
	Allocated   int `json:"allocated"`
	Suspense    int `json:"suspense"`
	Failed      int `json:"failed"`
	SyncPercent int `json:"sync_percent"`
}

func maskMSISDN(phone string) string {
	clean := strings.TrimSpace(phone)
	if len(clean) <= 3 {
		return clean
	}
	return strings.Repeat("*", len(clean)-3) + clean[len(clean)-3:]
}

func mpesaEventStatus(raw string) string {
	switch raw {
	case "PROCESSED":
		return "ALLOCATED"
	case "FAILED":
		return "FAILED"
	default:
		return "SUSPENSE"
	}
}

// ListMPESAEvents returns the tenant's inbox newest-first plus sync counters.
func (s *Service) ListMPESAEvents(ctx context.Context, tenantID string) ([]MPESAEvent, MPESAEventStats, error) {
	q := middleware.TxFromContext(ctx)
	stats := MPESAEventStats{}
	events := make([]MPESAEvent, 0)

	rows, err := q.Query(
		`SELECT inbox_id, trans_id, received_at::text, amount::float8,
		        COALESCE(account_reference, ''), sender_phone, processing_status,
		        COALESCE(error_log, '')
		   FROM mpesa_raw_inbox
		  WHERE tenant_id = $1
		  ORDER BY received_at DESC
		  LIMIT 500`,
		tenantID,
	)
	if err != nil {
		return nil, stats, err
	}
	defer rows.Close()

	for rows.Next() {
		var e MPESAEvent
		var phone, rawStatus string
		if err := rows.Scan(&e.EventID, &e.TransID, &e.TransTime, &e.Amount,
			&e.BillRef, &phone, &rawStatus, &e.Error); err != nil {
			return nil, stats, err
		}
		e.MSISDNMasked = maskMSISDN(phone)
		e.Status = mpesaEventStatus(rawStatus)
		stats.Total++
		switch e.Status {
		case "ALLOCATED":
			stats.Allocated++
		case "FAILED":
			stats.Failed++
		default:
			stats.Suspense++
		}
		events = append(events, e)
	}
	if err := rows.Err(); err != nil {
		return nil, stats, err
	}
	if stats.Total > 0 {
		stats.SyncPercent = (stats.Allocated * 100) / stats.Total
	}
	return events, stats, nil
}

func (h *Handler) ListMPESAEvents(c *gin.Context) {
	events, stats, err := h.service.ListMPESAEvents(c.Request.Context(), c.GetString("tenant_id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"events": events, "stats": stats})
}

// ResolveMPESAEvent posts one inbox receipt to a learner and allocates it to
// their oldest unpaid invoice. The inbox's unique trans_id and the payments
// (tenant_id, mpesa_trans_id) index make retries idempotent.
func (s *Service) ResolveMPESAEvent(ctx context.Context, tenantID, eventID, learnerID, userID string) (gin.H, error) {
	q := middleware.TxFromContext(ctx)
	if q == nil {
		return nil, errors.New("no tenant transaction")
	}

	var transID, amountStr, status, accountRef string
	err := q.QueryRow(
		`SELECT trans_id, amount::text, processing_status, COALESCE(account_reference, '')
		   FROM mpesa_raw_inbox
		  WHERE inbox_id = $1 AND tenant_id = $2
		  FOR UPDATE`,
		eventID, tenantID,
	).Scan(&transID, &amountStr, &status, &accountRef)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, sql.ErrNoRows
	}
	if err != nil {
		return nil, err
	}
	if status != "PENDING" && status != "MANUAL_REVIEW" && status != "FAILED" && status != "PROCESSED" {
		return nil, errors.New("event is not reconcilable")
	}

	var learnerExists bool
	if err := q.QueryRow(
		`SELECT EXISTS(SELECT 1 FROM learners WHERE learner_id = $1 AND tenant_id = $2 AND status = 'ACTIVE')`,
		learnerID, tenantID,
	).Scan(&learnerExists); err != nil {
		return nil, err
	}
	if !learnerExists {
		return nil, errors.New("learner not found for this school")
	}

	amount := money.New(amountStr)
	if !amount.IsPositive() {
		return nil, errors.New("receipt amount is not positive")
	}

	reference := "MPESA-" + transID
	var paymentID string
	err = q.QueryRow(
		`INSERT INTO payments (tenant_id, payment_reference, learner_id, source, amount,
			currency, status, mpesa_trans_id, recorded_by, idempotency_key)
		 VALUES ($1, $2, $3, 'MPESA', $4::numeric, 'KES', 'COMPLETED', $5, $6, $7)
		 ON CONFLICT (tenant_id, mpesa_trans_id) WHERE mpesa_trans_id IS NOT NULL DO NOTHING
		 RETURNING payment_id`,
		tenantID, reference, learnerID, amount.StringFixed(2), transID,
		nullableString(userID), tenantID+":mpesa:"+transID,
	).Scan(&paymentID)
	if errors.Is(err, sql.ErrNoRows) {
		// Already posted (duplicate delivery or a retried resolve).
		if err := q.QueryRow(
			`SELECT payment_id FROM payments WHERE tenant_id = $1 AND mpesa_trans_id = $2`,
			tenantID, transID,
		).Scan(&paymentID); err != nil {
			return nil, err
		}
		_, _ = q.Exec(
			`UPDATE mpesa_raw_inbox SET processing_status = 'PROCESSED',
			        processed_at = COALESCE(processed_at, now()), error_log = NULL
			  WHERE inbox_id = $1 AND tenant_id = $2`,
			eventID, tenantID,
		)
		return gin.H{"payment_id": paymentID, "already_reconciled": true}, nil
	}
	if err != nil {
		return nil, err
	}

	// One planner for every receipt path: oldest term first, votehead hint from
	// the account reference, and anything beyond the debt parked as credit.
	_, voteheadHint := ResolveReferenceHint(ctx, q, tenantID, accountRef)
	outcome, allocErr := ApplyReceipt(ctx, q, ReceiptApplication{
		TenantID:     tenantID,
		UserID:       userID,
		PaymentID:    paymentID,
		LearnerID:    learnerID,
		Amount:       amount,
		HintVotehead: voteheadHint,
		Rule:         AllocationPriority,
		Reference:    reference,
	})
	if allocErr != nil {
		return nil, allocErr
	}

	if _, err := q.Exec(
		`UPDATE mpesa_raw_inbox SET processing_status = 'PROCESSED',
		        processed_at = now(), attempts = attempts + 1, error_log = NULL
		  WHERE inbox_id = $1 AND tenant_id = $2`,
		eventID, tenantID,
	); err != nil {
		return nil, err
	}

	firstInvoice := ""
	if len(outcome.InvoiceIDs) > 0 {
		firstInvoice = outcome.InvoiceIDs[0]
	}
	return gin.H{
		"payment_id":       paymentID,
		"invoice_id":       firstInvoice,
		"invoice_ids":      outcome.InvoiceIDs,
		"allocated_amount": outcome.Allocated.InexactFloat64(),
		"prepayment":       outcome.Prepayment.InexactFloat64(),
	}, nil
}

func (h *Handler) ResolveMPESAEvent(c *gin.Context) {
	var req struct {
		LearnerID string `json:"learner_id" binding:"required"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	result, err := h.service.ResolveMPESAEvent(
		c.Request.Context(), c.GetString("tenant_id"), c.Param("id"),
		req.LearnerID, c.GetString("user_id"),
	)
	if errors.Is(err, sql.ErrNoRows) {
		c.JSON(http.StatusNotFound, gin.H{"code": "NOT_FOUND", "message": "M-Pesa event not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "RECONCILE_FAILED", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, result)
}

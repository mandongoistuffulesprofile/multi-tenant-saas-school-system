package holdingtank

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
)

type queryer interface {
	Query(string, ...interface{}) (*sql.Rows, error)
	QueryContext(context.Context, string, ...interface{}) (*sql.Rows, error)
	QueryRow(string, ...interface{}) *sql.Row
	Exec(string, ...interface{}) (sql.Result, error)
}

type Service struct {
	database *db.DB
}

func NewService(database *db.DB) *Service { return &Service{database: database} }

func (s *Service) q(ctx context.Context) queryer {
	if tx := middleware.TxFromContext(ctx); tx != nil {
		return tx
	}
	return s.database
}

type HoldingEntry struct {
	ID          string     `json:"id"`
	TenantID    string     `json:"tenant_id"`
	MSISDN      string     `json:"msisdn"`
	Amount      float64    `json:"amount"`
	Reference   string     `json:"reference"`
	Status      string     `json:"status"`
	AllocatedTo *string    `json:"allocated_to,omitempty"`
	AllocatedAt *time.Time `json:"allocated_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`

	// Inbox context used only for candidate scoring; never serialised.
	ReceiverName     string `json:"-"`
	ReceiverPhone    string `json:"-"`
	AccountReference string `json:"-"`
}

func (s *Service) List(ctx context.Context, tenantID, status string, limit, offset int) ([]HoldingEntry, error) {
	q := s.q(ctx)
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	query := `SELECT id, tenant_id, msisdn, amount, reference, status, allocated_to, allocated_at, created_at
			  FROM mpesa_holding_tank WHERE tenant_id=$1`
	args := []interface{}{tenantID}
	if status != "" {
		query += ` AND status=$2 ORDER BY created_at DESC LIMIT $3 OFFSET $4`
		args = append(args, status, limit, offset)
	} else {
		query += ` ORDER BY created_at DESC LIMIT $2 OFFSET $3`
		args = append(args, limit, offset)
	}
	rows, err := q.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var entries []HoldingEntry
	for rows.Next() {
		var e HoldingEntry
		if err := rows.Scan(&e.ID, &e.TenantID, &e.MSISDN, &e.Amount, &e.Reference, &e.Status, &e.AllocatedTo, &e.AllocatedAt, &e.CreatedAt); err != nil {
			return nil, err
		}
		entries = append(entries, e)
	}
	return entries, rows.Err()
}

func (s *Service) Resolve(ctx context.Context, tenantID, userID, entryID, studentID string) error {
	q := s.q(ctx)

	// The entry must exist and still be unallocated; capture its amount and
	// bill reference for the payment record.
	var amount float64
	var reference string
	err := q.QueryRow(
		`SELECT amount, reference FROM mpesa_holding_tank
		 WHERE tenant_id=$1 AND id=$2 AND status='UNALLOCATED'`,
		tenantID, entryID,
	).Scan(&amount, &reference)
	if err == sql.ErrNoRows {
		return errors.New("entry not found or already allocated")
	}
	if err != nil {
		return err
	}

	if _, err := q.Exec(
		`UPDATE mpesa_holding_tank SET status='ALLOCATED', allocated_to=$1, allocated_at=NOW() WHERE tenant_id=$2 AND id=$3 AND status='UNALLOCATED'`,
		studentID, tenantID, entryID,
	); err != nil {
		return err
	}

	// Post the deposit as a COMPLETED M-Pesa payment so the collected money
	// reaches the learner's account instead of stopping at a flag flip.
	// The bill reference (M-Pesa trans id / paybill reference when captured
	// by the inbox worker) is reused for traceability, prefixed TANK- when
	// the deposit came in without a reference.
	paymentRef := strings.TrimSpace(reference)
	if paymentRef == "" {
		paymentRef = "TANK-" + entryID
	}
	var paymentID string
	if err := q.QueryRow(
		`INSERT INTO payments (tenant_id, payment_reference, learner_id, source, amount, currency, status, mpesa_trans_id, received_at, recorded_by)
		 VALUES ($1, $2, $3, 'MPESA', $4, 'KES', 'COMPLETED', $2, NOW(), NULLIF($5, ''))
		 RETURNING payment_id`,
		tenantID, "TANK-"+paymentRef, studentID, amount, userID,
	).Scan(&paymentID); err != nil {
		return err
	}

	// Auto-allocate to the learner's oldest outstanding invoice(s).
	for {
		var invoiceID string
		var outstanding float64
		row := q.QueryRow(
			`SELECT invoice_id, amount_outstanding FROM invoices
			 WHERE tenant_id=$1 AND learner_id=$2 AND amount_outstanding > 0 AND status <> 'VOID'
			 ORDER BY due_date NULLS LAST, created_at ASC LIMIT 1`,
			tenantID, studentID,
		)
		if err := row.Err(); err != nil {
			break
		}
		if err := row.Scan(&invoiceID, &outstanding); err != nil {
			break // no more outstanding invoices
		}
		applied := amount
		if applied <= 0 {
			break
		}
		if _, err := q.Exec(
			`INSERT INTO payment_allocations (tenant_id, payment_id, invoice_id, allocated_amount)
			 VALUES ($1, $2, $3, $4)`,
			tenantID, paymentID, invoiceID, applied,
		); err != nil {
			return err
		}
		if _, err := q.Exec(
			`UPDATE invoices SET
				amount_paid = amount_paid + $1,
				amount_outstanding = amount_outstanding - $1,
				status = CASE WHEN amount_outstanding - $1 <= 0 THEN 'PAID' ELSE 'PARTIALLY_PAID' END,
				updated_at = CURRENT_TIMESTAMP
			 WHERE invoice_id = $2 AND tenant_id = $3`,
			applied, invoiceID, tenantID,
		); err != nil {
			return err
		}
		amount -= applied
		if amount <= 0 {
			break
		}
	}

	return nil
}

type Token struct {
	ID           string     `json:"id"`
	Token        string     `json:"token"`
	TenantID     string     `json:"tenant_id"`
	ClassID      string     `json:"class_id"`
	SubjectScope []string   `json:"subject_scope"`
	ExpiresAt    time.Time  `json:"expires_at"`
	RevokedAt    *time.Time `json:"revoked_at,omitempty"`
	CreatedBy    string     `json:"created_by"`
	CreatedAt    time.Time  `json:"created_at"`
}

func (s *Service) CreateToken(ctx context.Context, tenantID, userID, classID string, subjects []string, expiresAt time.Time, pin string) (*Token, error) {
	q := s.q(ctx)
	var t Token
	err := q.QueryRow(`INSERT INTO delegated_entry_tokens (tenant_id, class_id, subject_scope, expires_at, created_by, delegate_pin)
					   VALUES ($1,$2,$3,$4,$5,$6)
					   RETURNING id, token, tenant_id, class_id, subject_scope, expires_at, revoked_at, created_by, created_at`,
		tenantID, classID, subjects, expiresAt, nullIfEmpty(userID), pin).Scan(&t.ID, &t.Token, &t.TenantID, &t.ClassID, &t.SubjectScope, &t.ExpiresAt, &t.RevokedAt, &t.CreatedBy, &t.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func (s *Service) ValidateToken(ctx context.Context, tenantID, pin, classID string) (*Token, error) {
	q := s.q(ctx)
	var t Token
	err := q.QueryRow(`SELECT id, token, tenant_id, class_id, subject_scope, expires_at, revoked_at, created_by, created_at
					   FROM delegated_entry_tokens WHERE tenant_id=$1 AND delegate_pin=$2 AND class_id=$3 AND revoked_at IS NULL AND expires_at > NOW()`,
		tenantID, pin, classID).Scan(&t.ID, &t.Token, &t.TenantID, &t.ClassID, &t.SubjectScope, &t.ExpiresAt, &t.RevokedAt, &t.CreatedBy, &t.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func (s *Service) RevokeToken(ctx context.Context, tenantID, tokenID string) error {
	q := s.q(ctx)
	_, err := q.Exec(`UPDATE delegated_entry_tokens SET revoked_at=NOW() WHERE tenant_id=$1 AND id=$2`, tenantID, tokenID)
	return err
}

func (s *Service) ListTokens(ctx context.Context, tenantID string) ([]Token, error) {
	q := s.q(ctx)
	rows, err := q.Query(`SELECT id, token, tenant_id, class_id, subject_scope, expires_at, revoked_at, created_by, created_at
						  FROM delegated_entry_tokens WHERE tenant_id=$1 ORDER BY created_at DESC`, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var toks []Token
	for rows.Next() {
		var t Token
		if err := rows.Scan(&t.ID, &t.Token, &t.TenantID, &t.ClassID, &t.SubjectScope, &t.ExpiresAt, &t.RevokedAt, &t.CreatedBy, &t.CreatedAt); err != nil {
			return nil, err
		}
		toks = append(toks, t)
	}
	return toks, rows.Err()
}

func nullIfEmpty(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

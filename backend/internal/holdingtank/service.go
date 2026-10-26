package holdingtank

import (
	"context"
	"database/sql"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
)

type Service struct {
	db *db.DB
}

func NewService(db *db.DB) *Service { return &Service{db: db} }

func (s *Service) q(ctx context.Context) interface {
	QueryRowContext(context.Context, string, ...interface{}) *sql.Row
	QueryContext(context.Context, string, ...interface{}) (*sql.Rows, error)
	ExecContext(context.Context, string, ...interface{}) (sql.Result, error)
} {
	if tx, ok := ctx.Value("tx").(*sql.Tx); ok {
		return tx
	}
	return s.db.DB
}

type HoldingTankEntry struct {
	ID             string     `json:"id"`
	TenantID       string     `json:"tenant_id"`
	TransactionCode string    `json:"transaction_code"`
	Amount         float64    `json:"amount"`
	SenderPhone    string     `json:"sender_phone"`
	SenderName     string     `json:"sender_name"`
	Status         string     `json:"status"`
	ResolvedStudentID *string `json:"resolved_student_id,omitempty"`
	ResolvedBy     *string    `json:"resolved_by,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
}

func (s *Service) List(ctx context.Context, tenantID, status string, limit, offset int) ([]HoldingTankEntry, error) {
	q := s.q(ctx)
	query := `SELECT id, tenant_id, transaction_code, amount, sender_phone, COALESCE(sender_name,''), status, resolved_student_id, resolved_by, created_at
		FROM mpesa_holding_tank WHERE tenant_id = $1`
	args := []interface{}{tenantID}
	if status != "" {
		query += " AND status = $2"
		args = append(args, status)
	}
	query += " ORDER BY created_at DESC LIMIT $3 OFFSET $4"
	args = append(args, limit, offset)

	rows, err := q.QueryContext(ctx, query, args...)
	if err != nil { return nil, err }
	defer rows.Close()
	var out []HoldingTankEntry
	for rows.Next() {
		var e HoldingTankEntry
		var resolvedStudent, resolvedBy sql.NullString
		if err := rows.Scan(&e.ID, &e.TenantID, &e.TransactionCode, &e.Amount, &e.SenderPhone, &e.SenderName, &e.Status, &resolvedStudent, &resolvedBy, &e.CreatedAt); err != nil {
			return nil, err
		}
		if resolvedStudent.Valid { e.ResolvedStudentID = &resolvedStudent.String }
		if resolvedBy.Valid { e.ResolvedBy = &resolvedBy.String }
		out = append(out, e)
	}
	return out, nil
}

func (s *Service) Resolve(ctx context.Context, tenantID, userID, entryID, studentID string) error {
	q := s.q(ctx)
	_, err := q.ExecContext(ctx,
		`UPDATE mpesa_holding_tank SET status='RESOLVED', resolved_student_id=$1, resolved_by=$2 WHERE tenant_id=$3 AND id=$4`,
		studentID, userID, tenantID, entryID)
	return err
}

func (s *Service) InsertUnmatched(ctx context.Context, tenantID, code, phone, name string, amount float64, payload json.RawMessage) (string, error) {
	q := s.q(ctx)
	id := uuid.New().String()
	_, err := q.ExecContext(ctx,
		`INSERT INTO mpesa_holding_tank (id, tenant_id, transaction_code, amount, sender_phone, sender_name, raw_webhook_payload)
		 VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		id, tenantID, code, amount, phone, name, payload)
	if err != nil { return "", err }
	return id, nil
}

// Delegated entry tokens
type DelegatedToken struct {
	ID           string     `json:"id"`
	TenantID     string     `json:"tenant_id"`
	CreatedBy    string     `json:"created_by_user_id"`
	DelegatePIN  string     `json:"delegate_pin"`
	ClassID      string     `json:"class_id"`
	SubjectScope []string   `json:"subject_scope"`
	ExpiresAt    time.Time  `json:"expires_at"`
	IsActive     bool       `json:"is_active"`
	CreatedAt    time.Time  `json:"created_at"`
}

func (s *Service) CreateToken(ctx context.Context, tenantID, userID, classID string, subjects []string, expiresAt time.Time, pin string) (*DelegatedToken, error) {
	q := s.q(ctx)
	id := uuid.New().String()
	_, err := q.ExecContext(ctx,
		`INSERT INTO delegated_entry_tokens (id, tenant_id, created_by_user_id, delegate_pin, class_id, subject_scope, expires_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		id, tenantID, userID, pin, classID, subjects, expiresAt)
	if err != nil { return nil, err }
	return &DelegatedToken{ID: id, TenantID: tenantID, CreatedBy: userID, DelegatePIN: pin, ClassID: classID, SubjectScope: subjects, ExpiresAt: expiresAt, IsActive: true, CreatedAt: time.Now()}, nil
}

func (s *Service) ValidateToken(ctx context.Context, tenantID, pin, classID string) (*DelegatedToken, error) {
	q := s.q(ctx)
	var t DelegatedToken
	var subjects []string
	err := q.QueryRowContext(ctx,
		`SELECT id, tenant_id, created_by_user_id, delegate_pin, class_id, subject_scope, expires_at, is_active, created_at
		 FROM delegated_entry_tokens WHERE tenant_id=$1 AND delegate_pin=$2 AND class_id=$3 AND is_active=true`,
		tenantID, pin, classID).Scan(&t.ID, &t.TenantID, &t.CreatedBy, &t.DelegatePIN, &t.ClassID, &subjects, &t.ExpiresAt, &t.IsActive, &t.CreatedAt)
	if err != nil { return nil, err }
	if time.Now().After(t.ExpiresAt) { return nil, errors.New("token expired") }
	t.SubjectScope = subjects
	return &t, nil
}

func (s *Service) RevokeToken(ctx context.Context, tenantID, tokenID string) error {
	q := s.q(ctx)
	_, err := q.ExecContext(ctx,
		`UPDATE delegated_entry_tokens SET is_active=false WHERE tenant_id=$1 AND id=$2`, tenantID, tokenID)
	return err
}

func (s *Service) ListTokens(ctx context.Context, tenantID string) ([]DelegatedToken, error) {
	q := s.q(ctx)
	rows, err := q.QueryContext(ctx,
		`SELECT id, tenant_id, created_by_user_id, delegate_pin, class_id, subject_scope, expires_at, is_active, created_at
		 FROM delegated_entry_tokens WHERE tenant_id=$1 ORDER BY created_at DESC`, tenantID)
	if err != nil { return nil, err }
	defer rows.Close()
	var out []DelegatedToken
	for rows.Next() {
		var t DelegatedToken
		var subjects []string
		if err := rows.Scan(&t.ID, &t.TenantID, &t.CreatedBy, &t.DelegatePIN, &t.ClassID, &subjects, &t.ExpiresAt, &t.IsActive, &t.CreatedAt); err != nil {
			return nil, err
		}
		t.SubjectScope = subjects
		out = append(out, t)
	}
	return out, nil
}

var _ = json.Marshal

package audit

import (
	"context"
	"fmt"
	"time"

	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
)

// Service writes tenant-scoped audit events to audit_events. Writes are
// best-effort: a failed audit insert is logged but never fails the business
// transaction. Use PublishWithTx when the audit row must be atomic with the
// change it describes.
type Service struct {
	db *db.DB
}

func NewService(database *db.DB) *Service {
	return &Service{db: database}
}

type Event struct {
	TenantID  string
	UserID    string
	Action    string
	TableName string
	RecordID  string
	OldValues map[string]any
	NewValues map[string]any
	IPAddress string
	RequestID string
}

func (s *Service) Log(ctx context.Context, event Event) {
	if event.TenantID == "" {
		return
	}
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO audit_events
		    (tenant_id, user_id, action, table_name, record_id, old_values, new_values, ip_address, request_id)
		VALUES ($1, NULLIF($2, '')::uuid, $3, $4, NULLIF($5, '')::uuid, $6, $7, NULLIF($8, '')::inet, $9)`,
		event.TenantID, event.UserID, event.Action, event.TableName, event.RecordID,
		event.OldValues, event.NewValues, event.IPAddress, event.RequestID,
	); err != nil {
		// Do not log the values: they may contain PII.
		fmt.Printf("audit write failed: %v\n", err)
	}
}

type Row struct {
	AuditID   string    `json:"audit_id"`
	UserID    string    `json:"user_id,omitempty"`
	Action    string    `json:"action"`
	TableName string    `json:"table_name"`
	RecordID  string    `json:"record_id,omitempty"`
	RequestID string    `json:"request_id,omitempty"`
	IPAddress string    `json:"ip_address,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

func (s *Service) ListRecent(ctx context.Context, tenantID string, limit int) ([]Row, error) {
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT audit_id::text, COALESCE(user_id::text, ''), action, table_name,
		       COALESCE(record_id::text, ''), COALESCE(request_id, ''),
		       COALESCE(host(ip_address), ''), created_at
		FROM audit_events
		WHERE tenant_id = $1
		ORDER BY created_at DESC
		LIMIT $2`, tenantID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]Row, 0)
	for rows.Next() {
		var row Row
		if err := rows.Scan(&row.AuditID, &row.UserID, &row.Action, &row.TableName,
			&row.RecordID, &row.RequestID, &row.IPAddress, &row.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

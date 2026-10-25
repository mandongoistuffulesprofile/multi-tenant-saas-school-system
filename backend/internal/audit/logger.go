package audit

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
)

type AuditLogger struct {
	db *sql.DB
}

func NewAuditLogger(db *sql.DB) *AuditLogger {
	return &AuditLogger{db: db}
}

// Log records an immutable audit entry within the current tenant boundary
func (a *AuditLogger) Log(ctx context.Context, tenantID uuid.UUID, userID *uuid.UUID, action, resType, resID, ip string, details map[string]interface{}) error {
	detailJSON, err := json.Marshal(details)
	if err != nil {
		detailJSON = []byte("{}")
	}

	query := `
		INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, ip_address, details)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`
	_, err = a.db.ExecContext(ctx, query, tenantID, userID, action, resType, resID, ip, detailJSON)
	if err != nil {
		return fmt.Errorf("audit log insert failed: %w", err)
	}
	return nil
}

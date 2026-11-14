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

	// audit_log is the live table (audit_logs never existed). It records the
	// actor, event and metadata; tenant and resource travel in the metadata
	// because the table itself has no columns for them.
	var envelope map[string]interface{}
	if err := json.Unmarshal(detailJSON, &envelope); err != nil || envelope == nil {
		envelope = map[string]interface{}{}
	}
	envelope["tenant_id"] = tenantID
	envelope["resource_type"] = resType
	envelope["resource_id"] = resID
	detailJSON, err = json.Marshal(envelope)
	if err != nil {
		detailJSON = []byte("{}")
	}

	query := `
		INSERT INTO audit_log (user_id, event, ip, metadata)
		VALUES ($1, $2, NULLIF($3, '')::inet, $4)
	`
	_, err = a.db.ExecContext(ctx, query, userID, action, ip, detailJSON)
	if err != nil {
		return fmt.Errorf("audit log insert failed: %w", err)
	}
	return nil
}

package audit

import (
	"encoding/json"
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
)

// TenantAction records a tenant-scoped audit event inside the request
// transaction, attributed to the signed-in user.
//
// It writes the canonical audit_events columns (user_id, table_name,
// record_id, new_values, ip_address, request_id) that the tenant audit log and
// the platform console read, so a school administrator and a platform operator
// see the same event.
//
// Writes are best-effort: the business change has already succeeded, so an
// audit failure is reported to stderr instead of failing the response. Values
// are not printed on failure because they may contain PII.
func TenantAction(tx *sqlx.Tx, c *gin.Context, action, tableName, recordID string, details map[string]any) {
	if tx == nil || c == nil {
		return
	}
	if details == nil {
		details = map[string]any{}
	}
	payload, err := json.Marshal(details)
	if err != nil {
		payload = []byte("{}")
	}
	if _, err := tx.Exec(
		`INSERT INTO audit_events
		    (tenant_id, user_id, action, table_name, record_id, new_values, ip_address, request_id)
		 VALUES ($1, NULLIF($2, '')::uuid, $3, $4, NULLIF($5, '')::uuid, $6::jsonb,
		         NULLIF($7, '')::inet, NULLIF($8, ''))`,
		c.GetString("tenant_id"), c.GetString("user_id"), action, tableName, recordID,
		string(payload), c.ClientIP(), c.GetString("request_id"),
	); err != nil {
		fmt.Printf("audit write failed (%s): %v\n", action, err)
	}
}

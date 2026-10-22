package audit

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

// GetAuditLog returns recent audit events for the authenticated tenant.
// Route: GET /audit/logs
func (h *Handler) GetAuditLog(c *gin.Context) {
	limit := 100

	rows, err := h.service.db.Query(
		`SELECT id, user_id, event, ip, user_agent, request_id, created_at
	       FROM audit_log ORDER BY created_at DESC LIMIT $1`,
		limit,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Failed to load audit log"})
		return
	}
	defer rows.Close()

	type AuditRow struct {
		ID        string `json:"id"`
		UserID    string `json:"user_id,omitempty"`
		Event     string `json:"event"`
		IP        string `json:"ip,omitempty"`
		UserAgent string `json:"user_agent,omitempty"`
		RequestID string `json:"request_id,omitempty"`
		CreatedAt string `json:"created_at"`
	}

	var logs []AuditRow
	for rows.Next() {
		var row AuditRow
		if err := rows.Scan(&row.ID, &row.UserID, &row.Event, &row.IP, &row.UserAgent, &row.RequestID, &row.CreatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Failed to scan audit log"})
			return
		}
		logs = append(logs, row)
	}
	if logs == nil {
		logs = []AuditRow{}
	}

	c.JSON(http.StatusOK, gin.H{"audit_log": logs})
}

var _ = http.StatusOK
package audit

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
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
	tenantID := c.GetString(middleware.ContextTenantID)
	if tenantID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": "TENANT_REQUIRED", "message": "Tenant context is required"})
		return
	}

	limit := 100
	if raw := c.Query("limit"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 && parsed <= 100 {
			limit = parsed
		}
	}

	logs, err := h.service.ListRecent(c.Request.Context(), tenantID, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Failed to load audit log"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"audit_log": logs})
}

package valueledger

import (
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/validation"
	"net/http"

	"github.com/gin-gonic/gin"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler { return &Handler{service: service} }

func (h *Handler) GetMetrics(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	m, err := h.service.Compute(c.Request.Context(), tenantID)
	if err != nil {
		validation.DBError(c, err)
		return
	}
	c.JSON(http.StatusOK, m)
}

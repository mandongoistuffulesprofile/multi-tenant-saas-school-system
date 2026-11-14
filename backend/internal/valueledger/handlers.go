package valueledger

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler { return &Handler{service: service} }

func (h *Handler) GetMetrics(c *gin.Context) {
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	tenantID := c.GetString("tenant_id")
	m, err := h.service.Compute(c.Request.Context(), tx, tenantID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, m)
}

// GetTrend returns the monthly revenue/expense/surplus series for the chart.
func (h *Handler) GetTrend(c *gin.Context) {
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	months := 12
	if raw := c.Query("months"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			months = parsed
		}
	}
	tenantID := c.GetString("tenant_id")
	points, err := h.service.Trend(c.Request.Context(), tx, tenantID, months)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"months": len(points), "points": points})
}

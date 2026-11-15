package openingbalance

import (
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/validation"
	"net/http"

	"github.com/gin-gonic/gin"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler { return &Handler{service: service} }

func (h *Handler) PostStudentArrears(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")
	var req OpeningBalanceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "BAD_REQUEST", "message": err.Error()})
		return
	}
	id, err := h.service.PostStudentArrears(c.Request.Context(), tenantID, userID, req)
	if err != nil {
		validation.DBError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"journal_entry_id": id})
}

func (h *Handler) PostOpeningStock(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")
	var req OpeningStockRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "BAD_REQUEST", "message": err.Error()})
		return
	}
	id, err := h.service.PostOpeningStock(c.Request.Context(), tenantID, userID, req)
	if err != nil {
		validation.DBError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"journal_entry_id": id})
}

package admin

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/validation"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) ListInKindSettings(c *gin.Context) {
	tenantID := c.GetString("tenant_id")

	settings, err := h.service.ListInKindSettings(c.Request.Context(), tenantID)
	if err != nil {
		validation.DBError(c, err)
		return
	}
	c.JSON(http.StatusOK, settings)
}

func (h *Handler) UpsertInKindSetting(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")

	var req UpdateInKindSettingRequest
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}

	setting, err := h.service.UpsertInKindSetting(c.Request.Context(), tenantID, userID, req)
	if err != nil {
		validation.DBError(c, err)
		return
	}
	c.JSON(http.StatusOK, setting)
}

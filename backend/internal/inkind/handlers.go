package inkind

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/validation"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

// ============ Rates ============

func (h *Handler) ListRates(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	includeInactive := c.Query("include_inactive") == "true"

	rates, err := h.service.ListRates(c.Request.Context(), tenantID, includeInactive)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, rates)
}

func (h *Handler) CreateRate(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")

	var req CreateInKindRateRequest
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}

	rate, err := h.service.CreateRate(c.Request.Context(), tenantID, userID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, rate)
}

// ============ Items ============

func (h *Handler) ListItems(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	itemType := c.Query("item_type")

	items, err := h.service.ListItems(c.Request.Context(), tenantID, itemType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, items)
}

func (h *Handler) CreateItem(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")

	var req CreateInventoryItemRequest
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}

	item, err := h.service.CreateItem(c.Request.Context(), tenantID, userID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, item)
}

// ============ Intakes ============

func (h *Handler) ListIntakes(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	studentID := c.Query("student_id")
	status := c.Query("status")

	limit := 50
	if l, err := strconv.Atoi(c.Query("limit")); err == nil && l > 0 {
		limit = l
	}
	offset := 0
	if o, err := strconv.Atoi(c.Query("offset")); err == nil && o >= 0 {
		offset = o
	}

	logs, err := h.service.ListIntakes(c.Request.Context(), tenantID, studentID, status, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, logs)
}

func (h *Handler) GetIntake(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	logID := c.Param("id")

	log, err := h.service.GetIntake(c.Request.Context(), tenantID, logID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	if log == nil {
		c.JSON(http.StatusNotFound, gin.H{"code": "NOT_FOUND", "message": "Intake log not found"})
		return
	}
	c.JSON(http.StatusOK, log)
}

func (h *Handler) CreateIntake(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")

	var req CreateIntakeLogRequest
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}

	log, err := h.service.CreateIntake(c.Request.Context(), tenantID, userID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, log)
}

func (h *Handler) VerifyIntake(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")
	logID := c.Param("id")

	var req VerifyIntakeRequest
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}

	log, err := h.service.VerifyIntake(c.Request.Context(), tenantID, userID, logID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	if log == nil {
		c.JSON(http.StatusNotFound, gin.H{"code": "NOT_FOUND", "message": "Intake log not found"})
		return
	}
	c.JSON(http.StatusOK, log)
}

// ============ Allocations ============

func (h *Handler) ListAllocations(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	studentID := c.Query("student_id")

	limit := 50
	if l, err := strconv.Atoi(c.Query("limit")); err == nil && l > 0 {
		limit = l
	}
	offset := 0
	if o, err := strconv.Atoi(c.Query("offset")); err == nil && o >= 0 {
		offset = o
	}

	allocs, err := h.service.ListAllocations(c.Request.Context(), tenantID, studentID, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, allocs)
}

func (h *Handler) CreateAllocation(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")

	var req CreateAllocationRequest
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}

	alloc, err := h.service.CreateAllocation(c.Request.Context(), tenantID, userID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, alloc)
}

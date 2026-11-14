package inkind

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/finance"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/validation"
)

type Handler struct {
	service *Service
	fin     *finance.Handler
}

func NewHandler(service *Service, fin *finance.Handler) *Handler {
	return &Handler{service: service, fin: fin}
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

func (h *Handler) CreateIntake(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")

	var req CreateIntakeLogRequest
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}

	// Wire finance so produce intakes clear the student's invoice in the
	// same transaction. Without this, maize/beans clear the kitchen inventory
	// but never the fee ledger.
	if h.fin != nil {
		h.service.SetFinanceCrediter(h.fin)
	}

	intake, err := h.service.CreateIntake(c.Request.Context(), tenantID, userID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, intake)
}

// POST /inkind/intakes/:id/verify
// Verify intake line items and mark the intake as VERIFIED.
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

// ============ Intake detail endpoints ============

// GET /inkind/intakes/:id
// Detail view for one intake, including item lines and total cash equivalent.
func (h *Handler) GetIntake(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	logID := c.Param("id")

	l, err := h.service.GetIntake(c.Request.Context(), tenantID, logID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	if l == nil {
		c.JSON(http.StatusNotFound, gin.H{"code": "NOT_FOUND", "message": "intake not found"})
		return
	}
	c.JSON(http.StatusOK, l)
}

// GET /inkind/intakes/:id/lines
// Item-level lines for one intake.
func (h *Handler) IntakeLines(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	logID := c.Param("id")

	items, err := h.service.IntakeLines(c.Request.Context(), tenantID, logID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, items)
}

// GET /inkind/items/:id/lots
// FIFO lots for one inventory item.
func (h *Handler) LotsForItem(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	inventoryItemID := c.Param("id")

	lots, err := h.service.LotsForItem(c.Request.Context(), tenantID, inventoryItemID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, lots)
}

// GET /inkind/rates/:id
// Current rate for one inventory item in a specific term.
func (h *Handler) CurrentRate(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	inventoryItemID := c.Param("id")
	termID := c.Query("term_id")
	if termID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": "BAD_REQUEST", "message": "term_id is required"})
		return
	}

	r, err := h.service.CurrentRate(c.Request.Context(), tenantID, inventoryItemID, termID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	if r == nil {
		c.JSON(http.StatusNotFound, gin.H{"code": "NOT_FOUND", "message": "no active rate for this item/term"})
		return
	}
	c.JSON(http.StatusOK, r)
}

// POST /inkind/intakes/:id/void
// Void a pending intake and reverse the journal/lot quantity.
func (h *Handler) VoidIntake(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")
	logID := c.Param("id")

	var req struct {
		Reason string `json:"reason" binding:"required"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}

	intake, err := h.service.VoidIntake(c.Request.Context(), tenantID, userID, logID, req.Reason)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, intake)
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

package kitchen

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

func (h *Handler) ListRecipes(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	mealType := c.Query("meal_type")
	includeInactive := c.Query("include_inactive") == "true"

	recipes, err := h.service.ListRecipes(c.Request.Context(), tenantID, mealType, includeInactive)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, recipes)
}

func (h *Handler) CreateRecipe(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")

	var req CreateMealRecipeRequest
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}

	recipe, err := h.service.CreateRecipe(c.Request.Context(), tenantID, userID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, recipe)
}

func (h *Handler) ListRequisitions(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	status := c.Query("status")
	fromDate := c.Query("from_date")
	toDate := c.Query("to_date")

	limit := 50
	if l, err := strconv.Atoi(c.Query("limit")); err == nil && l > 0 {
		limit = l
	}
	offset := 0
	if o, err := strconv.Atoi(c.Query("offset")); err == nil && o >= 0 {
		offset = o
	}

	reqs, err := h.service.ListRequisitions(c.Request.Context(), tenantID, status, fromDate, toDate, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, reqs)
}

func (h *Handler) CreateRequisition(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")

	var req CreateRequisitionRequest
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}

	requisition, err := h.service.CreateRequisition(c.Request.Context(), tenantID, userID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, requisition)
}

func (h *Handler) ProcessRequisition(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")
	requisitionID := c.Param("id")

	var req struct {
		BoarderCount int `json:"boarder_count" binding:"required,min=1"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}

	requisition, err := h.service.ProcessRequisition(c.Request.Context(), tenantID, userID, requisitionID, req.BoarderCount)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, requisition)
}

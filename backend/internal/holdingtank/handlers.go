package holdingtank

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler { return &Handler{service: service} }

func (h *Handler) ListHoldingTank(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	status := c.Query("status")
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	entries, err := h.service.List(c.Request.Context(), tenantID, status, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, entries)
}

func (h *Handler) ResolveHoldingTank(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")
	entryID := c.Param("id")
	var req struct {
		StudentID string `json:"student_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "BAD_REQUEST", "message": err.Error()})
		return
	}
	if err := h.service.Resolve(c.Request.Context(), tenantID, userID, entryID, req.StudentID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "resolved"})
}

func (h *Handler) CreateToken(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")
	var req struct {
		ClassID    string   `json:"class_id" binding:"required"`
		Subjects   []string `json:"subject_scope" binding:"required"`
		ExpiresAt  string   `json:"expires_at" binding:"required"`
		PIN        string   `json:"delegate_pin" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "BAD_REQUEST", "message": err.Error()})
		return
	}
	exp, err := time.Parse(time.RFC3339, req.ExpiresAt)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "BAD_REQUEST", "message": "invalid expires_at"})
		return
	}
	tok, err := h.service.CreateToken(c.Request.Context(), tenantID, userID, req.ClassID, req.Subjects, exp, req.PIN)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, tok)
}

func (h *Handler) ValidateToken(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	pin := c.Query("pin")
	classID := c.Query("class_id")
	tok, err := h.service.ValidateToken(c.Request.Context(), tenantID, pin, classID)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "INVALID_TOKEN", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, tok)
}

func (h *Handler) RevokeToken(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	tokenID := c.Param("id")
	if err := h.service.RevokeToken(c.Request.Context(), tenantID, tokenID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "revoked"})
}

func (h *Handler) ListTokens(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	toks, err := h.service.ListTokens(c.Request.Context(), tenantID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, toks)
}

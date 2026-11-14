package grading

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
)

type Handler struct{}

func NewHandler() *Handler { return &Handler{} }

// GetSettings returns the tenant configuration plus both resolved scales, so
// the admin screen can render a cutoff editor without hard-coding boundaries.
func (h *Handler) GetSettings(c *gin.Context) {
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	cfg, err := LoadConfig(tx, c.GetString("tenant_id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	four, err := cfg.Definition(ScaleFourBand)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	eight, err := cfg.Definition(ScaleEightPoint)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"config": cfg,
		"scales": gin.H{
			string(ScaleFourBand):   four,
			string(ScaleEightPoint): eight,
		},
	})
}

// UpdateSettings validates cutoffs and persists the tenant configuration.
func (h *Handler) UpdateSettings(c *gin.Context) {
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	var cfg Config
	if err := c.ShouldBindJSON(&cfg); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_REQUEST", "message": "invalid grading settings"})
		return
	}
	if err := cfg.Validate(); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_SETTINGS", "message": err.Error()})
		return
	}
	if err := SaveConfig(tx, c.GetString("tenant_id"), c.GetString("user_id"), cfg); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"config": cfg})
}

// ListLevels is a convenience endpoint for clients that only need the official
// or tenant-adjusted bands (e.g. a mobile grading screen).
func (h *Handler) ListLevels(c *gin.Context) {
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	cfg, err := LoadConfig(tx, c.GetString("tenant_id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	gradeBand := c.Query("grade_band")
	if gradeBand == "" {
		gradeBand = "LOWER_PRIMARY"
	}
	scale := cfg.ResolveScale(gradeBand)
	def, err := cfg.Definition(scale)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"scale": def.Scale, "levels": def.Levels})
}

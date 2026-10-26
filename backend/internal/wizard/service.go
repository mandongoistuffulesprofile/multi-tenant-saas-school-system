package wizard

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
)

type queryer interface {
	Query(query string, args ...interface{}) (*sql.Rows, error)
	QueryRow(query string, args ...interface{}) *sql.Row
	Exec(query string, args ...interface{}) (sql.Result, error)
}

type Service struct {
	database *db.DB
}

func NewService(database *db.DB) *Service {
	return &Service{database: database}
}

type WizardState struct {
	TenantID    string          `json:"tenant_id"`
	WizardType  string          `json:"wizard_type"`
	CurrentStep int             `json:"current_step"`
	Status      string          `json:"status"`
	Draft       json.RawMessage `json:"draft"`
	Version     int             `json:"version"`
	UpdatedBy   *string         `json:"updated_by,omitempty"`
	UpdatedAt   string          `json:"updated_at"`
}

func (s *Service) q(ctx context.Context) queryer {
	if q := middleware.TxFromContext(ctx); q != nil {
		return q
	}
	return s.database
}

func (s *Service) GetState(ctx context.Context, tenantID, wizardType string) (*WizardState, error) {
	q := s.q(ctx)
	var w WizardState
	var draft []byte
	err := q.QueryRow(
		`SELECT tenant_id, wizard_type, current_step, status, draft, version, updated_by, updated_at
		 FROM wizard_state WHERE tenant_id = $1 AND wizard_type = $2`,
		tenantID, wizardType,
	).Scan(&w.TenantID, &w.WizardType, &w.CurrentStep, &w.Status, &draft, &w.Version, &w.UpdatedBy, &w.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	w.Draft = draft
	return &w, nil
}

func (s *Service) UpsertState(ctx context.Context, tenantID, wizardType string, step int, status string, draft json.RawMessage, userID string) (*WizardState, error) {
	q := s.q(ctx)
	var w WizardState
	var draftBytes []byte
	err := q.QueryRow(
		`INSERT INTO wizard_state (tenant_id, wizard_type, current_step, status, draft, updated_by)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 ON CONFLICT (tenant_id, wizard_type) DO UPDATE SET
			current_step = EXCLUDED.current_step,
			status = EXCLUDED.status,
			draft = EXCLUDED.draft,
			version = wizard_state.version + 1,
			updated_by = EXCLUDED.updated_by,
			updated_at = CURRENT_TIMESTAMP
		 RETURNING tenant_id, wizard_type, current_step, status, draft, version, updated_by, updated_at`,
		tenantID, wizardType, step, status, draft, nullIfEmpty(userID),
	).Scan(&w.TenantID, &w.WizardType, &w.CurrentStep, &w.Status, &draftBytes, &w.Version, &w.UpdatedBy, &w.UpdatedAt)
	if err != nil {
		return nil, err
	}
	w.Draft = draftBytes
	return &w, nil
}

func nullIfEmpty(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) GetState(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	wizardType := c.Query("type")
	if wizardType == "" {
		wizardType = "SCHOOL_ADMIN"
	}
	w, err := h.service.GetState(c.Request.Context(), tenantID, wizardType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	if w == nil {
		c.JSON(http.StatusOK, gin.H{"status": "NOT_STARTED", "current_step": 0})
		return
	}
	c.JSON(http.StatusOK, w)
}

func (h *Handler) UpsertState(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	var req struct {
		WizardType string          `json:"wizard_type" binding:"required"`
		Step       int             `json:"step" binding:"required,min=1"`
		Status     string          `json:"status"`
		Draft      json.RawMessage `json:"draft"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_REQUEST", "message": err.Error()})
		return
	}
	if req.Status == "" {
		req.Status = "IN_PROGRESS"
	}
	userID := c.GetString("user_id")
	w, err := h.service.UpsertState(c.Request.Context(), tenantID, req.WizardType, req.Step, req.Status, req.Draft, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, w)
}

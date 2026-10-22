package knec

import (
	"database/sql"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
)

type Service struct {
	database *db.DB
}

func NewService(database *db.DB) *Service {
	return &Service{database: database}
}

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

// KNECTool
type KNECTool struct {
	ToolID         string `json:"tool_id"`
	ToolCode       string `json:"tool_code"`
	Name           string `json:"name"`
	Description    string `json:"description,omitempty"`
	GradeID        string `json:"grade_id"`
	AssessmentYear int    `json:"assessment_year"`
	IsActive       bool   `json:"is_active"`
	CreatedAt      string `json:"created_at"`
	UpdatedAt      string `json:"updated_at"`
}

func (h *Handler) ListKNECRules(c *gin.Context) {
	rows, err := h.service.database.Query(
		`SELECT tool_id, tool_code, name, description, grade_id, assessment_year,
			is_active, created_at, updated_at
		 FROM knec_tools ORDER BY tool_code`,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	var tools []KNECTool
	for rows.Next() {
		var t KNECTool
		if err := rows.Scan(&t.ToolID, &t.ToolCode, &t.Name, &t.Description, &t.GradeID,
			&t.AssessmentYear, &t.IsActive, &t.CreatedAt, &t.UpdatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		tools = append(tools, t)
	}
	c.JSON(http.StatusOK, tools)
}

// KNECSubmissionStatus
type KNECSubmissionStatus struct {
	SubmissionID   string `json:"submission_id"`
	TenantID       string `json:"tenant_id"`
	ToolID         string `json:"tool_id"`
	AcademicYearID string `json:"academic_year_id"`
	GradeID        string `json:"grade_id"`
	Status         string `json:"status"`
	ExportRef      string `json:"export_ref,omitempty"`
	ExportedAt     string `json:"exported_at,omitempty"`
	ConfirmedAt    string `json:"confirmed_at,omitempty"`
	CreatedBy      string `json:"created_by,omitempty"`
	CreatedAt      string `json:"created_at"`
	UpdatedAt      string `json:"updated_at"`
}

func (h *Handler) ListKNECRSubmissionStatus(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	rows, err := h.service.database.Query(
		`SELECT submission_id, tenant_id, tool_id, academic_year_id, grade_id,
			status, export_ref, exported_at, confirmed_at, created_by, created_at, updated_at
		 FROM knec_submission_status WHERE tenant_id = $1 ORDER BY created_at DESC`,
		tenantID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	var statuses []KNECSubmissionStatus
	for rows.Next() {
		var s KNECSubmissionStatus
		if err := rows.Scan(&s.SubmissionID, &s.TenantID, &s.ToolID, &s.AcademicYearID,
			&s.GradeID, &s.Status, &s.ExportRef, &s.ExportedAt, &s.ConfirmedAt,
			&s.CreatedBy, &s.CreatedAt, &s.UpdatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		statuses = append(statuses, s)
	}
	c.JSON(http.StatusOK, statuses)
}

// KNECExportBatch
type KNECExportBatch struct {
	BatchID        string `json:"batch_id"`
	TenantID       string `json:"tenant_id"`
	ToolID         string `json:"tool_id"`
	BatchReference string `json:"batch_reference"`
	LearnerCount   int    `json:"learner_count"`
	Status         string `json:"status"`
	FileRef        string `json:"file_ref,omitempty"`
	ErrorMessage   string `json:"error_message,omitempty"`
	CreatedBy      string `json:"created_by,omitempty"`
	CreatedAt      string `json:"created_at"`
	CompletedAt    string `json:"completed_at,omitempty"`
}

func (h *Handler) ListKNECRExportBatches(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	rows, err := h.service.database.Query(
		`SELECT batch_id, tenant_id, tool_id, batch_reference, learner_count,
			status, file_ref, error_message, created_by, created_at, completed_at
		 FROM knec_export_batches WHERE tenant_id = $1 ORDER BY created_at DESC`,
		tenantID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	var batches []KNECExportBatch
	for rows.Next() {
		var b KNECExportBatch
		if err := rows.Scan(&b.BatchID, &b.TenantID, &b.ToolID, &b.BatchReference,
			&b.LearnerCount, &b.Status, &b.FileRef, &b.ErrorMessage, &b.CreatedBy,
			&b.CreatedAt, &b.CompletedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		batches = append(batches, b)
	}
	c.JSON(http.StatusOK, batches)
}

var _ = http.StatusOK
var _ = sql.ErrNoRows

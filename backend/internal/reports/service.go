package reports

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"kenyan-primary-saas/backend/internal/db"
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

// ReportTemplate
type ReportTemplate struct {
	TemplateID     string         `json:"template_id"`
	TenantID       string         `json:"tenant_id"`
	TemplateName   string         `json:"template_name"`
	TemplateType   string         `json:"template_type"`
	GradeBand      string         `json:"grade_band"`
	IsDefault      bool           `json:"is_default"`
	IsActive       bool           `json:"is_active"`
	TemplateConfig map[string]any `json:"template_config"`
	CreatedBy      string         `json:"created_by,omitempty"`
	CreatedAt      string         `json:"created_at"`
	UpdatedAt      string         `json:"updated_at"`
}

func (h *Handler) ListReportTemplates(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	rows, err := h.service.database.Query(
		`SELECT template_id, tenant_id, template_name, template_type, grade_band,
			is_default, is_active, template_config, created_by, created_at, updated_at
		 FROM report_templates WHERE (tenant_id = $1 OR tenant_id IS NULL)
		 ORDER BY template_name`,
		tenantID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	var templates []ReportTemplate
	for rows.Next() {
		var t ReportTemplate
		var config []byte
		if err := rows.Scan(&t.TemplateID, &t.TenantID, &t.TemplateName, &t.TemplateType,
			&t.GradeBand, &t.IsDefault, &t.IsActive, &config, &t.CreatedBy, &t.CreatedAt, &t.UpdatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		t.TemplateConfig = map[string]any{}
		_ = json.Unmarshal(config, &t.TemplateConfig)
		templates = append(templates, t)
	}
	c.JSON(http.StatusOK, templates)
}

// ReportRun
type ReportRun struct {
	RunID          string `json:"run_id"`
	TenantID       string `json:"tenant_id"`
	TemplateID     string `json:"template_id"`
	AcademicYearID string `json:"academic_year_id"`
	TermID         string `json:"term_id,omitempty"`
	GradeID        string `json:"grade_id,omitempty"`
	Status         string `json:"status"`
	LearnerCount   int    `json:"learner_count"`
	GeneratedCount int    `json:"generated_count"`
	ErrorMessage   string `json:"error_message,omitempty"`
	CreatedBy      string `json:"created_by,omitempty"`
	CreatedAt      string `json:"created_at"`
	CompletedAt    string `json:"completed_at,omitempty"`
}

func (h *Handler) ListReportRuns(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	rows, err := h.service.database.Query(
		`SELECT run_id, tenant_id, template_id, academic_year_id, term_id, grade_id,
			status, learner_count, generated_count, error_message, created_by, created_at, completed_at
		 FROM report_runs WHERE tenant_id = $1 ORDER BY created_at DESC`,
		tenantID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	var runs []ReportRun
	for rows.Next() {
		var r ReportRun
		if err := rows.Scan(&r.RunID, &r.TenantID, &r.TemplateID, &r.AcademicYearID, &r.TermID,
			&r.GradeID, &r.Status, &r.LearnerCount, &r.GeneratedCount, &r.ErrorMessage,
			&r.CreatedBy, &r.CreatedAt, &r.CompletedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		runs = append(runs, r)
	}
	c.JSON(http.StatusOK, runs)
}

// ReportCard
type ReportCard struct {
	CardID             string  `json:"card_id"`
	TenantID           string  `json:"tenant_id"`
	RunID              string  `json:"run_id"`
	LearnerID          string  `json:"learner_id"`
	CardNumber         string  `json:"card_number"`
	AcademicYearID     string  `json:"academic_year_id"`
	TermID             string  `json:"term_id,omitempty"`
	GradeID            string  `json:"grade_id"`
	OverallGrade       string  `json:"overall_grade,omitempty"`
	TotalScore         float64 `json:"total_score,omitempty"`
	MaxScore           float64 `json:"max_score,omitempty"`
	Percentage         float64 `json:"percentage,omitempty"`
	Position           int     `json:"position,omitempty"`
	Comment            string  `json:"comment,omitempty"`
	HeadTeacherComment string  `json:"head_teacher_comment,omitempty"`
	Status             string  `json:"status"`
	PDFRef             string  `json:"pdf_ref,omitempty"`
	PublishedAt        string  `json:"published_at,omitempty"`
	PublishedBy        string  `json:"published_by,omitempty"`
	CreatedBy          string  `json:"created_by,omitempty"`
	CreatedAt          string  `json:"created_at"`
	UpdatedAt          string  `json:"updated_at"`
}

func (h *Handler) ListReportCards(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	runID := c.Query("run_id")
	learnerID := c.Query("learner_id")

	query := `
		SELECT card_id, tenant_id, run_id, learner_id, card_number, academic_year_id,
			term_id, grade_id, overall_grade, total_score, max_score, percentage,
			position, comment, head_teacher_comment, status, pdf_ref, published_at,
			published_by, created_by, created_at, updated_at
		 FROM report_cards WHERE tenant_id = $1`
	args := []interface{}{tenantID}
	argIndex := 2

	if runID != "" {
		query += fmt.Sprintf(" AND run_id = $%d", argIndex)
		args = append(args, runID)
		argIndex++
	}
	if learnerID != "" {
		query += fmt.Sprintf(" AND learner_id = $%d", argIndex)
		args = append(args, learnerID)
		argIndex++
	}
	query += " ORDER BY created_at DESC"

	rows, err := h.service.database.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	var cards []ReportCard
	for rows.Next() {
		var card ReportCard
		if err := rows.Scan(&card.CardID, &card.TenantID, &card.RunID, &card.LearnerID,
			&card.CardNumber, &card.AcademicYearID, &card.TermID, &card.GradeID,
			&card.OverallGrade, &card.TotalScore, &card.MaxScore, &card.Percentage,
			&card.Position, &card.Comment, &card.HeadTeacherComment, &card.Status,
			&card.PDFRef, &card.PublishedAt, &card.PublishedBy, &card.CreatedBy,
			&card.CreatedAt, &card.UpdatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		cards = append(cards, card)
	}
	c.JSON(http.StatusOK, cards)
}

func (h *Handler) GetReportCard(ginCtx *gin.Context) {
	tenantID := ginCtx.GetString("tenant_id")
	cardID := ginCtx.Param("card_id")
	var card ReportCard
	err := h.service.database.QueryRow(
		`SELECT card_id, tenant_id, run_id, learner_id, card_number, academic_year_id,
			term_id, grade_id, overall_grade, total_score, max_score, percentage,
			position, comment, head_teacher_comment, status, pdf_ref, published_at,
			published_by, created_by, created_at, updated_at
		 FROM report_cards WHERE tenant_id = $1 AND card_id = $2`,
		tenantID, cardID,
	).Scan(&card.CardID, &card.TenantID, &card.RunID, &card.LearnerID, &card.CardNumber,
		&card.AcademicYearID, &card.TermID, &card.GradeID, &card.OverallGrade,
		&card.TotalScore, &card.MaxScore, &card.Percentage, &card.Position,
		&card.Comment, &card.HeadTeacherComment, &card.Status, &card.PDFRef,
		&card.PublishedAt, &card.PublishedBy, &card.CreatedBy, &card.CreatedAt,
		&card.UpdatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			ginCtx.JSON(http.StatusNotFound, gin.H{"code": "NOT_FOUND", "message": "Report card not found"})
			return
		}
		ginCtx.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	ginCtx.JSON(http.StatusOK, card)
}

// ReportCardComment
type ReportCardComment struct {
	CommentID      string `json:"comment_id"`
	TenantID       string `json:"tenant_id"`
	CardID         string `json:"card_id"`
	LearningAreaID string `json:"learning_area_id"`
	CommentText    string `json:"comment_text"`
	TeacherID      string `json:"teacher_id,omitempty"`
	CreatedAt      string `json:"created_at"`
	UpdatedAt      string `json:"updated_at"`
}

func (h *Handler) ListReportCardComments(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	cardID := c.Param("card_id")
	rows, err := h.service.database.Query(
		`SELECT comment_id, tenant_id, card_id, learning_area_id, comment_text,
			teacher_id, created_at, updated_at
		 FROM report_card_comments WHERE tenant_id = $1 AND card_id = $2`,
		tenantID, cardID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	var comments []ReportCardComment
	for rows.Next() {
		var comment ReportCardComment
		if err := rows.Scan(&comment.CommentID, &comment.TenantID, &comment.CardID,
			&comment.LearningAreaID, &comment.CommentText, &comment.TeacherID,
			&comment.CreatedAt, &comment.UpdatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		comments = append(comments, comment)
	}
	c.JSON(http.StatusOK, comments)
}

var _ = http.StatusOK

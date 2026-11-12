package reports

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
	"github.com/lib/pq"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/audit"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
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
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	tenantID := c.GetString("tenant_id")
	rows, err := tx.Query(
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
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	tenantID := c.GetString("tenant_id")
	rows, err := tx.Query(
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
	CardID             string             `json:"card_id"`
	TenantID           string             `json:"tenant_id"`
	RunID              string             `json:"run_id"`
	LearnerID          string             `json:"learner_id"`
	LearnerName        string             `json:"learner_name,omitempty"`
	CardNumber         string             `json:"card_number"`
	AcademicYearID     string             `json:"academic_year_id"`
	AcademicYearLabel  string             `json:"academic_year_label,omitempty"`
	TermID             string             `json:"term_id,omitempty"`
	TermLabel          string             `json:"term_label,omitempty"`
	GradeID            string             `json:"grade_id"`
	OverallGrade       string             `json:"overall_grade,omitempty"`
	TotalScore         float64            `json:"total_score,omitempty"`
	MaxScore           float64            `json:"max_score,omitempty"`
	Percentage         float64            `json:"percentage,omitempty"`
	Position           int                `json:"position,omitempty"`
	Comment            string             `json:"comment,omitempty"`
	HeadTeacherComment string             `json:"head_teacher_comment,omitempty"`
	Status             string             `json:"status"`
	PDFRef             string             `json:"pdf_ref,omitempty"`
	PublishedAt        string             `json:"published_at,omitempty"`
	PublishedBy        string             `json:"published_by,omitempty"`
	CreatedBy          string             `json:"created_by,omitempty"`
	CreatedAt          string             `json:"created_at"`
	UpdatedAt          string             `json:"updated_at"`
	Results            []ReportCardResult `json:"results,omitempty"`
}

// ReportCardResult is one learning-area row on a printed report card.
type ReportCardResult struct {
	LearningAreaCode string  `json:"learning_area_code"`
	LearningAreaName string  `json:"learning_area_name"`
	AssessmentType   string  `json:"assessment_type"`
	AssessmentWindow string  `json:"assessment_window"`
	RawScore         float64 `json:"raw_score"`
	MaxScore         float64 `json:"max_score"`
	LevelCode        string  `json:"level_code,omitempty"`
	Comment          string  `json:"comment,omitempty"`
}

// linkedLearnerIDs returns the set of learner_ids linked to a guardian user.
func (h *Handler) linkedLearnerIDs(tx *sqlx.Tx, userID string) (map[string]bool, error) {
	rows, err := tx.Query(
		`SELECT lg.learner_id
		 FROM guardians gd
		 JOIN learner_guardians lg ON lg.guardian_id = gd.guardian_id
		 WHERE gd.user_id = $1`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	linked := make(map[string]bool)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		linked[id] = true
	}
	return linked, rows.Err()
}

func (h *Handler) ListReportCards(c *gin.Context) {
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	tenantID := c.GetString("tenant_id")
	runID := c.Query("run_id")
	learnerID := c.Query("learner_id")

	// Parent and guardian principals may only ever read report cards of the
	// learners linked to them via learner_guardians, even when no learner_id
	// filter is supplied. The school-wide list is staff-only surface.
	roles, _ := c.Get(middleware.ContextRoles)
	isParent := false
	if roleList, ok := roles.([]string); ok {
		for _, r := range roleList {
			if r == middleware.RoleParent || r == middleware.RoleGuardian {
				isParent = true
			}
		}
	}

	query := `
		SELECT rc.card_id, rc.tenant_id, rc.run_id, rc.learner_id,
			COALESCE(TRIM(COALESCE(l.first_name,'') || ' ' || COALESCE(l.last_name,'')), '') AS learner_name,
			rc.card_number, rc.academic_year_id, COALESCE(ay.year_label, '') AS academic_year_label,
			COALESCE(rc.term_id::text, '') AS term_id, COALESCE(t.term_label, '') AS term_label, rc.grade_id,
			COALESCE(rc.overall_grade, '') AS overall_grade,
			COALESCE(rc.total_score, 0) AS total_score,
			COALESCE(rc.max_score, 0) AS max_score,
			COALESCE(rc.percentage, 0) AS percentage,
			COALESCE(rc.position, 0) AS position,
			COALESCE(rc.comment, '') AS comment,
			COALESCE(rc.head_teacher_comment, '') AS head_teacher_comment,
			rc.status, COALESCE(rc.pdf_ref, '') AS pdf_ref,
			COALESCE(rc.published_at::text, '') AS published_at,
			COALESCE(rc.published_by::text, '') AS published_by,
			COALESCE(rc.created_by::text, '') AS created_by,
			rc.created_at, rc.updated_at
		 FROM report_cards rc
		 LEFT JOIN learners l ON l.learner_id = rc.learner_id AND l.tenant_id = rc.tenant_id
		 LEFT JOIN academic_years ay ON ay.year_id = rc.academic_year_id AND ay.tenant_id = rc.tenant_id
		 LEFT JOIN terms t ON t.term_id = rc.term_id AND t.tenant_id = rc.tenant_id
		 WHERE rc.tenant_id = $1`
	args := []interface{}{tenantID}
	argIndex := 2

	if isParent {
		linked, err := h.linkedLearnerIDs(tx, c.GetString("user_id"))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Failed to load linked learners"})
			return
		}
		if learnerID != "" {
			if !linked[learnerID] {
				c.JSON(http.StatusForbidden, gin.H{"code": "FORBIDDEN", "message": "Learner is not linked to this guardian"})
				return
			}
			query += fmt.Sprintf(" AND rc.learner_id = $%d", argIndex)
			args = append(args, learnerID)
			argIndex++
		} else {
			ids := make([]string, 0, len(linked))
			for id := range linked {
				ids = append(ids, id)
			}
			if len(ids) == 0 {
				c.JSON(http.StatusOK, []ReportCard{})
				return
			}
			query += fmt.Sprintf(" AND rc.learner_id = ANY($%d)", argIndex)
			args = append(args, pq.Array(ids))
			argIndex++
		}
	}

	if runID != "" {
		query += fmt.Sprintf(" AND rc.run_id = $%d", argIndex)
		args = append(args, runID)
		argIndex++
	}
	if !isParent && learnerID != "" {
		query += fmt.Sprintf(" AND rc.learner_id = $%d", argIndex)
		args = append(args, learnerID)
		argIndex++
	}
	query += " ORDER BY rc.created_at DESC"

	rows, err := tx.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	var cards []ReportCard
	for rows.Next() {
		var card ReportCard
		if err := rows.Scan(&card.CardID, &card.TenantID, &card.RunID, &card.LearnerID, &card.LearnerName,
			&card.CardNumber, &card.AcademicYearID, &card.AcademicYearLabel,
			&card.TermID, &card.TermLabel, &card.GradeID,
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

func (h *Handler) logReportAudit(c *gin.Context, action, targetType, targetID string, meta map[string]any) {
	audit.TenantAction(middleware.TxFromGin(c), c, action, targetType, targetID, meta)
}

// loadCardResults attaches the per-learning-area rows shown on a printed card.
func (h *Handler) loadCardResults(tx *sqlx.Tx, card *ReportCard) error {
	rows, err := tx.Query(
		`SELECT la.code, la.name, ae.assessment_type, ae.assessment_window,
			COALESCE(ar.raw_score, 0), COALESCE(ar.max_score, 0),
			COALESCE(ar.level_code, ''), COALESCE(rcc.comment_text, '')
		 FROM assessment_results ar
		 JOIN assessment_events ae ON ae.event_id = ar.event_id
		 JOIN learning_areas la ON la.area_id = ae.learning_area_id
		 LEFT JOIN report_card_comments rcc
		   ON rcc.card_id = $4 AND rcc.learning_area_id = la.area_id
		 WHERE ar.tenant_id = $1 AND ar.learner_id = $2
		   AND (NULLIF($3, '')::uuid IS NULL OR ae.term_id = NULLIF($3, '')::uuid)
		 ORDER BY la.sort_order, la.name`,
		card.TenantID, card.LearnerID, card.TermID, card.CardID,
	)
	if err != nil {
		return err
	}
	defer rows.Close()

	results := make([]ReportCardResult, 0)
	for rows.Next() {
		var r ReportCardResult
		if err := rows.Scan(&r.LearningAreaCode, &r.LearningAreaName, &r.AssessmentType,
			&r.AssessmentWindow, &r.RawScore, &r.MaxScore, &r.LevelCode, &r.Comment); err != nil {
			return err
		}
		results = append(results, r)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	card.Results = results
	return nil
}

func (h *Handler) GetReportCard(ginCtx *gin.Context) {
	tenantID := ginCtx.GetString("tenant_id")
	cardID := ginCtx.Param("card_id")
	var card ReportCard
	tx := middleware.TxFromGin(ginCtx)
	if tx == nil {
		ginCtx.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	err := tx.QueryRow(
		`SELECT rc.card_id, rc.tenant_id, rc.run_id, rc.learner_id,
			COALESCE(TRIM(COALESCE(l.first_name,'') || ' ' || COALESCE(l.last_name,'')), '') AS learner_name,
			rc.card_number, rc.academic_year_id, COALESCE(ay.year_label, '') AS academic_year_label,
			COALESCE(rc.term_id::text, '') AS term_id, COALESCE(t.term_label, '') AS term_label, rc.grade_id,
			COALESCE(rc.overall_grade, '') AS overall_grade,
			COALESCE(rc.total_score, 0) AS total_score,
			COALESCE(rc.max_score, 0) AS max_score,
			COALESCE(rc.percentage, 0) AS percentage,
			COALESCE(rc.position, 0) AS position,
			COALESCE(rc.comment, '') AS comment,
			COALESCE(rc.head_teacher_comment, '') AS head_teacher_comment,
			rc.status, COALESCE(rc.pdf_ref, '') AS pdf_ref,
			COALESCE(rc.published_at::text, '') AS published_at,
			COALESCE(rc.published_by::text, '') AS published_by,
			COALESCE(rc.created_by::text, '') AS created_by,
			rc.created_at, rc.updated_at
		 FROM report_cards rc
		 LEFT JOIN learners l ON l.learner_id = rc.learner_id AND l.tenant_id = rc.tenant_id
		 LEFT JOIN academic_years ay ON ay.year_id = rc.academic_year_id AND ay.tenant_id = rc.tenant_id
		 LEFT JOIN terms t ON t.term_id = rc.term_id AND t.tenant_id = rc.tenant_id
		 WHERE rc.tenant_id = $1 AND rc.card_id = $2`,
		tenantID, cardID,
	).Scan(&card.CardID, &card.TenantID, &card.RunID, &card.LearnerID, &card.LearnerName,
		&card.CardNumber, &card.AcademicYearID, &card.AcademicYearLabel,
		&card.TermID, &card.TermLabel, &card.GradeID,
		&card.OverallGrade, &card.TotalScore, &card.MaxScore, &card.Percentage,
		&card.Position, &card.Comment, &card.HeadTeacherComment, &card.Status,
		&card.PDFRef, &card.PublishedAt, &card.PublishedBy, &card.CreatedBy,
		&card.CreatedAt, &card.UpdatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			ginCtx.JSON(http.StatusNotFound, gin.H{"code": "NOT_FOUND", "message": "Report card not found"})
			return
		}
		ginCtx.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	if err := h.loadCardResults(tx, &card); err != nil {
		ginCtx.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}

	// Parents/guardians may only view report cards for linked learners.
	roles, _ := ginCtx.Get(middleware.ContextRoles)
	isParent := false
	if roleList, ok := roles.([]string); ok {
		for _, r := range roleList {
			if r == middleware.RoleParent || r == middleware.RoleGuardian {
				isParent = true
				break
			}
		}
	}
	if isParent {
		linked, linkErr := h.linkedLearnerIDs(tx, ginCtx.GetString("user_id"))
		if linkErr != nil {
			ginCtx.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Failed to load linked learners"})
			return
		}
		if !linked[card.LearnerID] {
			ginCtx.JSON(http.StatusNotFound, gin.H{"code": "NOT_FOUND", "message": "Report card not found"})
			return
		}
	}

	if isParent {
		h.logReportAudit(ginCtx, "REPORT_CARD_VIEW", "report_card", card.CardID, map[string]any{"learner_id": card.LearnerID})
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
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	tenantID := c.GetString("tenant_id")
	cardID := c.Param("card_id")

	// Parents/guardians may only read comments for cards of linked learners.
	roles, _ := c.Get(middleware.ContextRoles)
	isParent := false
	if roleList, ok := roles.([]string); ok {
		for _, r := range roleList {
			if r == middleware.RoleParent || r == middleware.RoleGuardian {
				isParent = true
				break
			}
		}
	}
	if isParent {
		var learnerID string
		err := tx.QueryRow(`SELECT learner_id FROM report_cards WHERE tenant_id = $1 AND card_id = $2`, tenantID, cardID).Scan(&learnerID)
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"code": "NOT_FOUND", "message": "Report card not found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		linked, linkErr := h.linkedLearnerIDs(tx, c.GetString("user_id"))
		if linkErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Failed to load linked learners"})
			return
		}
		if !linked[learnerID] {
			c.JSON(http.StatusNotFound, gin.H{"code": "NOT_FOUND", "message": "Report card not found"})
			return
		}
	}

	rows, err := tx.Query(
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

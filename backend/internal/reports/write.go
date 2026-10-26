package reports

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/validation"
)

// Write side of reporting: schools define their own report templates, run a
// batch for a class, and publish the generated cards.

func (h *Handler) CreateReportTemplate(c *gin.Context) {
	var req struct {
		TemplateName   string         `json:"template_name" binding:"required"`
		TemplateType   string         `json:"template_type" binding:"required"`
		GradeBand      string         `json:"grade_band" binding:"required"`
		TemplateConfig map[string]any `json:"template_config"`
		IsDefault      bool           `json:"is_default"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")

	config := req.TemplateConfig
	if config == nil {
		config = map[string]any{}
	}
	raw, _ := json.Marshal(config)

	var templateID string
	err := tx.QueryRow(
		`INSERT INTO report_templates
		 (tenant_id, template_name, template_type, grade_band, is_default, is_active, template_config, created_by)
		 VALUES ($1, $2, $3, $4, $5, true, $6::jsonb, $7)
		 RETURNING template_id`,
		tenantID, strings.TrimSpace(req.TemplateName), req.TemplateType, req.GradeBand,
		req.IsDefault, string(raw), nullableString(userID)).Scan(&templateID)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate key value") {
			validation.Conflict(c, "A template with that name already exists")
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"template_id": templateID})
}

func (h *Handler) UpdateReportTemplate(c *gin.Context) {
	templateID := c.Param("id")
	var req struct {
		TemplateName   string         `json:"template_name"`
		GradeBand      string         `json:"grade_band"`
		TemplateConfig map[string]any `json:"template_config"`
		IsActive       *bool          `json:"is_active"`
		IsDefault      *bool          `json:"is_default"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}

	sets := []string{"updated_at = now()"}
	args := []interface{}{}
	add := func(fragment string, value interface{}) {
		args = append(args, value)
		sets = append(sets, fragment+" = $"+itoa(len(args)))
	}
	if strings.TrimSpace(req.TemplateName) != "" {
		add("template_name", strings.TrimSpace(req.TemplateName))
	}
	if strings.TrimSpace(req.GradeBand) != "" {
		add("grade_band", req.GradeBand)
	}
	if req.TemplateConfig != nil {
		raw, _ := json.Marshal(req.TemplateConfig)
		add("template_config::jsonb", string(raw))
	}
	if req.IsActive != nil {
		add("is_active", *req.IsActive)
	}
	if req.IsDefault != nil {
		add("is_default", *req.IsDefault)
	}
	args = append(args, templateID, c.GetString("tenant_id"))

	result, err := tx.Exec(
		`UPDATE report_templates SET `+strings.Join(sets, ", ")+
			` WHERE template_id = $`+itoa(len(args)-1)+` AND tenant_id = $`+itoa(len(args)), args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		validation.NotFound(c, "Report template not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"template_id": templateID})
}

func (h *Handler) DeleteReportTemplate(c *gin.Context) {
	templateID := c.Param("id")
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	tenantID := c.GetString("tenant_id")
	result, err := tx.Exec(
		`UPDATE report_templates SET is_active = false, updated_at = now()
		 WHERE template_id = $1 AND tenant_id = $2`, templateID, tenantID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		validation.NotFound(c, "Report template not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"template_id": templateID, "is_active": false})
}

// CreateReportRun generates report cards for a class from captured results.
func (h *Handler) CreateReportRun(c *gin.Context) {
	var req struct {
		TemplateID     string `json:"template_id" binding:"required"`
		AcademicYearID string `json:"academic_year_id" binding:"required"`
		TermID         string `json:"term_id"`
		GradeID        string `json:"grade_id" binding:"required"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")

	termID := interface{}(nil)
	if strings.TrimSpace(req.TermID) != "" {
		termID = req.TermID
	}

	var runID string
	err := tx.QueryRow(
		`INSERT INTO report_runs (tenant_id, template_id, academic_year_id, term_id, grade_id, status, created_by)
		 VALUES ($1, $2, $3, $4, $5, 'PENDING', $6) RETURNING run_id`,
		tenantID, req.TemplateID, req.AcademicYearID, termID, req.GradeID, nullableString(userID)).Scan(&runID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}

	// One card per active learner in the grade.
	generated := 0
	rows, err := tx.Query(
		`SELECT l.learner_id, g.grade_label
		 FROM learners l
		 JOIN enrolments e ON e.learner_id = l.learner_id AND e.status = 'ACTIVE'
		 JOIN class_groups cg ON cg.class_group_id = e.class_group_id
		 JOIN grades g ON g.grade_id = cg.grade_id
		 WHERE l.tenant_id = $1 AND cg.grade_id = $2 AND l.status = 'ACTIVE'
		 ORDER BY l.last_name, l.first_name`, tenantID, req.GradeID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	type learnerRow struct {
		learnerID  string
		gradeLabel string
	}
	learners := make([]learnerRow, 0)
	for rows.Next() {
		var lr learnerRow
		if err := rows.Scan(&lr.learnerID, &lr.gradeLabel); err != nil {
			rows.Close()
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		learners = append(learners, lr)
	}
	rows.Close()

	for _, lr := range learners {
		// Aggregate the learner's results for the run's events.
		var total, max float64
		var overall string
		err := tx.QueryRow(
			`SELECT COALESCE(SUM(COALESCE(ar.raw_score, ar.points, 0)), 0),
				COALESCE(SUM(COALESCE(ar.max_score, 0)), 0),
				COALESCE(MODE() WITHIN GROUP (ORDER BY ar.level_code), '')
			 FROM assessment_results ar
			 JOIN assessment_events ae ON ae.event_id = ar.event_id
			 WHERE ar.tenant_id = $1 AND ae.grade_id = $2 AND ae.term_id = $3`,
			tenantID, req.GradeID, req.TermID).Scan(&total, &max, &overall)
		if err != nil && err != sql.ErrNoRows {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}

		percentage := 0.0
		if max > 0 {
			percentage = total / max * 100
		}
		cardNumber := req.GradeID + "-" + strings.ToUpper(lr.learnerID[:8]) + "-" + runID[:8]

_, err = tx.Exec(
		`INSERT INTO report_cards
		 (tenant_id, run_id, learner_id, card_number, academic_year_id, term_id, grade_id,
		  overall_grade, total_score, max_score, percentage, status, created_by)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'DRAFT', $12)
		 ON CONFLICT (tenant_id, run_id, learner_id) DO NOTHING`,
		tenantID, runID, lr.learnerID, cardNumber, req.AcademicYearID, termID, req.GradeID,
		nullableString(overall), total, max, percentage, nullableString(userID))
		if err != nil {
			continue
		}
		generated++
	}

	_, _ = tx.Exec(
		`UPDATE report_runs SET learner_count = $1, generated_count = $2, status = 'COMPLETED', completed_at = now()
		 WHERE run_id = $3`, len(learners), generated, runID)

	c.JSON(http.StatusCreated, gin.H{
		"run_id":          runID,
		"learner_count":   len(learners),
		"generated_count": generated,
	})
}

// GetReportRun returns a run together with the cards it produced.
func (h *Handler) GetReportRun(c *gin.Context) {
	runID := c.Param("run_id")
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	tenantID := c.GetString("tenant_id")

	var runIDOut, templateID, yearID, gradeID, status string
	var termID, errorMessage sql.NullString
	var learnerCount, generatedCount int
	err := tx.QueryRow(
		`SELECT run_id::text, template_id::text, academic_year_id::text, term_id::text, grade_id, status,
			learner_count, generated_count, error_message
		 FROM report_runs WHERE run_id = $1 AND tenant_id = $2`, runID, tenantID).
		Scan(&runIDOut, &templateID, &yearID, &termID, &gradeID, &status, &learnerCount, &generatedCount, &errorMessage)
	if err == sql.ErrNoRows {
		validation.NotFound(c, "Report run not found")
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"run_id":           runIDOut,
		"template_id":      templateID,
		"academic_year_id": yearID,
		"term_id":          termID.String,
		"grade_id":         gradeID,
		"status":           status,
		"learner_count":    learnerCount,
		"generated_count":  generatedCount,
		"error_message":    errorMessage.String,
	})
}

// PublishReportRun publishes every draft card in a run.
func (h *Handler) PublishReportRun(c *gin.Context) {
	runID := c.Param("run_id")
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")

	result, err := tx.Exec(
		`UPDATE report_cards SET status = 'PUBLISHED', published_at = now(), published_by = $1, updated_at = now()
		 WHERE tenant_id = $2 AND run_id = $3 AND status <> 'PUBLISHED'`,
		nullableString(userID), tenantID, runID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	published, _ := result.RowsAffected()

	_, _ = tx.Exec(
		`UPDATE report_runs SET status = 'PUBLISHED' WHERE run_id = $1 AND tenant_id = $2`, runID, tenantID)

	c.JSON(http.StatusOK, gin.H{"run_id": runID, "published": published})
}

// UpsertReportCardComment attaches a teacher's comment to a report card for a
// learning area.
func (h *Handler) UpsertReportCardComment(c *gin.Context) {
	cardID := c.Param("card_id")
	var req struct {
		LearningAreaID string `json:"learning_area_id" binding:"required"`
		CommentText    string `json:"comment_text" binding:"required"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")

	var commentID string
	err := tx.QueryRow(
		`INSERT INTO report_card_comments (tenant_id, card_id, learning_area_id, comment_text, teacher_id)
		 VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (tenant_id, card_id, learning_area_id)
		 DO UPDATE SET comment_text = EXCLUDED.comment_text, updated_at = now()
		 RETURNING comment_id`,
		tenantID, cardID, req.LearningAreaID, req.CommentText, nullableString(userID)).Scan(&commentID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"comment_id": commentID})
}

// UpdateReportCardHeadComment stores the head teacher's comment on a card.
func (h *Handler) UpdateReportCardHeadComment(c *gin.Context) {
	cardID := c.Param("card_id")
	var req struct {
		HeadTeacherComment string `json:"head_teacher_comment"`
		Comment            string `json:"comment"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	text := req.HeadTeacherComment
	if text == "" {
		text = req.Comment
	}
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	tenantID := c.GetString("tenant_id")
	result, err := tx.Exec(
		`UPDATE report_cards SET head_teacher_comment = $1, comment = COALESCE(comment, $1), updated_at = now()
		 WHERE card_id = $2 AND tenant_id = $3`, text, cardID, tenantID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		validation.NotFound(c, "Report card not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"card_id": cardID})
}

// ---------- helpers ----------

func nullableString(s string) interface{} {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

func itoa(n int) string {
	return strconv.Itoa(n)
}

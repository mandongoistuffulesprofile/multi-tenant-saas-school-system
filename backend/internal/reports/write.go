package reports

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/grading"
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

// CreateReportRun generates report cards from captured results.
//
// academic_year_id and grade_id are optional: the current (or latest) academic
// year is used when omitted, and every grade is generated when grade_id is
// omitted. term_id may be a term UUID or the literal "current".
func (h *Handler) CreateReportRun(c *gin.Context) {
	var req struct {
		TemplateID     string `json:"template_id" binding:"required"`
		AcademicYearID string `json:"academic_year_id"`
		TermID         string `json:"term_id"`
		GradeID        string `json:"grade_id"`
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
	academicYearID := strings.TrimSpace(req.AcademicYearID)
	gradeID := strings.TrimSpace(req.GradeID)

	if academicYearID == "" {
		var y sql.NullString
		if err := tx.QueryRow(
			`SELECT COALESCE(
				(SELECT year_id FROM academic_years WHERE tenant_id = $1 AND is_current = true),
				(SELECT year_id FROM academic_years WHERE tenant_id = $1 ORDER BY start_date DESC LIMIT 1))`,
			tenantID).Scan(&y); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		if !y.Valid || y.String == "" {
			validation.BadRequest(c, "Invalid request", []validation.FieldError{
				{Field: "academic_year_id", Code: "REQUIRED", Message: "tenant has no academic year configured"},
			})
			return
		}
		academicYearID = y.String
	}

	var termID interface{}
	if t := strings.TrimSpace(req.TermID); t != "" {
		if strings.EqualFold(t, "current") {
			var cur sql.NullString
			if err := tx.QueryRow(
				`SELECT term_id::text FROM terms
				 WHERE tenant_id = $1 AND is_current = true
				 ORDER BY start_date DESC LIMIT 1`, tenantID).Scan(&cur); err == nil && cur.Valid {
				termID = cur.String
			}
		} else {
			termID = t
		}
	}

	var gradeFilter interface{}
	if gradeID != "" {
		gradeFilter = gradeID
	}

	var runID string
	err := tx.QueryRow(
		`INSERT INTO report_runs (tenant_id, template_id, academic_year_id, term_id, grade_id, status, created_by)
		 VALUES ($1, $2, $3, $4, $5, 'PENDING', $6) RETURNING run_id`,
		tenantID, req.TemplateID, academicYearID, termID, gradeFilter, nullableString(userID)).Scan(&runID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}

	// One card per active learner, optionally restricted to a single grade.
	learnerQuery := `
		SELECT l.learner_id, g.grade_label, cg.grade_id
		 FROM learners l
		 JOIN (
			SELECT DISTINCT ON (learner_id) learner_id, class_group_id
			FROM enrolments WHERE status = 'ACTIVE'
			ORDER BY learner_id, started_on DESC
		 ) e ON e.learner_id = l.learner_id
		 JOIN class_groups cg ON cg.class_group_id = e.class_group_id
		 JOIN grades g ON g.grade_id = cg.grade_id
		 WHERE l.tenant_id = $1 AND l.status = 'ACTIVE'`
	qargs := []interface{}{tenantID}
	if gradeID != "" {
		learnerQuery += " AND cg.grade_id = $2"
		qargs = append(qargs, gradeID)
	}
	learnerQuery += " ORDER BY l.last_name, l.first_name"

	rows, err := tx.Query(learnerQuery, qargs...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	type learnerRow struct {
		learnerID  string
		gradeLabel string
		gradeID    string
	}
	learners := make([]learnerRow, 0)
	for rows.Next() {
		var lr learnerRow
		if err := rows.Scan(&lr.learnerID, &lr.gradeLabel, &lr.gradeID); err != nil {
			rows.Close()
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		learners = append(learners, lr)
	}
	rows.Close()

	generated := 0
	for _, lr := range learners {
		// Draft cards deliberately carry no total, percentage, mean grade or
		// position. A mean grade is not part of the CBC report card; an
		// aggregate summary is only produced at publish time, and only when a
		// school has explicitly enabled it in the grading settings.
		cardNumber := lr.gradeID + "-" + strings.ToUpper(lr.learnerID[:8]) + "-" + runID[:8]

		_, err = tx.Exec(
			`INSERT INTO report_cards
		 (tenant_id, run_id, learner_id, card_number, academic_year_id, term_id, grade_id, status, created_by)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, 'DRAFT', $8)
		 ON CONFLICT (tenant_id, run_id, learner_id) DO NOTHING`,
			tenantID, runID, lr.learnerID, cardNumber, academicYearID, termID, lr.gradeID,
			nullableString(userID))
		if err != nil {
			continue
		}
		generated++
	}

	_, _ = tx.Exec(
		`UPDATE report_runs SET learner_count = $1, generated_count = $2, status = 'COMPLETED', completed_at = now(), error_message = ''
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

// PublishReportRun freezes every card in a run. Each card is rebuilt from the
// school's grading configuration, snapshotted, and stored as an immutable
// revision. Aggregate totals and class positions are only included when the
// school has explicitly enabled them.
func (h *Handler) PublishReportRun(c *gin.Context) {
	runID := c.Param("run_id")
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")

	cfg, err := grading.LoadConfig(tx, tenantID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}

	type cardRow struct {
		cardID   string
		revision int
		status   string
	}
	rows, err := tx.Query(
		`SELECT card_id::text, revision, status
		 FROM report_cards WHERE tenant_id = $1 AND run_id = $2
		 ORDER BY learner_id`, tenantID, runID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	cards := make([]cardRow, 0)
	for rows.Next() {
		var cr cardRow
		if err := rows.Scan(&cr.cardID, &cr.revision, &cr.status); err != nil {
			rows.Close()
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		cards = append(cards, cr)
	}
	rows.Close()
	if len(cards) == 0 {
		validation.NotFound(c, "Report run has no cards")
		return
	}

	snapshots := make([]CardSnapshot, 0, len(cards))
	for _, cr := range cards {
		revision := cr.revision
		if revision < 1 {
			revision = 1
		}
		// Re-publishing a card is a correction: it creates the next revision
		// instead of mutating the existing frozen snapshot.
		if strings.EqualFold(cr.status, "PUBLISHED") {
			revision++
		}
		snapshot, err := BuildSnapshot(tx, tenantID, cr.cardID, cfg, revision)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		snapshots = append(snapshots, snapshot)
	}

	if cfg.ShowPosition {
		refs := make([]*CardSnapshot, len(snapshots))
		for i := range snapshots {
			refs[i] = &snapshots[i]
		}
		AssignPositions(refs)
	}

	published := 0
	for i, cr := range cards {
		snapshot := snapshots[i]
		raw, err := json.Marshal(snapshot)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		if _, err := tx.Exec(
			`INSERT INTO report_card_revisions (tenant_id, card_id, revision, snapshot, created_by)
			 VALUES ($1, $2, $3, $4::jsonb, NULLIF($5, '')::uuid)
			 ON CONFLICT (tenant_id, card_id, revision) DO NOTHING`,
			tenantID, cr.cardID, snapshot.Revision, string(raw), userID); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}

		var position, overall, total, max, percentage interface{}
		if snapshot.Aggregate != nil {
			overall = nullableString(snapshot.Aggregate.Grade)
			total = snapshot.Aggregate.Points
			max = snapshot.Aggregate.MaxPoints
			percentage = snapshot.Aggregate.Percentage
		}
		if cfg.ShowPosition && snapshot.Position > 0 {
			position = snapshot.Position
		}

		if _, err := tx.Exec(
			`UPDATE report_cards
			 SET snapshot = $1::jsonb, snapshot_at = now(), revision = $2, frozen = true,
			     position = $3, overall_grade = $4, total_score = $5, max_score = $6,
			     percentage = $7, status = 'PUBLISHED', published_at = now(),
			     published_by = NULLIF($8, '')::uuid, updated_at = now()
			 WHERE tenant_id = $9 AND card_id = $10`,
			string(raw), snapshot.Revision, position, overall, total, max, percentage,
			userID, tenantID, cr.cardID); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		published++
	}

	_, _ = tx.Exec(
		`UPDATE report_runs SET status = 'PUBLISHED' WHERE run_id = $1 AND tenant_id = $2`, runID, tenantID)

	c.JSON(http.StatusOK, gin.H{
		"run_id":            runID,
		"published":         published,
		"show_aggregate":    cfg.ShowAggregate,
		"show_position":     cfg.ShowPosition,
		"frozen_revisions":  published,
	})
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

	var status string
	var frozen bool
	if err := tx.QueryRow(
		`SELECT status, frozen FROM report_cards WHERE tenant_id = $1 AND card_id = $2`,
		tenantID, cardID).Scan(&status, &frozen); err != nil {
		if err == sql.ErrNoRows {
			validation.NotFound(c, "Report card not found")
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	if frozen || strings.EqualFold(status, "PUBLISHED") {
		c.JSON(http.StatusConflict, gin.H{
			"code":    "CARD_LOCKED",
			"message": "Published report cards are frozen. Create a correction revision instead of editing comments.",
		})
		return
	}

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
	var status string
	var frozen bool
	if err := tx.QueryRow(
		`SELECT status, frozen FROM report_cards WHERE tenant_id = $1 AND card_id = $2`,
		tenantID, cardID).Scan(&status, &frozen); err != nil {
		if err == sql.ErrNoRows {
			validation.NotFound(c, "Report card not found")
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	if frozen || strings.EqualFold(status, "PUBLISHED") {
		c.JSON(http.StatusConflict, gin.H{
			"code":    "CARD_LOCKED",
			"message": "Published report cards are frozen and cannot be edited.",
		})
		return
	}
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

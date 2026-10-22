// Package structure exposes the school's own academic structure: grades
// (global reference), streams, class groups and teaching assignments.
//
// These are custom data a school creates and edits itself, so every record
// here is entered by a user and must be creatable and editable from the UI.
package structure

import (
	"database/sql"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/validation"
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

// Grade is global reference data (PP1..Grade 9 plus junior secondary).
type Grade struct {
	GradeID        string `json:"grade_id"`
	GradeLabel     string `json:"grade_label"`
	LevelBand      string `json:"level_band"`
	LessonsPerWeek int    `json:"lessons_per_week"`
}

// Stream is a school-owned house (e.g. East, West).
type Stream struct {
	StreamID   string `json:"stream_id"`
	TenantID   string `json:"tenant_id"`
	StreamName string `json:"stream_name"`
	CreatedAt  string `json:"created_at"`
}

// ClassGroup is one class in a year/grade/stream combination.
type ClassGroup struct {
	ClassGroupID     string `json:"class_group_id"`
	TenantID         string `json:"tenant_id"`
	YearID           string `json:"year_id"`
	YearLabel        string `json:"year_label,omitempty"`
	GradeID          string `json:"grade_id"`
	GradeLabel       string `json:"grade_label"`
	StreamID         string `json:"stream_id"`
	StreamName       string `json:"stream_name"`
	ClassTeacherID   string `json:"class_teacher_id,omitempty"`
	ClassTeacherName string `json:"class_teacher_name,omitempty"`
	LearnerCount     int    `json:"learner_count"`
	CreatedAt        string `json:"created_at"`
}

// TeachingAssignment links a staff member to a class group for a learning area.
type TeachingAssignment struct {
	AssignmentID      string `json:"assignment_id"`
	TenantID          string `json:"tenant_id"`
	StaffMembershipID string `json:"staff_membership_id"`
	TeacherName       string `json:"teacher_name,omitempty"`
	ClassGroupID      string `json:"class_group_id"`
	ClassLabel        string `json:"class_label,omitempty"`
	SubjectID         string `json:"subject_id"`
	SubjectName       string `json:"subject_name,omitempty"`
	AcademicYearID    string `json:"academic_year_id"`
	CreatedAt         string `json:"created_at"`
}

// ---------- Grades (global reference) ----------

func (h *Handler) ListGrades(c *gin.Context) {
	rows, err := h.service.database.Query(
		`SELECT grade_id, grade_label, level_band, lessons_per_week FROM grades ORDER BY grade_label`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	grades := make([]Grade, 0)
	for rows.Next() {
		var g Grade
		if err := rows.Scan(&g.GradeID, &g.GradeLabel, &g.LevelBand, &g.LessonsPerWeek); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		grades = append(grades, g)
	}
	c.JSON(http.StatusOK, grades)
}

// ---------- Streams ----------

func (h *Handler) ListStreams(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	rows, err := h.service.database.Query(
		`SELECT stream_id, tenant_id, stream_name, created_at FROM streams WHERE tenant_id = $1 ORDER BY stream_name`,
		tenantID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	streams := make([]Stream, 0)
	for rows.Next() {
		var s Stream
		if err := rows.Scan(&s.StreamID, &s.TenantID, &s.StreamName, &s.CreatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		streams = append(streams, s)
	}
	c.JSON(http.StatusOK, streams)
}

func (h *Handler) CreateStream(c *gin.Context) {
	var req struct {
		StreamName string `json:"stream_name" binding:"required"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	req.StreamName = strings.TrimSpace(req.StreamName)
	if req.StreamName == "" {
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "stream_name", Code: "REQUIRED", Message: "'stream_name' is required"},
		})
		return
	}

	tenantID := c.GetString("tenant_id")
	var streamID string
	err := h.service.database.QueryRow(
		`INSERT INTO streams (tenant_id, stream_name) VALUES ($1, $2) RETURNING stream_id`,
		tenantID, req.StreamName).Scan(&streamID)
	if err != nil {
		if isUniqueViolation(err) {
			validation.Conflict(c, "A stream with that name already exists")
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"stream_id": streamID})
}

func (h *Handler) UpdateStream(c *gin.Context) {
	streamID := c.Param("id")
	var req struct {
		StreamName string `json:"stream_name" binding:"required"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	tenantID := c.GetString("tenant_id")
	result, err := h.service.database.Exec(
		`UPDATE streams SET stream_name = $1 WHERE stream_id = $2 AND tenant_id = $3`,
		strings.TrimSpace(req.StreamName), streamID, tenantID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		validation.NotFound(c, "Stream not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"stream_id": streamID})
}

func (h *Handler) DeleteStream(c *gin.Context) {
	streamID := c.Param("id")
	tenantID := c.GetString("tenant_id")
	result, err := h.service.database.Exec(
		`DELETE FROM streams WHERE stream_id = $1 AND tenant_id = $2`, streamID, tenantID)
	if err != nil {
		// A stream still referenced by a class group must not disappear.
		if isForeignKeyViolation(err) {
			validation.Conflict(c, "Stream is still used by a class group")
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		validation.NotFound(c, "Stream not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

// ---------- Class groups ----------

func (h *Handler) ListClassGroups(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	yearID := c.Query("year_id")

	query := `
		SELECT cg.class_group_id, cg.tenant_id, cg.year_id, ay.year_label,
			cg.grade_id, g.grade_label, cg.stream_id, s.stream_name,
			COALESCE(cg.class_teacher_id::text, ''),
			COALESCE(NULLIF(u.email, ''), NULLIF(u.phone_number, ''), tm.role, ''),
			(SELECT COUNT(*) FROM enrolments e
			 WHERE e.class_group_id = cg.class_group_id AND e.status = 'ACTIVE'),
			cg.created_at
		FROM class_groups cg
		LEFT JOIN academic_years ay ON ay.year_id = cg.year_id
		LEFT JOIN grades g ON g.grade_id = cg.grade_id
		LEFT JOIN streams s ON s.stream_id = cg.stream_id
		LEFT JOIN tenant_memberships tm ON tm.membership_id = cg.class_teacher_id
		LEFT JOIN users u ON u.user_id = tm.user_id
		WHERE cg.tenant_id = $1`
	args := []interface{}{tenantID}
	if yearID != "" {
		query += " AND cg.year_id = $2"
		args = append(args, yearID)
	}
	query += " ORDER BY ay.year_label DESC, g.grade_label, s.stream_name"

	rows, err := h.service.database.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	groups := make([]ClassGroup, 0)
	for rows.Next() {
		var cg ClassGroup
		if err := rows.Scan(&cg.ClassGroupID, &cg.TenantID, &cg.YearID, &cg.YearLabel,
			&cg.GradeID, &cg.GradeLabel, &cg.StreamID, &cg.StreamName,
			&cg.ClassTeacherID, &cg.ClassTeacherName, &cg.LearnerCount, &cg.CreatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		groups = append(groups, cg)
	}
	c.JSON(http.StatusOK, groups)
}

func (h *Handler) CreateClassGroup(c *gin.Context) {
	var req struct {
		YearID         string `json:"year_id" binding:"required"`
		GradeID        string `json:"grade_id" binding:"required"`
		StreamID       string `json:"stream_id" binding:"required"`
		ClassTeacherID string `json:"class_teacher_id"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}

	tenantID := c.GetString("tenant_id")
	var classGroupID string
	var err error
	if strings.TrimSpace(req.ClassTeacherID) == "" {
		err = h.service.database.QueryRow(
			`INSERT INTO class_groups (tenant_id, year_id, grade_id, stream_id)
			 VALUES ($1, $2, $3, $4) RETURNING class_group_id`,
			tenantID, req.YearID, req.GradeID, req.StreamID).Scan(&classGroupID)
	} else {
		err = h.service.database.QueryRow(
			`INSERT INTO class_groups (tenant_id, year_id, grade_id, stream_id, class_teacher_id)
			 VALUES ($1, $2, $3, $4, $5) RETURNING class_group_id`,
			tenantID, req.YearID, req.GradeID, req.StreamID, req.ClassTeacherID).Scan(&classGroupID)
	}
	if err != nil {
		if isUniqueViolation(err) {
			validation.Conflict(c, "A class group already exists for that year, grade and stream")
			return
		}
		if isForeignKeyViolation(err) {
			validation.BadRequest(c, "Invalid request", []validation.FieldError{
				{Field: "class_group", Code: "INVALID_VALUE", Message: "year, grade, stream or class teacher does not exist"},
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"class_group_id": classGroupID})
}

func (h *Handler) UpdateClassGroup(c *gin.Context) {
	classGroupID := c.Param("id")
	var req struct {
		ClassTeacherID string `json:"class_teacher_id"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	tenantID := c.GetString("tenant_id")

	var teacher interface{}
	if strings.TrimSpace(req.ClassTeacherID) != "" {
		teacher = req.ClassTeacherID
	}
	result, err := h.service.database.Exec(
		`UPDATE class_groups SET class_teacher_id = $1 WHERE class_group_id = $2 AND tenant_id = $3`,
		teacher, classGroupID, tenantID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		validation.NotFound(c, "Class group not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"class_group_id": classGroupID})
}

func (h *Handler) DeleteClassGroup(c *gin.Context) {
	classGroupID := c.Param("id")
	tenantID := c.GetString("tenant_id")
	result, err := h.service.database.Exec(
		`DELETE FROM class_groups WHERE class_group_id = $1 AND tenant_id = $2`, classGroupID, tenantID)
	if err != nil {
		if isForeignKeyViolation(err) {
			validation.Conflict(c, "Class group still has enrolments or teaching assignments")
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		validation.NotFound(c, "Class group not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

// ---------- Teaching assignments ----------

func (h *Handler) ListTeachingAssignments(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	yearID := c.Query("year_id")
	classGroupID := c.Query("class_group_id")

	query := `
		SELECT ta.assignment_id, ta.tenant_id, ta.staff_membership_id,
			COALESCE(NULLIF(u.email, ''), NULLIF(u.phone_number, ''), tm.role, ''),
			ta.class_group_id,
			COALESCE(g.grade_label || ' ' || s.stream_name, ''),
			ta.subject_id,
			COALESCE(la.name, ta.subject_id),
			ta.academic_year_id,
			ta.created_at
		FROM teaching_assignments ta
		LEFT JOIN tenant_memberships tm ON tm.membership_id = ta.staff_membership_id
		LEFT JOIN users u ON u.user_id = tm.user_id
		LEFT JOIN class_groups cg ON cg.class_group_id = ta.class_group_id
		LEFT JOIN grades g ON g.grade_id = cg.grade_id
		LEFT JOIN streams s ON s.stream_id = cg.stream_id
		LEFT JOIN learning_areas la ON la.code = ta.subject_id OR la.area_id::text = ta.subject_id
		WHERE ta.tenant_id = $1`
	args := []interface{}{tenantID}
	if yearID != "" {
		query += " AND ta.academic_year_id = $2"
		args = append(args, yearID)
	}
	if classGroupID != "" {
		query += fmt.Sprintf(" AND ta.class_group_id = $%d", len(args)+1)
		args = append(args, classGroupID)
	}
	query += " ORDER BY g.grade_label, s.stream_name, ta.subject_id"

	rows, err := h.service.database.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	assignments := make([]TeachingAssignment, 0)
	for rows.Next() {
		var a TeachingAssignment
		if err := rows.Scan(&a.AssignmentID, &a.TenantID, &a.StaffMembershipID,
			&a.TeacherName, &a.ClassGroupID, &a.ClassLabel, &a.SubjectID,
			&a.SubjectName, &a.AcademicYearID, &a.CreatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		assignments = append(assignments, a)
	}
	c.JSON(http.StatusOK, assignments)
}

func (h *Handler) CreateTeachingAssignment(c *gin.Context) {
	var req struct {
		StaffMembershipID string `json:"staff_membership_id" binding:"required"`
		ClassGroupID      string `json:"class_group_id" binding:"required"`
		SubjectID         string `json:"subject_id" binding:"required"`
		AcademicYearID    string `json:"academic_year_id" binding:"required"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	tenantID := c.GetString("tenant_id")
	var assignmentID string
	err := h.service.database.QueryRow(
		`INSERT INTO teaching_assignments (tenant_id, staff_membership_id, class_group_id, subject_id, academic_year_id)
		 VALUES ($1, $2, $3, $4, $5) RETURNING assignment_id`,
		tenantID, req.StaffMembershipID, req.ClassGroupID, req.SubjectID, req.AcademicYearID).Scan(&assignmentID)
	if err != nil {
		if isUniqueViolation(err) {
			validation.Conflict(c, "That teacher is already allocated to this class and subject")
			return
		}
		if isForeignKeyViolation(err) {
			validation.BadRequest(c, "Invalid request", []validation.FieldError{
				{Field: "assignment", Code: "INVALID_VALUE", Message: "teacher, class group or academic year does not exist"},
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"assignment_id": assignmentID})
}

func (h *Handler) DeleteTeachingAssignment(c *gin.Context) {
	assignmentID := c.Param("id")
	tenantID := c.GetString("tenant_id")
	result, err := h.service.database.Exec(
		`DELETE FROM teaching_assignments WHERE assignment_id = $1 AND tenant_id = $2`, assignmentID, tenantID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		validation.NotFound(c, "Teaching assignment not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

// RolloverClassGroups copies the current year's class groups into a new year.
func (h *Handler) RolloverClassGroups(c *gin.Context) {
	var req struct {
		FromYearID string   `json:"from_year_id" binding:"required"`
		ToYearID   string   `json:"to_year_id" binding:"required"`
		GradeIDs   []string `json:"grade_ids"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	if req.FromYearID == req.ToYearID {
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "to_year_id", Code: "INVALID_VALUE", Message: "'to_year_id' must differ from 'from_year_id'"},
		})
		return
	}

	tenantID := c.GetString("tenant_id")
	gradeFilter := ""
	args := []interface{}{tenantID, req.FromYearID, req.ToYearID}
	if len(req.GradeIDs) > 0 {
		gradeFilter = " AND cg.grade_id = ANY($4)"
		args = append(args, req.GradeIDs)
	}

	// Preview mode returns what would be copied without writing.
	if c.Query("dry_run") == "true" {
		rows, err := h.service.database.Query(
			`SELECT cg.grade_id, g.grade_label, cg.stream_id, s.stream_name
			 FROM class_groups cg
			 LEFT JOIN grades g ON g.grade_id = cg.grade_id
			 LEFT JOIN streams s ON s.stream_id = cg.stream_id
			 WHERE cg.tenant_id = $1 AND cg.year_id = $2`+gradeFilter,
			args...)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		defer rows.Close()
		type preview struct {
			GradeID    string `json:"grade_id"`
			GradeLabel string `json:"grade_label"`
			StreamID   string `json:"stream_id"`
			StreamName string `json:"stream_name"`
		}
		items := make([]preview, 0)
		for rows.Next() {
			var p preview
			if err := rows.Scan(&p.GradeID, &p.GradeLabel, &p.StreamID, &p.StreamName); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
				return
			}
			items = append(items, p)
		}
		c.JSON(http.StatusOK, gin.H{"dry_run": true, "count": len(items), "class_groups": items})
		return
	}

	result, err := h.service.database.Exec(
		`INSERT INTO class_groups (tenant_id, year_id, grade_id, stream_id, class_teacher_id)
		 SELECT cg.tenant_id, $3, cg.grade_id, cg.stream_id, cg.class_teacher_id
		 FROM class_groups cg
		 WHERE cg.tenant_id = $1 AND cg.year_id = $2`+gradeFilter+`
		 ON CONFLICT DO NOTHING`,
		args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	copied, _ := result.RowsAffected()
	c.JSON(http.StatusOK, gin.H{"copied": copied})
}

// ---------- helpers ----------

func isUniqueViolation(err error) bool {
	return err != nil && strings.Contains(err.Error(), "duplicate key value")
}

func isForeignKeyViolation(err error) bool {
	return err != nil && strings.Contains(err.Error(), "foreign key constraint")
}

var _ = sql.ErrNoRows

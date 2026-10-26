package assessment

import (
	"database/sql"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
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

// AssessmentEvent
type AssessmentEvent struct {
	EventID            string  `json:"event_id"`
	TenantID           string  `json:"tenant_id"`
	TermID             string  `json:"term_id"`
	GradeID            string  `json:"grade_id"`
	LearningAreaID     string  `json:"learning_area_id"`
	AssessmentType     string  `json:"assessment_type"`
	ScoringMode        string  `json:"scoring_mode"`
	AssessmentWindow   string  `json:"assessment_window"`
	WeightingProfileID string  `json:"weighting_profile_id,omitempty"`
	Status             string  `json:"status"`
	MaxScore           float64 `json:"max_score,omitempty"`
	CreatedBy          string  `json:"created_by,omitempty"`
	CreatedAt          string  `json:"created_at"`
	UpdatedAt          string  `json:"updated_at"`
}

func (h *Handler) ListAssessmentEvents(c *gin.Context) {

	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	tenantID := c.GetString("tenant_id")
	rows, err := tx.Query(
		`SELECT event_id, tenant_id, term_id, grade_id, learning_area_id,
			assessment_type, scoring_mode, assessment_window, weighting_profile_id,
			status, max_score, created_by, created_at, updated_at
		 FROM assessment_events WHERE tenant_id = $1 ORDER BY created_at DESC`,
		tenantID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	var events []AssessmentEvent
	for rows.Next() {
		var e AssessmentEvent
		if err := rows.Scan(&e.EventID, &e.TenantID, &e.TermID, &e.GradeID, &e.LearningAreaID,
			&e.AssessmentType, &e.ScoringMode, &e.AssessmentWindow, &e.WeightingProfileID,
			&e.Status, &e.MaxScore, &e.CreatedBy, &e.CreatedAt, &e.UpdatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		events = append(events, e)
	}
	c.JSON(http.StatusOK, events)
}

func (h *Handler) GetAssessmentEvent(c *gin.Context) {

	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	tenantID := c.GetString("tenant_id")
	eventID := c.Param("event_id")
	var e AssessmentEvent
	err := tx.QueryRow(
		`SELECT event_id, tenant_id, term_id, grade_id, learning_area_id,
			assessment_type, scoring_mode, assessment_window, weighting_profile_id,
			status, max_score, created_by, created_at, updated_at
		 FROM assessment_events WHERE tenant_id = $1 AND event_id = $2`,
		tenantID, eventID,
	).Scan(&e.EventID, &e.TenantID, &e.TermID, &e.GradeID, &e.LearningAreaID,
		&e.AssessmentType, &e.ScoringMode, &e.AssessmentWindow, &e.WeightingProfileID,
		&e.Status, &e.MaxScore, &e.CreatedBy, &e.CreatedAt, &e.UpdatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"code": "NOT_FOUND", "message": "Assessment event not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, e)
}

// AssessmentResult
type AssessmentResult struct {
	ResultID    string  `json:"result_id"`
	TenantID    string  `json:"tenant_id"`
	EventID     string  `json:"event_id"`
	LearnerID   string  `json:"learner_id"`
	SubStrandID string  `json:"sub_strand_id,omitempty"`
	LevelCode   string  `json:"level_code,omitempty"`
	Points      float64 `json:"points,omitempty"`
	RawScore    float64 `json:"raw_score,omitempty"`
	MaxScore    float64 `json:"max_score,omitempty"`
	TeacherID   string  `json:"teacher_id,omitempty"`
	Remarks     string  `json:"remarks,omitempty"`
	ClientUUID  string  `json:"client_uuid,omitempty"`
	Version     int     `json:"version"`
	State       string  `json:"state"`
	DeviceID    string  `json:"device_id,omitempty"`
	ClientTS    string  `json:"client_ts,omitempty"`
	ServerTS    string  `json:"server_ts"`
}

func (h *Handler) ListAssessmentResults(c *gin.Context) {

	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	tenantID := c.GetString("tenant_id")
	eventID := c.Query("event_id")
	learnerID := c.Query("learner_id")

	query := `
		SELECT result_id, tenant_id, event_id, learner_id, sub_strand_id,
			level_code, points, raw_score, max_score, teacher_id, remarks,
			client_uuid, version, state, device_id, client_ts, server_ts
		 FROM assessment_results WHERE tenant_id = $1`
	args := []interface{}{tenantID}
	argIndex := 2

	if eventID != "" {
		query += fmt.Sprintf(" AND event_id = $%d", argIndex)
		args = append(args, eventID)
		argIndex++
	}
	if learnerID != "" {
		query += fmt.Sprintf(" AND learner_id = $%d", argIndex)
		args = append(args, learnerID)
		argIndex++
	}
	query += " ORDER BY server_ts DESC"

	rows, err := tx.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	var results []AssessmentResult
	for rows.Next() {
		var r AssessmentResult
		if err := rows.Scan(&r.ResultID, &r.TenantID, &r.EventID, &r.LearnerID, &r.SubStrandID,
			&r.LevelCode, &r.Points, &r.RawScore, &r.MaxScore, &r.TeacherID, &r.Remarks,
			&r.ClientUUID, &r.Version, &r.State, &r.DeviceID, &r.ClientTS, &r.ServerTS); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		results = append(results, r)
	}
	c.JSON(http.StatusOK, results)
}

func (h *Handler) GetAssessmentResult(c *gin.Context) {

	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	tenantID := c.GetString("tenant_id")
	resultID := c.Param("result_id")
	var r AssessmentResult
	err := tx.QueryRow(
		`SELECT result_id, tenant_id, event_id, learner_id, sub_strand_id,
			level_code, points, raw_score, max_score, teacher_id, remarks,
			client_uuid, version, state, device_id, client_ts, server_ts
		 FROM assessment_results WHERE tenant_id = $1 AND result_id = $2`,
		tenantID, resultID,
	).Scan(&r.ResultID, &r.TenantID, &r.EventID, &r.LearnerID, &r.SubStrandID,
		&r.LevelCode, &r.Points, &r.RawScore, &r.MaxScore, &r.TeacherID, &r.Remarks,
		&r.ClientUUID, &r.Version, &r.State, &r.DeviceID, &r.ClientTS, &r.ServerTS)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"code": "NOT_FOUND", "message": "Assessment result not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, r)
}

// WeightingProfile
type WeightingProfile struct {
	ProfileID   string `json:"profile_id"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	GradeID     string `json:"grade_id"`
	Weights     string `json:"weights"`
	IsDefault   bool   `json:"is_default"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
}

func (h *Handler) ListWeightingProfiles(c *gin.Context) {

	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	rows, err := tx.Query(
		`SELECT profile_id, name, description, grade_id, weights, is_default,
			created_at, updated_at
		 FROM weighting_profiles ORDER BY name`,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	var profiles []WeightingProfile
	for rows.Next() {
		var p WeightingProfile
		var weights []byte
		if err := rows.Scan(&p.ProfileID, &p.Name, &p.Description, &p.GradeID,
			&weights, &p.IsDefault, &p.CreatedAt, &p.UpdatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		p.Weights = string(weights)
		profiles = append(profiles, p)
	}
	c.JSON(http.StatusOK, profiles)
}

var _ = http.StatusOK

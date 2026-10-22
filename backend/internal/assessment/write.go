package assessment

import (
	"database/sql"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/validation"
)

// This file holds the write side of the assessment module: creating events,
// capturing results (single, batch and offline replay), and the moderation
// workflow. Every result write is idempotent on client_uuid so a teacher
// device can replay its offline queue without duplicating rows.

// Valid assessment result states, in workflow order.
const (
	StateDraft     = "DRAFT"
	StateSubmitted = "SUBMITTED"
	StateModerated = "MODERATED"
	StateLocked    = "LOCKED"
)

// Valid assessment event statuses.
const (
	EventDraft  = "DRAFT"
	EventOpen   = "OPEN"
	EventClosed = "CLOSED"
)

// ResultInput is one captured result. It accepts both the online shape
// (event_id + learner_id) and the offline shape (client_uuid + device_id).
type ResultInput struct {
	EventID     string  `json:"event_id"`
	LearnerID   string  `json:"learner_id"`
	SubStrandID string  `json:"sub_strand_id"`
	LevelCode   string  `json:"level_code"`
	Points      float64 `json:"points"`
	RawScore    float64 `json:"raw_score"`
	MaxScore    float64 `json:"max_score"`
	Remarks     string  `json:"remarks"`
	TeacherID   string  `json:"teacher_id"`
	ClientUUID  string  `json:"client_uuid"`
	Version     int     `json:"version"`
	State       string  `json:"state"`
	DeviceID    string  `json:"device_id"`
	ClientTS    string  `json:"client_ts"`
}

// UpsertResult inserts or updates a single result.
//
// The write path is a single UPSERT keyed on (tenant, event, learner,
// sub-strand). When the incoming row carries a client_uuid that already
// exists the stored row is updated instead — that is what makes an offline
// queue replay safe.
func (h *Handler) UpsertResult(c *gin.Context) {
	var input ResultInput
	if errs := validation.BindJSON(c, &input); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	if input.EventID == "" || input.LearnerID == "" {
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "event_id", Code: "REQUIRED", Message: "'event_id' is required"},
			{Field: "learner_id", Code: "REQUIRED", Message: "'learner_id' is required"},
		})
		return
	}
	if input.LevelCode != "" && !isValidLevel(input.LevelCode) {
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "level_code", Code: "INVALID_VALUE", Message: "'level_code' must be EE, ME, AE or BE"},
		})
		return
	}

	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")

	result, err := h.upsertResult(tenantID, userID, input)
	if err != nil {
		if err == errLocked {
			validation.Conflict(c, "This result is locked. Request a reopen before editing it.")
			return
		}
		if err == errForeignKey {
			validation.BadRequest(c, "Invalid request", []validation.FieldError{
				{Field: "result", Code: "INVALID_VALUE", Message: "event, learner or sub-strand does not exist"},
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, result)
}

// BatchUpsertResults accepts an array of results. Each entry is processed
// independently so one bad row does not fail the whole offline batch.
func (h *Handler) BatchUpsertResults(c *gin.Context) {
	var req struct {
		Results []ResultInput `json:"results"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	if len(req.Results) == 0 {
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "results", Code: "REQUIRED", Message: "'results' must contain at least one entry"},
		})
		return
	}

	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")

	saved := make([]gin.H, 0, len(req.Results))
	failed := make([]gin.H, 0)
	for _, input := range req.Results {
		result, err := h.upsertResult(tenantID, userID, input)
		if err != nil {
			failed = append(failed, gin.H{
				"client_uuid": input.ClientUUID,
				"learner_id":  input.LearnerID,
				"error":       err.Error(),
			})
			continue
		}
		saved = append(saved, result)
	}

	c.JSON(http.StatusOK, gin.H{
		"saved":   len(saved),
		"failed":  len(failed),
		"results": saved,
		"errors":  failed,
	})
}

var (
	errLocked     = &writeError{"result is locked"}
	errForeignKey = &writeError{"related record does not exist"}
)

type writeError struct{ msg string }

func (e *writeError) Error() string { return e.msg }

// upsertResult performs the actual insert/update and records history.
func (h *Handler) upsertResult(tenantID, userID string, input ResultInput) (gin.H, error) {
	state := strings.ToUpper(strings.TrimSpace(input.State))
	if state == "" {
		state = StateDraft
	}
	if state != StateDraft && state != StateSubmitted && state != StateModerated && state != StateLocked {
		return nil, &writeError{"invalid state " + state}
	}

	subStrand := interface{}(nil)
	if strings.TrimSpace(input.SubStrandID) != "" {
		subStrand = input.SubStrandID
	}
	clientUUID := interface{}(nil)
	if strings.TrimSpace(input.ClientUUID) != "" {
		clientUUID = input.ClientUUID
	}
	deviceID := interface{}(nil)
	if strings.TrimSpace(input.DeviceID) != "" {
		deviceID = input.DeviceID
	}
	clientTS := interface{}(nil)
	if strings.TrimSpace(input.ClientTS) != "" {
		clientTS = input.ClientTS
	}
	teacherID := interface{}(nil)
	if strings.TrimSpace(input.TeacherID) != "" {
		teacherID = input.TeacherID
	} else if userID != "" {
		teacherID = userID
	}
	maxScore := interface{}(nil)
	if input.MaxScore != 0 {
		maxScore = input.MaxScore
	}
	rawScore := interface{}(nil)
	if input.RawScore != 0 {
		rawScore = input.RawScore
	}
	points := interface{}(nil)
	if input.Points != 0 {
		points = input.Points
	}

	// Reject writes against a locked result: the spec requires an explicit
	// reopen before a moderated result can change.
	var existingState string
	var existingID string
	err := h.service.database.QueryRow(
		`SELECT result_id, state FROM assessment_results
		 WHERE tenant_id = $1 AND event_id = $2 AND learner_id = $3
		   AND COALESCE(sub_strand_id, '00000000-0000-0000-0000-000000000000'::uuid)
		     = COALESCE($4::uuid, '00000000-0000-0000-0000-000000000000'::uuid)`,
		tenantID, input.EventID, input.LearnerID, subStrand,
	).Scan(&existingID, &existingState)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	if err == nil && existingState == StateLocked {
		return nil, errLocked
	}

	var resultID string
	if existingID != "" {
		var version int
		var serverTS string
		err = h.service.database.QueryRow(
			`UPDATE assessment_results
			 SET level_code = $1, points = $2, raw_score = $3, max_score = $4,
			     remarks = $5, teacher_id = COALESCE($6, teacher_id),
			     state = $7, version = COALESCE(version, 0) + 1,
			     device_id = COALESCE($8, device_id),
			     client_ts = COALESCE($9, client_ts),
			     client_uuid = COALESCE($10, client_uuid),
			     server_ts = now()
			 WHERE result_id = $11
			 RETURNING result_id, state, version, server_ts`,
			nullableString(input.LevelCode), points, rawScore, maxScore,
			nullableString(input.Remarks), teacherID, state, deviceID, clientTS, clientUUID,
			existingID,
		).Scan(&resultID, &existingState, &version, &serverTS)
		if err != nil {
			if strings.Contains(err.Error(), "foreign key") {
				return nil, errForeignKey
			}
			return nil, err
		}
	} else {
		var version int
		var serverTS string
		err = h.service.database.QueryRow(
			`INSERT INTO assessment_results
			 (tenant_id, event_id, learner_id, sub_strand_id, level_code, points, raw_score,
			  max_score, remarks, teacher_id, client_uuid, version, state, device_id, client_ts)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
			 ON CONFLICT (tenant_id, client_uuid) WHERE client_uuid IS NOT NULL
			 DO UPDATE SET level_code = EXCLUDED.level_code, points = EXCLUDED.points,
			   raw_score = EXCLUDED.raw_score, max_score = EXCLUDED.max_score,
			   remarks = EXCLUDED.remarks, state = EXCLUDED.state,
			   version = assessment_results.version + 1, server_ts = now()
			 RETURNING result_id, state, version, server_ts`,
			tenantID, input.EventID, input.LearnerID, subStrand, nullableString(input.LevelCode),
			points, rawScore, maxScore, nullableString(input.Remarks), teacherID, clientUUID,
			input.Version, state, deviceID, clientTS,
		).Scan(&resultID, &existingState, &version, &serverTS)
		if err != nil {
			if strings.Contains(err.Error(), "foreign key") {
				return nil, errForeignKey
			}
			return nil, err
		}
	}

	// Append-only history for every change.
	_, _ = h.service.database.Exec(
		`INSERT INTO assessment_result_history
		 (tenant_id, result_id, event_id, learner_id, sub_strand_id, level_code, points,
		  raw_score, max_score, state, changed_by)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
		tenantID, resultID, input.EventID, input.LearnerID, subStrand,
		nullableString(input.LevelCode), points, rawScore, maxScore, state, nullableString(userID))

	return gin.H{
		"result_id":  resultID,
		"event_id":   input.EventID,
		"learner_id": input.LearnerID,
		"state":      existingState,
	}, nil
}

// CreateAssessmentEvent creates a new assessment event.
func (h *Handler) CreateAssessmentEvent(c *gin.Context) {
	var req struct {
		TermID             string  `json:"term_id" binding:"required"`
		GradeID            string  `json:"grade_id" binding:"required"`
		LearningAreaID     string  `json:"learning_area_id" binding:"required"`
		AssessmentType     string  `json:"assessment_type" binding:"required"`
		ScoringMode        string  `json:"scoring_mode" binding:"required"`
		AssessmentWindow   string  `json:"assessment_window" binding:"required"`
		WeightingProfileID string  `json:"weighting_profile_id"`
		MaxScore           float64 `json:"max_score"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}

	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")

	maxScore := interface{}(nil)
	if req.MaxScore != 0 {
		maxScore = req.MaxScore
	}
	profileID := interface{}(nil)
	if strings.TrimSpace(req.WeightingProfileID) != "" {
		profileID = req.WeightingProfileID
	}

	var eventID string
	err := h.service.database.QueryRow(
		`INSERT INTO assessment_events
		 (tenant_id, term_id, grade_id, learning_area_id, assessment_type, scoring_mode,
		  assessment_window, weighting_profile_id, status, max_score, created_by)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		 RETURNING event_id`,
		tenantID, req.TermID, req.GradeID, req.LearningAreaID, req.AssessmentType,
		req.ScoringMode, req.AssessmentWindow, profileID, EventDraft, maxScore,
		nullableString(userID),
	).Scan(&eventID)
	if err != nil {
		if strings.Contains(err.Error(), "foreign key") {
			validation.BadRequest(c, "Invalid request", []validation.FieldError{
				{Field: "event", Code: "INVALID_VALUE", Message: "term, grade or learning area does not exist"},
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"event_id": eventID})
}

// UpdateAssessmentEvent edits an event or changes its status.
//
// Opening an event requires a teacher to be allocated to that class and
// learning area (R-STF-01); closing moves every submitted result to LOCKED.
func (h *Handler) UpdateAssessmentEvent(c *gin.Context) {
	eventID := c.Param("event_id")
	var req struct {
		AssessmentType     string  `json:"assessment_type"`
		ScoringMode        string  `json:"scoring_mode"`
		AssessmentWindow   string  `json:"assessment_window"`
		WeightingProfileID string  `json:"weighting_profile_id"`
		MaxScore           float64 `json:"max_score"`
		Status             string  `json:"status"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}

	tenantID := c.GetString("tenant_id")
	status := strings.ToUpper(strings.TrimSpace(req.Status))

	if status != "" && status != EventDraft && status != EventOpen && status != EventClosed {
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "status", Code: "INVALID_VALUE", Message: "'status' must be DRAFT, OPEN or CLOSED"},
		})
		return
	}

	if status == EventOpen {
		var allocated int
		err := h.service.database.QueryRow(
			`SELECT COUNT(*)
			 FROM assessment_events ae
			 JOIN learning_areas la ON la.area_id = ae.learning_area_id
			 JOIN class_groups cg ON cg.grade_id = ae.grade_id AND cg.tenant_id = ae.tenant_id
			 JOIN teaching_assignments ta ON ta.class_group_id = cg.class_group_id AND ta.tenant_id = ae.tenant_id
			 WHERE ae.event_id = $1 AND ae.tenant_id = $2
			   AND (ta.subject_id = la.code OR ta.subject_id = la.area_id::text)`,
			eventID, tenantID).Scan(&allocated)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		if allocated == 0 {
			validation.Conflict(c, "Assign a teacher to this class and learning area before opening the event")
			return
		}
	}

	sets := []string{"updated_at = now()"}
	args := []interface{}{}
	add := func(fragment string, value interface{}) {
		args = append(args, value)
		sets = append(sets, fmt.Sprintf("%s = $%d", fragment, len(args)))
	}
	if req.AssessmentType != "" {
		add("assessment_type", req.AssessmentType)
	}
	if req.ScoringMode != "" {
		add("scoring_mode", req.ScoringMode)
	}
	if req.AssessmentWindow != "" {
		add("assessment_window", req.AssessmentWindow)
	}
	if strings.TrimSpace(req.WeightingProfileID) != "" {
		add("weighting_profile_id", req.WeightingProfileID)
	}
	if req.MaxScore != 0 {
		add("max_score", req.MaxScore)
	}
	if status != "" {
		add("status", status)
	}
	args = append(args, eventID, tenantID)

	result, err := h.service.database.Exec(
		`UPDATE assessment_events SET `+strings.Join(sets, ", ")+` WHERE event_id = $`+strconv.Itoa(len(args)-1)+` AND tenant_id = $`+strconv.Itoa(len(args)),
		args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		validation.NotFound(c, "Assessment event not found")
		return
	}

	// Closing an event locks the results that were submitted.
	if status == EventClosed {
		_, _ = h.service.database.Exec(
			`UPDATE assessment_results SET state = $1, server_ts = now()
			 WHERE tenant_id = $2 AND event_id = $3 AND state IN ($4, $5)`,
			StateLocked, tenantID, eventID, StateSubmitted, StateModerated)
	}

	c.JSON(http.StatusOK, gin.H{"event_id": eventID, "status": status})
}

// ReopenResult moves a moderated or locked result back to DRAFT. A reason is
// required and the action is audited.
func (h *Handler) ReopenResult(c *gin.Context) {
	resultID := c.Param("result_id")
	var req struct {
		Reason string `json:"reason" binding:"required"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}

	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")

	var state string
	var eventID, learnerID string
	err := h.service.database.QueryRow(
		`UPDATE assessment_results SET state = $1, version = COALESCE(version, 0) + 1, server_ts = now()
		 WHERE result_id = $2 AND tenant_id = $3
		 RETURNING state, event_id, learner_id`,
		StateDraft, resultID, tenantID).Scan(&state, &eventID, &learnerID)
	if err == sql.ErrNoRows {
		validation.NotFound(c, "Assessment result not found")
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}

	_, _ = h.service.database.Exec(
		`INSERT INTO assessment_result_history
		 (tenant_id, result_id, event_id, learner_id, state, changed_by, change_reason)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		tenantID, resultID, eventID, learnerID, StateDraft, nullableString(userID), req.Reason)

	c.JSON(http.StatusOK, gin.H{"result_id": resultID, "state": state})
}

// ModerationQueue lists results waiting for moderation.
func (h *Handler) ModerationQueue(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	rows, err := h.service.database.Query(
		`SELECT ar.result_id, ar.event_id, ar.learner_id, l.first_name, l.last_name,
			ae.assessment_type, cg.grade_id, g.grade_label, cg.stream_id, s.stream_name,
			ar.level_code, ar.state, ar.remarks, ar.server_ts
		 FROM assessment_results ar
		 JOIN assessment_events ae ON ae.event_id = ar.event_id
		 JOIN learners l ON l.learner_id = ar.learner_id
		 LEFT JOIN class_groups cg ON cg.grade_id = ae.grade_id AND cg.tenant_id = ar.tenant_id
		 LEFT JOIN grades g ON g.grade_id = cg.grade_id
		 LEFT JOIN streams s ON s.stream_id = cg.stream_id
		 WHERE ar.tenant_id = $1 AND ar.state = $2
		 ORDER BY ae.assessment_type, l.last_name`,
		tenantID, StateSubmitted)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	type row struct {
		ResultID       string `json:"result_id"`
		EventID        string `json:"event_id"`
		LearnerID      string `json:"learner_id"`
		LearnerName    string `json:"learner_name"`
		AssessmentType string `json:"assessment_type"`
		GradeLabel     string `json:"grade_label"`
		StreamName     string `json:"stream_name"`
		LevelCode      string `json:"level_code"`
		State          string `json:"state"`
		Remarks        string `json:"remarks"`
		UpdatedAt      string `json:"updated_at"`
	}
	items := make([]row, 0)
	for rows.Next() {
		var r row
		var learnerName, gradeLabel, streamName, levelCode, remarks sql.NullString
		if err := rows.Scan(&r.ResultID, &r.EventID, &r.LearnerID, &learnerName,
			&r.AssessmentType, &gradeLabel, &streamName, &levelCode, &r.State,
			&remarks, &r.UpdatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		r.LearnerName = strings.TrimSpace(learnerName.String + " " + learnerName.String)
		r.GradeLabel = gradeLabel.String
		r.StreamName = streamName.String
		r.LevelCode = levelCode.String
		r.Remarks = remarks.String
		items = append(items, r)
	}
	c.JSON(http.StatusOK, items)
}

// ModerateResults moves submitted results to MODERATED (or LOCKED).
func (h *Handler) ModerateResults(c *gin.Context) {
	var req struct {
		ResultIDs []string `json:"result_ids" binding:"required"`
		State     string   `json:"state"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	state := strings.ToUpper(strings.TrimSpace(req.State))
	if state != StateModerated && state != StateLocked {
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "state", Code: "INVALID_VALUE", Message: "'state' must be MODERATED or LOCKED"},
		})
		return
	}

	tenantID := c.GetString("tenant_id")
	result, err := h.service.database.Exec(
		`UPDATE assessment_results SET state = $1, server_ts = now()
		 WHERE tenant_id = $2 AND result_id = ANY($3) AND state IN ($4, $5)`,
		state, tenantID, req.ResultIDs, StateSubmitted, StateModerated)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	updated, _ := result.RowsAffected()
	c.JSON(http.StatusOK, gin.H{"updated": updated})
}

// EventGrid returns the learners in the event's class together with the
// sub-strands to grade and the results already captured.
func (h *Handler) EventGrid(c *gin.Context) {
	eventID := c.Param("event_id")
	tenantID := c.GetString("tenant_id")

	var gradeID, areaID, termID string
	err := h.service.database.QueryRow(
		`SELECT grade_id, learning_area_id::text, term_id::text FROM assessment_events
		 WHERE event_id = $1 AND tenant_id = $2`, eventID, tenantID).Scan(&gradeID, &areaID, &termID)
	if err == sql.ErrNoRows {
		validation.NotFound(c, "Assessment event not found")
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}

	type subStrand struct {
		SubStrandID string `json:"sub_strand_id"`
		Code        string `json:"code"`
		Name        string `json:"name"`
	}
	subStrands := make([]subStrand, 0)
	rows, err := h.service.database.Query(
		`SELECT ss.sub_strand_id, ss.code, ss.name
		 FROM sub_strands ss
		 JOIN strands st ON st.strand_id = ss.strand_id
		 WHERE st.area_id = $1 ORDER BY st.sort_order, ss.sort_order`, areaID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	for rows.Next() {
		var s subStrand
		if err := rows.Scan(&s.SubStrandID, &s.Code, &s.Name); err != nil {
			rows.Close()
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		subStrands = append(subStrands, s)
	}
	rows.Close()

	type learnerCell struct {
		LearnerID   string  `json:"learner_id"`
		LearnerName string  `json:"learner_name"`
		AdmissionNo string  `json:"admission_number"`
		Results     []gin.H `json:"results"`
	}
	learners := make([]learnerCell, 0)
	rows, err = h.service.database.Query(
		`SELECT l.learner_id, l.first_name, l.last_name, l.admission_number
		 FROM learners l
		 JOIN enrolments e ON e.learner_id = l.learner_id AND e.status = 'ACTIVE'
		 JOIN class_groups cg ON cg.class_group_id = e.class_group_id
		 WHERE l.tenant_id = $1 AND cg.grade_id = $2 AND l.status = 'ACTIVE'
		 ORDER BY l.last_name, l.first_name`, tenantID, gradeID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	for rows.Next() {
		var learnerID, firstName, lastName, admissionNo string
		if err := rows.Scan(&learnerID, &firstName, &lastName, &admissionNo); err != nil {
			rows.Close()
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		learners = append(learners, learnerCell{
			LearnerID:   learnerID,
			LearnerName: strings.TrimSpace(firstName + " " + lastName),
			AdmissionNo: admissionNo,
			Results:     []gin.H{},
		})
	}
	rows.Close()

	// Attach captured results to the matching learner.
	if len(learners) > 0 {
		index := make(map[string]int, len(learners))
		for i := range learners {
			index[learners[i].LearnerID] = i
		}
		resultRows, err := h.service.database.Query(
			`SELECT learner_id, sub_strand_id::text, level_code, points, raw_score, max_score,
				remarks, state, version
			 FROM assessment_results WHERE tenant_id = $1 AND event_id = $2`, tenantID, eventID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		defer resultRows.Close()
		for resultRows.Next() {
			var learnerID, subStrandID string
			var levelCode, remarks sql.NullString
			var points, rawScore, maxScore sql.NullFloat64
			var state string
			var version int
			if err := resultRows.Scan(&learnerID, &subStrandID, &levelCode, &points,
				&rawScore, &maxScore, &remarks, &state, &version); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
				return
			}
			i, ok := index[learnerID]
			if !ok {
				continue
			}
			learners[i].Results = append(learners[i].Results, gin.H{
				"sub_strand_id": subStrandID,
				"level_code":    levelCode.String,
				"points":        points.Float64,
				"raw_score":     rawScore.Float64,
				"max_score":     maxScore.Float64,
				"remarks":       remarks.String,
				"state":         state,
				"version":       version,
			})
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"event_id":    eventID,
		"grade_id":    gradeID,
		"sub_strands": subStrands,
		"learners":    learners,
	})
}

// UpsertLearnerRemark stores the class teacher's remark for a learner on an
// assessment event.
func (h *Handler) UpsertLearnerRemark(c *gin.Context) {
	learnerID := c.Param("id")
	var req struct {
		EventID    string `json:"event_id" binding:"required"`
		Remark     string `json:"remark_text" binding:"required"`
		RemarkType string `json:"remark_type"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")

	remarkType := strings.ToUpper(strings.TrimSpace(req.RemarkType))
	if remarkType == "" {
		remarkType = "GENERAL"
	}

	var remarkID string
	err := h.service.database.QueryRow(
		`INSERT INTO learner_remarks (tenant_id, event_id, learner_id, remark_text, remark_type, created_by)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 ON CONFLICT (tenant_id, event_id, learner_id)
		 DO UPDATE SET remark_text = EXCLUDED.remark_text, remark_type = EXCLUDED.remark_type, updated_at = now()
		 RETURNING remark_id`,
		tenantID, req.EventID, learnerID, req.Remark, remarkType, nullableString(userID),
	).Scan(&remarkID)
	if err != nil {
		if strings.Contains(err.Error(), "foreign key") {
			validation.BadRequest(c, "Invalid request", []validation.FieldError{
				{Field: "learner_id", Code: "INVALID_VALUE", Message: "learner or event does not exist"},
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"remark_id": remarkID})
}

// UpsertCompetency records a competency rating against a captured result.
func (h *Handler) UpsertCompetency(c *gin.Context) {
	var req struct {
		ResultID       string `json:"result_id" binding:"required"`
		CompetencyCode string `json:"competency_code" binding:"required"`
		RatingLevel    string `json:"rating_level" binding:"required"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	if !isValidLevel(req.RatingLevel) {
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "rating_level", Code: "INVALID_VALUE", Message: "'rating_level' must be EE, ME, AE or BE"},
		})
		return
	}
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")

	var ratingID string
	err := h.service.database.QueryRow(
		`INSERT INTO competency_ratings (tenant_id, result_id, competency_code, rating_level, rated_by)
		 VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (tenant_id, result_id, competency_code)
		 DO UPDATE SET rating_level = EXCLUDED.rating_level, rated_by = EXCLUDED.rated_by, rated_at = now()
		 RETURNING rating_id`,
		tenantID, req.ResultID, req.CompetencyCode, strings.ToUpper(req.RatingLevel), nullableString(userID),
	).Scan(&ratingID)
	if err != nil {
		if strings.Contains(err.Error(), "foreign key") {
			validation.BadRequest(c, "Invalid request", []validation.FieldError{
				{Field: "competency", Code: "INVALID_VALUE", Message: "result does not exist"},
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"rating_id": ratingID})
}

// CreateEvidence records an evidence file attached to a captured result.
func (h *Handler) CreateEvidence(c *gin.Context) {
	var req struct {
		ResultID string `json:"result_id" binding:"required"`
		FileName string `json:"file_name" binding:"required"`
		FileRef  string `json:"file_ref" binding:"required"`
		MimeType string `json:"mime_type" binding:"required"`
		FileSize int    `json:"file_size"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")

	var evidenceID string
	err := h.service.database.QueryRow(
		`INSERT INTO evidence_files
		 (tenant_id, result_id, file_ref, file_name, mime_type, file_size, uploaded_by)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 RETURNING evidence_id`,
		tenantID, req.ResultID, req.FileRef, req.FileName, req.MimeType, req.FileSize,
		nullableString(userID),
	).Scan(&evidenceID)
	if err != nil {
		if strings.Contains(err.Error(), "foreign key") {
			validation.BadRequest(c, "Invalid request", []validation.FieldError{
				{Field: "evidence", Code: "INVALID_VALUE", Message: "result does not exist"},
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"evidence_id": evidenceID})
}

// ---------- helpers ----------

func isValidLevel(level string) bool {
	switch strings.ToUpper(level) {
	case "EE", "ME", "AE", "BE":
		return true
	}
	return false
}

func nullableString(s string) interface{} {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

func nullableStrings(values []string) interface{} {
	if len(values) == 0 {
		return nil
	}
	return values
}

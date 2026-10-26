package attendance

import (
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"context"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/validation"
)

// This file adds the write side of attendance: opening a register, capturing
// marks (single, batch and offline replay) and the gate configuration the
// kiosk relies on.

// MarkInput is one attendance mark captured by a teacher.
type MarkInput struct {
	RegisterID string `json:"register_id"`
	LearnerID  string `json:"learner_id"`
	Status     string `json:"status"`
	Notes      string `json:"notes"`
	ClientUUID string `json:"client_uuid"`
	DeviceID   string `json:"device_id"`
	ClientTS   string `json:"client_ts"`
}

var validMarkStatuses = map[string]bool{
	"PRESENT": true,
	"ABSENT":  true,
	"LATE":    true,
	"EXCUSED": true,
}

// CreateRegister opens an attendance register for a class group.
func (h *Handler) CreateRegister(c *gin.Context) {
	var q queryer = h.service.database
	if t := middleware.TxFromGin(c); t != nil { q = t }
	var req struct {
		ClassGroupID   string `json:"class_group_id" binding:"required"`
		AcademicYearID string `json:"academic_year_id" binding:"required"`
		TermID         string `json:"term_id" binding:"required"`
		RegisterDate   string `json:"register_date" binding:"required"`
		SessionType    string `json:"session_type"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	sessionType := strings.ToUpper(strings.TrimSpace(req.SessionType))
	if sessionType == "" {
		sessionType = "MORNING"
	}
	if sessionType != "MORNING" && sessionType != "AFTERNOON" && sessionType != "EVENING" {
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "session_type", Code: "INVALID_VALUE", Message: "'session_type' must be MORNING, AFTERNOON or EVENING"},
		})
		return
	}

	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")

	var registerID string
	err := q.QueryRow(
		`INSERT INTO attendance_registers
		 (tenant_id, class_group_id, grade_id, stream_id, academic_year_id, term_id, register_date, session_type, marked_by)
		 SELECT $1::varchar, cg.class_group_id, cg.grade_id, cg.stream_id, $3::uuid, $4::uuid, $5::date, $6::varchar, $7::uuid
		 FROM class_groups cg
		 WHERE cg.class_group_id = $2::uuid AND cg.tenant_id = $1::varchar
		 RETURNING register_id`,
		tenantID, req.ClassGroupID, req.AcademicYearID, req.TermID, req.RegisterDate, sessionType, nullableString(userID),
	).Scan(&registerID)
	if err == sql.ErrNoRows {
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "class_group_id", Code: "INVALID_VALUE", Message: "class group does not exist"},
		})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"register_id": registerID})
}

// UpdateRegister changes the status of a register (OPEN -> CLOSED).
func (h *Handler) UpdateRegister(c *gin.Context) {
	var q queryer = h.service.database
	if t := middleware.TxFromGin(c); t != nil { q = t }
	registerID := c.Param("register_id")
	var req struct {
		Status string `json:"status" binding:"required"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	status := strings.ToUpper(strings.TrimSpace(req.Status))
	if status != "OPEN" && status != "CLOSED" {
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "status", Code: "INVALID_VALUE", Message: "'status' must be OPEN or CLOSED"},
		})
		return
	}

	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")
	result, err := q.Exec(
		`UPDATE attendance_registers SET status = $1, marked_by = COALESCE($2, marked_by), marked_at = now(), updated_at = now()
		 WHERE register_id = $3 AND tenant_id = $4`, status, nullableString(userID), registerID, tenantID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		validation.NotFound(c, "Attendance register not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"register_id": registerID, "status": status})
}

// UpsertMark records one attendance mark. Replaying the same client_uuid
// updates the existing mark instead of creating a second one.
func (h *Handler) UpsertMark(c *gin.Context) {
	var input MarkInput
	if errs := validation.BindJSON(c, &input); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	if errs := validateMark(input); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}

	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")
	saved, err := h.upsertMark(c.Request.Context(), tenantID, userID, input)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, saved)
}

// BatchUpsertMarks accepts an array of marks; used by the offline queue.
func (h *Handler) BatchUpsertMarks(c *gin.Context) {
	var req struct {
		Marks []MarkInput `json:"marks"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	if len(req.Marks) == 0 {
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "marks", Code: "REQUIRED", Message: "'marks' must contain at least one entry"},
		})
		return
	}

	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")

	saved := make([]gin.H, 0, len(req.Marks))
	failed := make([]gin.H, 0)
	for _, input := range req.Marks {
		if errs := validateMark(input); errs != nil {
			failed = append(failed, gin.H{
				"client_uuid": input.ClientUUID,
				"learner_id":  input.LearnerID,
				"error":       "invalid mark",
			})
			continue
		}
		result, err := h.upsertMark(c.Request.Context(), tenantID, userID, input)
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
		"saved":  len(saved),
		"failed": len(failed),
		"marks":  saved,
		"errors": failed,
	})
}

func (h *Handler) upsertMark(ctx context.Context, tenantID, userID string, input MarkInput) (gin.H, error) {
	var q queryer = h.service.database
	if t := middleware.TxFromContext(ctx); t != nil { q = t }
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

	var markID string
	err := q.QueryRow(
		`INSERT INTO attendance_marks
		 (tenant_id, register_id, learner_id, status, marked_by, notes, client_uuid, device_id, client_ts)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		 ON CONFLICT (tenant_id, client_uuid) WHERE client_uuid IS NOT NULL
		 DO UPDATE SET status = EXCLUDED.status, notes = EXCLUDED.notes, updated_at = now()
		 RETURNING mark_id`,
		tenantID, input.RegisterID, input.LearnerID, strings.ToUpper(input.Status),
		nullableString(userID), nullableString(input.Notes), clientUUID, deviceID, clientTS,
	).Scan(&markID)
	if err != nil {
		return nil, err
	}

	// A teacher re-marking a learner in the same register replaces the
	// previous mark rather than accumulating rows.
	_, err = q.Exec(
		`UPDATE attendance_marks SET status = $1, marked_by = $2, marked_at = now(), updated_at = now()
		 WHERE tenant_id = $3 AND register_id = $4 AND learner_id = $5 AND mark_id <> $6`,
		strings.ToUpper(input.Status), nullableString(userID), tenantID,
		input.RegisterID, input.LearnerID, markID)
	if err != nil {
		return nil, err
	}

	return gin.H{
		"mark_id":     markID,
		"register_id": input.RegisterID,
		"learner_id":  input.LearnerID,
		"status":      strings.ToUpper(input.Status),
	}, nil
}

func validateMark(input MarkInput) []validation.FieldError {
	errs := []validation.FieldError{}
	if strings.TrimSpace(input.RegisterID) == "" {
		errs = append(errs, validation.FieldError{Field: "register_id", Code: "REQUIRED", Message: "'register_id' is required"})
	}
	if strings.TrimSpace(input.LearnerID) == "" {
		errs = append(errs, validation.FieldError{Field: "learner_id", Code: "REQUIRED", Message: "'learner_id' is required"})
	}
	if !validMarkStatuses[strings.ToUpper(strings.TrimSpace(input.Status))] {
		errs = append(errs, validation.FieldError{Field: "status", Code: "INVALID_VALUE", Message: "'status' must be PRESENT, ABSENT, LATE or EXCUSED"})
	}
	return errs
}

// AttendanceSummary aggregates a register so the UI can show counts without
// downloading every mark.
func (h *Handler) AttendanceSummary(c *gin.Context) {
	var q queryer = h.service.database
	if t := middleware.TxFromGin(c); t != nil { q = t }
	tenantID := c.GetString("tenant_id")
	registerID := c.Query("register_id")

	query := `
		SELECT am.status, COUNT(*)
		FROM attendance_marks am
		WHERE am.tenant_id = $1`
	args := []interface{}{tenantID}
	if registerID != "" {
		query += " AND am.register_id = $2"
		args = append(args, registerID)
	}
	query += " GROUP BY am.status"

	rows, err := q.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	counts := map[string]int{"PRESENT": 0, "ABSENT": 0, "LATE": 0, "EXCUSED": 0}
	total := 0
	for rows.Next() {
		var status string
		var count int
		if err := rows.Scan(&status, &count); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		counts[status] = count
		total += count
	}
	c.JSON(http.StatusOK, gin.H{"counts": counts, "total": total})
}

// ---------- Gate configuration ----------

// GatePolicy is stored in school_settings so it is tenant-scoped and
// versioned like every other school setting.
type GatePolicy struct {
	ArrearsDenialEnabled bool `json:"arrears_denial_enabled"`
	RequirePhotoConsent  bool `json:"require_photo_consent"`
	OfflineGraceMinutes  int  `json:"offline_grace_minutes"`
	NotifyGuardians      bool `json:"notify_guardians"`
}

func (h *Handler) GetGatePolicy(c *gin.Context) {
	var q queryer = h.service.database
	if t := middleware.TxFromGin(c); t != nil { q = t }
	tenantID := c.GetString("tenant_id")
	policy := GatePolicy{OfflineGraceMinutes: 1440}

	var raw []byte
	err := q.QueryRow(
		`SELECT setting_value FROM school_settings WHERE tenant_id = $1 AND setting_key = 'gate_policy'`,
		tenantID).Scan(&raw)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusOK, policy)
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	_ = json.Unmarshal(raw, &policy)
	if policy.OfflineGraceMinutes == 0 {
		policy.OfflineGraceMinutes = 1440
	}
	c.JSON(http.StatusOK, policy)
}

func (h *Handler) UpdateGatePolicy(c *gin.Context) {
	var q queryer = h.service.database
	if t := middleware.TxFromGin(c); t != nil { q = t }
	var policy GatePolicy
	if errs := validation.BindJSON(c, &policy); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")

	raw, err := json.Marshal(policy)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	_, err = q.Exec(
		`INSERT INTO school_settings (tenant_id, setting_key, setting_value, updated_by)
		 VALUES ($1, 'gate_policy', $2::jsonb, $3)
		 ON CONFLICT (tenant_id, setting_key)
		 DO UPDATE SET setting_value = EXCLUDED.setting_value, version = school_settings.version + 1, updated_by = EXCLUDED.updated_by, updated_at = now()`,
		tenantID, string(raw), nullableString(userID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, policy)
}

// PairDevice registers a kiosk and returns its pairing code.
func (h *Handler) PairDevice(c *gin.Context) {
	var q queryer = h.service.database
	if t := middleware.TxFromGin(c); t != nil { q = t }
	var req struct {
		DeviceName string `json:"device_name" binding:"required"`
		DeviceType string `json:"device_type"`
		Location   string `json:"location"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	deviceType := strings.ToUpper(strings.TrimSpace(req.DeviceType))
	if deviceType == "" {
		deviceType = "KIOSK"
	}
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")

	code := randomPairingCode()
	var deviceID string
	err := q.QueryRow(
		`INSERT INTO gate_devices (tenant_id, device_name, device_type, location, pairing_code, is_paired, paired_by, paired_at)
		 VALUES ($1, $2, $3, $4, $5, true, $6, now())
		 RETURNING device_id`,
		tenantID, req.DeviceName, deviceType, nullableString(req.Location), code, nullableString(userID),
	).Scan(&deviceID)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate key value") {
			validation.Conflict(c, "A device with that name already exists")
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"device_id": deviceID, "pairing_code": code})
}

// IssueTag assigns an RFID tag to a learner or staff member.
func (h *Handler) IssueTag(c *gin.Context) {
	var q queryer = h.service.database
	if t := middleware.TxFromGin(c); t != nil { q = t }
	var req struct {
		TagUID     string `json:"tag_uid" binding:"required"`
		HolderType string `json:"holder_type" binding:"required"`
		HolderID   string `json:"holder_id" binding:"required"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	holderType := strings.ToUpper(strings.TrimSpace(req.HolderType))
	if holderType != "LEARNER" && holderType != "STAFF" && holderType != "GUARDIAN" {
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "holder_type", Code: "INVALID_VALUE", Message: "'holder_type' must be LEARNER, STAFF or GUARDIAN"},
		})
		return
	}
	tenantID := c.GetString("tenant_id")

	var tagID string
	err := q.QueryRow(
		`INSERT INTO rfid_tags (tenant_id, tag_uid, holder_type, holder_id)
		 VALUES ($1, $2, $3, $4) RETURNING tag_id`,
		tenantID, req.TagUID, holderType, req.HolderID).Scan(&tagID)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate key value") {
			validation.Conflict(c, "That tag UID is already issued")
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"tag_id": tagID})
}

// DeactivateTag retires a tag without deleting its history.
func (h *Handler) DeactivateTag(c *gin.Context) {
	var q queryer = h.service.database
	if t := middleware.TxFromGin(c); t != nil { q = t }
	tagID := c.Param("id")
	tenantID := c.GetString("tenant_id")
	result, err := q.Exec(
		`UPDATE rfid_tags SET is_active = false, deactivated_at = now(), updated_at = now()
		 WHERE tag_id = $1 AND tenant_id = $2`, tagID, tenantID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		validation.NotFound(c, "Tag not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"tag_id": tagID, "is_active": false})
}

// RecordGateEvents stores a batch of scans replayed from an offline kiosk.
func (h *Handler) RecordGateEvents(c *gin.Context) {
	var q queryer = h.service.database
	if t := middleware.TxFromGin(c); t != nil { q = t }
	var req struct {
		Events []struct {
			DeviceID   string         `json:"device_id" binding:"required"`
			TagUID     string         `json:"tag_uid"`
			EventType  string         `json:"event_type" binding:"required"`
			EventTS    string         `json:"event_ts"`
			RawPayload map[string]any `json:"raw_payload"`
		} `json:"events" binding:"required"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	tenantID := c.GetString("tenant_id")

	accepted := 0
	for _, e := range req.Events {
		var tagID interface{}
		if strings.TrimSpace(e.TagUID) != "" {
			var id string
			if err := q.QueryRow(
				`SELECT tag_id FROM rfid_tags WHERE tenant_id = $1 AND tag_uid = $2`,
				tenantID, e.TagUID).Scan(&id); err == nil {
				tagID = id
			}
		}
		raw, _ := json.Marshal(e.RawPayload)
		_, err := q.Exec(
			`INSERT INTO gate_events (tenant_id, device_id, tag_id, event_type, event_ts, raw_payload)
			 VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, now()), $6::jsonb)`,
			tenantID, e.DeviceID, tagID, strings.ToUpper(e.EventType), nullableString(e.EventTS), string(raw))
		if err != nil {
			continue
		}
		accepted++
	}
	c.JSON(http.StatusOK, gin.H{"accepted": accepted, "received": len(req.Events)})
}

// OverrideGate records a manual gate entry made by a clerk.
func (h *Handler) OverrideGate(c *gin.Context) {
	var q queryer = h.service.database
	if t := middleware.TxFromGin(c); t != nil { q = t }
	var req struct {
		AdmissionNumber string `json:"admission_number" binding:"required"`
		Reason          string `json:"reason" binding:"required"`
		EventType       string `json:"event_type"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")

	var learnerID string
	err := q.QueryRow(
		`SELECT learner_id FROM learners WHERE tenant_id = $1 AND admission_number = $2`,
		tenantID, req.AdmissionNumber).Scan(&learnerID)
	if err == sql.ErrNoRows {
		validation.NotFound(c, "No learner with that admission number")
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}

	eventType := strings.ToUpper(strings.TrimSpace(req.EventType))
	if eventType == "" {
		eventType = "MANUAL_ENTRY"
	}
	raw, _ := json.Marshal(map[string]any{"reason": req.Reason, "recorded_by": userID})

	var eventID string
	err = q.QueryRow(
		`INSERT INTO gate_events (tenant_id, device_id, holder_type, holder_id, event_type, verified, verified_by, verified_at, raw_payload)
		 SELECT $1::varchar, gd.device_id, 'LEARNER', $2::uuid, $3::varchar, true, $4::uuid, now(), $5::jsonb
		 FROM gate_devices gd WHERE gd.tenant_id = $1::varchar ORDER BY gd.created_at LIMIT 1
		 RETURNING event_id`,
		tenantID, learnerID, eventType, nullableString(userID), string(raw)).Scan(&eventID)
	if err == sql.ErrNoRows {
		validation.Conflict(c, "No gate device is configured for this school")
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"event_id": eventID})
}

// ---------- helpers ----------

func nullableString(s string) interface{} {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

func randomPairingCode() string {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return "PAIR0001"
	}
	out := make([]byte, 8)
	for i, b := range buf {
		out[i] = alphabet[int(b)%len(alphabet)]
	}
	return string(out)
}

type queryer interface {
	Query(query string, args ...interface{}) (*sql.Rows, error)
	QueryRow(query string, args ...interface{}) *sql.Row
	Exec(query string, args ...interface{}) (sql.Result, error)
}

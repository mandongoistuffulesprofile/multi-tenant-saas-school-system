package attendance

import (
	"database/sql"
	"fmt"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
	"github.com/lib/pq"
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

// AttendanceRegister
type AttendanceRegister struct {
	RegisterID     string `json:"register_id"`
	TenantID       string `json:"tenant_id"`
	ClassGroupID   string `json:"class_group_id"`
	GradeID        string `json:"grade_id"`
	StreamID       string `json:"stream_id"`
	AcademicYearID string `json:"academic_year_id"`
	TermID         string `json:"term_id"`
	RegisterDate   string `json:"register_date"`
	SessionType    string `json:"session_type"`
	Status         string `json:"status"`
	MarkedBy       string `json:"marked_by,omitempty"`
	MarkedAt       string `json:"marked_at,omitempty"`
	CreatedAt      string `json:"created_at"`
	UpdatedAt      string `json:"updated_at"`
}

func (h *Handler) ListAttendanceRegisters(c *gin.Context) {
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	tenantID := c.GetString("tenant_id")

	limit := 50
	if v := c.Query("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 200 {
			limit = n
		}
	}
	offset := 0
	if v := c.Query("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			offset = n
		}
	}

	args := []interface{}{tenantID}
	query := `
		SELECT register_id, tenant_id, class_group_id, grade_id, stream_id,
			academic_year_id, term_id, register_date, session_type, status,
			marked_by, marked_at, created_at, updated_at
		 FROM attendance_registers WHERE tenant_id = $1 ORDER BY register_date DESC
		 LIMIT $%d OFFSET $%d`
	query = fmt.Sprintf(query, len(args)+1, len(args)+2)
	args = append(args, limit, offset)
	rows, err := tx.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	var registers []AttendanceRegister
	for rows.Next() {
		var r AttendanceRegister
		if err := rows.Scan(&r.RegisterID, &r.TenantID, &r.ClassGroupID, &r.GradeID, &r.StreamID,
			&r.AcademicYearID, &r.TermID, &r.RegisterDate, &r.SessionType, &r.Status,
			&r.MarkedBy, &r.MarkedAt, &r.CreatedAt, &r.UpdatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		registers = append(registers, r)
	}
	c.JSON(http.StatusOK, registers)
}

// AttendanceMark
type AttendanceMark struct {
	MarkID     string `json:"mark_id"`
	TenantID   string `json:"tenant_id"`
	RegisterID string `json:"register_id"`
	LearnerID  string `json:"learner_id"`
	Status     string `json:"status"`
	MarkedBy   string `json:"marked_by,omitempty"`
	MarkedAt   string `json:"marked_at"`
	Notes      string `json:"notes,omitempty"`
}

func (h *Handler) ListAttendanceMarks(c *gin.Context) {
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	tenantID := c.GetString("tenant_id")
	registerID := c.Query("register_id")
	learnerID := c.Query("learner_id")

	limit := 50
	if v := c.Query("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 200 {
			limit = n
		}
	}
	offset := 0
	if v := c.Query("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			offset = n
		}
	}

	// Parents and guardians may only view attendance marks for learners
	// linked to them via learner_guardians.
	userID := c.GetString("user_id")
	rolesVal, _ := c.Get(middleware.ContextRoles)
	isParentOrGuardian := false
	if roleList, ok := rolesVal.([]string); ok {
		for _, r := range roleList {
			if r == middleware.RoleParent || r == middleware.RoleGuardian {
				isParentOrGuardian = true
				break
			}
		}
	}

	var linkedLearnerIDs map[string]bool
	if isParentOrGuardian {
		var err error
		linkedLearnerIDs, err = h.getLinkedLearnerIDs(tx, userID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Failed to load linked learners"})
			return
		}
		// If a specific learner_id is requested, verify it's linked
		if learnerID != "" {
			if !linkedLearnerIDs[learnerID] {
				c.JSON(http.StatusForbidden, gin.H{"code": "FORBIDDEN", "message": "Learner is not linked to this guardian"})
				return
			}
		} else if len(linkedLearnerIDs) == 0 {
			// No linked learners - return empty result
			c.JSON(http.StatusOK, []AttendanceMark{})
			return
		}
	}

	query := `
		SELECT mark_id, tenant_id, register_id, learner_id, status,
			marked_by, marked_at, notes
		 FROM attendance_marks WHERE tenant_id = $1`
	args := []interface{}{tenantID}
	argIndex := 2

	if registerID != "" {
		query += fmt.Sprintf(" AND register_id = $%d", argIndex)
		args = append(args, registerID)
		argIndex++
	}
	if learnerID != "" {
		query += fmt.Sprintf(" AND learner_id = $%d", argIndex)
		args = append(args, learnerID)
		argIndex++
	} else if isParentOrGuardian {
		ids := make([]string, 0, len(linkedLearnerIDs))
		for id := range linkedLearnerIDs {
			ids = append(ids, id)
		}
		query += fmt.Sprintf(" AND learner_id = ANY($%d)", argIndex)
		args = append(args, pq.Array(ids))
		argIndex++
	}

	query += fmt.Sprintf(" ORDER BY marked_at DESC LIMIT $%d OFFSET $%d", argIndex, argIndex+1)
	args = append(args, limit, offset)

	rows, err := tx.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	marks := make([]AttendanceMark, 0)
	for rows.Next() {
		var m AttendanceMark
		// marked_by and notes are nullable.
		var markedBy, notes sql.NullString
		if err := rows.Scan(&m.MarkID, &m.TenantID, &m.RegisterID, &m.LearnerID, &m.Status,
			&markedBy, &m.MarkedAt, &notes); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		m.MarkedBy = markedBy.String
		m.Notes = notes.String
		marks = append(marks, m)
	}
	c.JSON(http.StatusOK, marks)
}

// ParentAttendance returns recent attendance marks for the learners linked to
// the calling parent or guardian. The portal table expects one row per mark.
func (h *Handler) ParentAttendance(c *gin.Context) {
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")

	rows, err := tx.Query(
		`SELECT to_char(am.marked_at, 'YYYY-MM-DD'),
			l.first_name || ' ' || l.last_name,
			COALESCE((
				SELECT g.grade_label || COALESCE(' ' || s.stream_name, '')
				FROM enrolments e
				JOIN class_groups cg ON cg.class_group_id = e.class_group_id
				JOIN grades g ON g.grade_id = cg.grade_id
				LEFT JOIN streams s ON s.stream_id = cg.stream_id
				WHERE e.learner_id = l.learner_id AND e.status = 'ACTIVE'
				ORDER BY e.started_on DESC LIMIT 1
			), ''),
			am.status
		 FROM attendance_marks am
		 JOIN learners l ON l.learner_id = am.learner_id
		 JOIN guardians gd ON gd.user_id = $2 AND gd.tenant_id = $1
		 JOIN learner_guardians lg ON lg.guardian_id = gd.guardian_id AND lg.learner_id = am.learner_id
		 WHERE am.tenant_id = $1
		 ORDER BY am.marked_at DESC
		 LIMIT 100`,
		tenantID, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	type parentMark struct {
		Date      string `json:"date"`
		Learner   string `json:"learner"`
		ClassName string `json:"class_name"`
		Status    string `json:"status"`
	}
	marks := make([]parentMark, 0)
	for rows.Next() {
		var m parentMark
		if err := rows.Scan(&m.Date, &m.Learner, &m.ClassName, &m.Status); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		marks = append(marks, m)
	}
	c.JSON(http.StatusOK, marks)
}

func (h *Handler) getLinkedLearnerIDs(tx *sqlx.Tx, userID string) (map[string]bool, error) {
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

// GateDevice
type GateDevice struct {
	DeviceID    string `json:"device_id"`
	TenantID    string `json:"tenant_id"`
	DeviceName  string `json:"device_name"`
	DeviceType  string `json:"device_type"`
	Location    string `json:"location,omitempty"`
	PairingCode string `json:"pairing_code"`
	IsPaired    bool   `json:"is_paired"`
	PairedAt    string `json:"paired_at,omitempty"`
	PairedBy    string `json:"paired_by,omitempty"`
	LastSeenAt  string `json:"last_seen_at,omitempty"`
	Status      string `json:"status"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
}

func (h *Handler) ListGateDevices(c *gin.Context) {
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	tenantID := c.GetString("tenant_id")
	rows, err := tx.Query(
		`SELECT device_id, tenant_id, device_name, device_type, location,
			pairing_code, is_paired, paired_at, paired_by, last_seen_at,
			status, created_at, updated_at
		 FROM gate_devices WHERE tenant_id = $1 ORDER BY device_name`,
		tenantID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	var devices []GateDevice
	for rows.Next() {
		var d GateDevice
		if err := rows.Scan(&d.DeviceID, &d.TenantID, &d.DeviceName, &d.DeviceType, &d.Location,
			&d.PairingCode, &d.IsPaired, &d.PairedAt, &d.PairedBy, &d.LastSeenAt,
			&d.Status, &d.CreatedAt, &d.UpdatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		devices = append(devices, d)
	}
	c.JSON(http.StatusOK, devices)
}

// RFIDTag
type RFIDTag struct {
	TagID      string `json:"tag_id"`
	TenantID   string `json:"tenant_id"`
	TagUID     string `json:"tag_uid"`
	HolderType string `json:"holder_type"`
	HolderID   string `json:"holder_id"`
	IsActive   bool   `json:"is_active"`
	IssuedAt   string `json:"issued_at"`
	CreatedAt  string `json:"created_at"`
	UpdatedAt  string `json:"updated_at"`
}

func (h *Handler) ListRFIDTags(c *gin.Context) {
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	tenantID := c.GetString("tenant_id")
	rows, err := tx.Query(
		`SELECT tag_id, tenant_id, tag_uid, holder_type, holder_id,
			is_active, issued_at::text, created_at::text, updated_at::text
		 FROM rfid_tags WHERE tenant_id = $1 ORDER BY tag_uid`,
		tenantID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	var tags []RFIDTag
	for rows.Next() {
		var t RFIDTag
		if err := rows.Scan(&t.TagID, &t.TenantID, &t.TagUID, &t.HolderType, &t.HolderID,
			&t.IsActive, &t.IssuedAt, &t.CreatedAt, &t.UpdatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		tags = append(tags, t)
	}
	c.JSON(http.StatusOK, tags)
}

// GateEvent
type GateEvent struct {
	EventID    string `json:"event_id"`
	TenantID   string `json:"tenant_id"`
	DeviceID   string `json:"device_id"`
	TagID      string `json:"tag_id,omitempty"`
	HolderType string `json:"holder_type,omitempty"`
	HolderID   string `json:"holder_id,omitempty"`
	EventType  string `json:"event_type"`
	EventTS    string `json:"event_ts"`
	Verified   bool   `json:"verified"`
	VerifiedBy string `json:"verified_by,omitempty"`
	VerifiedAt string `json:"verified_at,omitempty"`
	CreatedAt  string `json:"created_at"`
}

func (h *Handler) ListGateEvents(c *gin.Context) {
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	tenantID := c.GetString("tenant_id")
	rows, err := tx.Query(
		`SELECT event_id, tenant_id, device_id, tag_id, holder_type, holder_id,
			event_type, event_ts, verified, verified_by, verified_at, created_at
		 FROM gate_events WHERE tenant_id = $1 ORDER BY event_ts DESC LIMIT 100`,
		tenantID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	var events []GateEvent
	for rows.Next() {
		var e GateEvent
		if err := rows.Scan(&e.EventID, &e.TenantID, &e.DeviceID, &e.TagID, &e.HolderType,
			&e.HolderID, &e.EventType, &e.EventTS, &e.Verified, &e.VerifiedBy,
			&e.VerifiedAt, &e.CreatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		events = append(events, e)
	}
	c.JSON(http.StatusOK, events)
}

var _ = http.StatusOK
var _ = sql.ErrNoRows

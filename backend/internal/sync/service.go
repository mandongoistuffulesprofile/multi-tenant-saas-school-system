// Package sync implements the teacher device sync protocol.
//
// A device that worked offline pushes a batch of captured items; the server
// applies them idempotently, records a conflict whenever the server copy has
// moved on since the device captured its version, and never overwrites one
// side silently.
package sync

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/validation"
)

type Service struct{}

func NewService() *Service {
	return &Service{}
}

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

// Entity types the sync protocol understands.
const (
	EntityAssessmentResult = "ASSESSMENT_RESULT"
	EntityAttendanceMark   = "ATTENDANCE_MARK"
)

// SyncItem is one captured change queued on the device.
type SyncItem struct {
	EntityType    string         `json:"entity_type" binding:"required"`
	EntityID      string         `json:"entity_id"`
	ClientUUID    string         `json:"client_uuid"`
	ClientVersion int            `json:"client_version"`
	Payload       map[string]any `json:"payload" binding:"required"`
}

// Push applies a batch of captured items.
func (h *Handler) Push(c *gin.Context) {
	var req struct {
		DeviceID string     `json:"device_id" binding:"required"`
		SyncType string     `json:"sync_type"`
		Items    []SyncItem `json:"items" binding:"required"`
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

	var syncID string
	err := tx.QueryRow(
		`INSERT INTO sync_log (tenant_id, device_id, sync_type, items_sent, status)
		 VALUES ($1, $2, $3, $4, 'IN_PROGRESS') RETURNING sync_id`,
		tenantID, req.DeviceID, defaultString(strings.ToUpper(req.SyncType), "PUSH"), len(req.Items),
	).Scan(&syncID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}

	applied := 0
	conflicts := 0
	failed := 0
	results := make([]gin.H, 0, len(req.Items))

	for _, item := range req.Items {
		result, status, err := h.applyItem(tx, tenantID, userID, item)
		if err != nil {
			failed++
			results = append(results, gin.H{
				"entity_type": item.EntityType,
				"client_uuid": item.ClientUUID,
				"status":      "FAILED",
				"error":       err.Error(),
			})
			continue
		}
		switch status {
		case "APPLIED":
			applied++
		case "CONFLICT":
			conflicts++
		}
		results = append(results, result)
	}

	_, _ = tx.Exec(
		`UPDATE sync_log SET items_sent = $1, conflicts = $2, status = $3, completed_at = now()
		 WHERE sync_id = $4`, applied, conflicts, statusFor(failed), syncID)

	c.JSON(http.StatusOK, gin.H{
		"sync_id":   syncID,
		"applied":   applied,
		"conflicts": conflicts,
		"failed":    failed,
		"results":   results,
	})
}

func (h *Handler) applyItem(tx *sqlx.Tx, tenantID, userID string, item SyncItem) (gin.H, string, error) {
	switch strings.ToUpper(item.EntityType) {
	case EntityAssessmentResult:
		return h.applyAssessmentResult(tx, tenantID, userID, item)
	case EntityAttendanceMark:
		return h.applyAttendanceMark(tx, tenantID, userID, item)
	default:
		return gin.H{"entity_type": item.EntityType, "status": "FAILED"},
			"FAILED", &syncError{"unsupported entity type " + item.EntityType}
	}
}

func (h *Handler) applyAssessmentResult(tx *sqlx.Tx, tenantID, userID string, item SyncItem) (gin.H, string, error) {
	eventID, _ := item.Payload["event_id"].(string)
	learnerID, _ := item.Payload["learner_id"].(string)
	if eventID == "" || learnerID == "" {
		return gin.H{}, "FAILED", &syncError{"event_id and learner_id are required"}
	}
	subStrand, _ := item.Payload["sub_strand_id"].(string)
	levelCode, _ := item.Payload["level_code"].(string)
	remarks, _ := item.Payload["remarks"].(string)
	deviceID, _ := item.Payload["device_id"].(string)
	clientTS, _ := item.Payload["client_ts"].(string)
	teacherID, _ := item.Payload["teacher_id"].(string)
	if teacherID == "" {
		teacherID = userID
	}
	points := numberOf(item.Payload["points"])
	rawScore := numberOf(item.Payload["raw_score"])
	maxScore := numberOf(item.Payload["max_score"])

	// Conflict detection: if the stored row is newer than the version the
	// device captured, keep both and raise a conflict instead of overwriting.
	var serverVersion int
	var serverValues []byte
	err := tx.QueryRow(
		`SELECT version, COALESCE(level_code,'') || '|' || COALESCE(remarks,'')
		 FROM assessment_results
		 WHERE tenant_id = $1 AND event_id = $2 AND learner_id = $3
		   AND COALESCE(sub_strand_id, '00000000-0000-0000-0000-000000000000'::uuid)
		     = COALESCE($4::uuid, '00000000-0000-0000-0000-000000000000'::uuid)`,
		tenantID, eventID, learnerID, nullableString(subStrand)).Scan(&serverVersion, &serverValues)
	if err != nil && err != sql.ErrNoRows {
		return gin.H{}, "FAILED", err
	}
	if err == nil && item.ClientVersion > 0 && serverVersion > item.ClientVersion {
		conflictID, cErr := h.recordConflict(tx, tenantID, "ASSESSMENT_RESULT", eventID+"|"+learnerID+"|"+subStrand,
			item.ClientVersion, serverVersion, item.Payload, string(serverValues))
		if cErr != nil {
			return gin.H{}, "FAILED", cErr
		}
		return gin.H{
			"entity_type": item.EntityType,
			"client_uuid": item.ClientUUID,
			"status":      "CONFLICT",
			"conflict_id": conflictID,
		}, "CONFLICT", nil
	}

	var resultID string
	err = tx.QueryRow(
		`INSERT INTO assessment_results
		 (tenant_id, event_id, learner_id, sub_strand_id, level_code, points, raw_score, max_score,
		  remarks, teacher_id, client_uuid, version, state, device_id, client_ts)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'DRAFT', $13, $14)
		 ON CONFLICT (tenant_id, client_uuid) WHERE client_uuid IS NOT NULL
		 DO UPDATE SET level_code = EXCLUDED.level_code, points = EXCLUDED.points,
		   raw_score = EXCLUDED.raw_score, max_score = EXCLUDED.max_score,
		   remarks = EXCLUDED.remarks, version = assessment_results.version + 1, server_ts = now()
		 RETURNING result_id`,
		tenantID, eventID, learnerID, nullableString(subStrand), nullableString(levelCode),
		nullableNumber(points), nullableNumber(rawScore), nullableNumber(maxScore),
		nullableString(remarks), nullableString(teacherID), nullableString(item.ClientUUID),
		item.ClientVersion, nullableString(deviceID), nullableString(clientTS),
	).Scan(&resultID)
	if err != nil {
		return gin.H{}, "FAILED", err
	}

	return gin.H{
		"entity_type": item.EntityType,
		"client_uuid": item.ClientUUID,
		"status":      "APPLIED",
		"result_id":   resultID,
	}, "APPLIED", nil
}

func (h *Handler) applyAttendanceMark(tx *sqlx.Tx, tenantID, userID string, item SyncItem) (gin.H, string, error) {
	registerID, _ := item.Payload["register_id"].(string)
	learnerID, _ := item.Payload["learner_id"].(string)
	status, _ := item.Payload["status"].(string)
	if registerID == "" || learnerID == "" || status == "" {
		return gin.H{}, "FAILED", &syncError{"register_id, learner_id and status are required"}
	}
	notes, _ := item.Payload["notes"].(string)
	deviceID, _ := item.Payload["device_id"].(string)
	clientTS, _ := item.Payload["client_ts"].(string)

	var markID string
	err := tx.QueryRow(
		`INSERT INTO attendance_marks
		 (tenant_id, register_id, learner_id, status, marked_by, notes, client_uuid, device_id, client_ts)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		 ON CONFLICT (tenant_id, client_uuid) WHERE client_uuid IS NOT NULL
		 DO UPDATE SET status = EXCLUDED.status, notes = EXCLUDED.notes, updated_at = now()
		 RETURNING mark_id`,
		tenantID, registerID, learnerID, strings.ToUpper(status), nullableString(userID),
		nullableString(notes), nullableString(item.ClientUUID), nullableString(deviceID), nullableString(clientTS),
	).Scan(&markID)
	if err != nil {
		return gin.H{}, "FAILED", err
	}

	return gin.H{
		"entity_type": item.EntityType,
		"client_uuid": item.ClientUUID,
		"status":      "APPLIED",
		"mark_id":     markID,
	}, "APPLIED", nil
}

// Pull returns records changed since a timestamp so a device can catch up.
func (h *Handler) Pull(c *gin.Context) {
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	tenantID := c.GetString("tenant_id")
	since := c.Query("since")
	entityType := strings.ToUpper(c.Query("entity_type"))

	type change struct {
		EntityType string         `json:"entity_type"`
		EntityID   string         `json:"entity_id"`
		Version    int            `json:"version"`
		Values     map[string]any `json:"values"`
		ChangedAt  string         `json:"changed_at"`
	}
	changes := make([]change, 0)

	if entityType == "" || entityType == EntityAssessmentResult {
		query := `SELECT result_id, event_id, learner_id, COALESCE(sub_strand_id::text, ''),
			COALESCE(level_code,''), COALESCE(points,0), COALESCE(raw_score,0), COALESCE(max_score,0),
			COALESCE(remarks,''), state, version, server_ts
			FROM assessment_results WHERE tenant_id = $1`
		args := []interface{}{tenantID}
		if since != "" {
			query += " AND server_ts > $2::timestamptz"
			args = append(args, since)
		}
		query += " ORDER BY server_ts LIMIT 500"
		rows, err := tx.Query(query, args...)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		for rows.Next() {
			var id, eventID, learnerID, subStrand, levelCode, remarks, state, changedAt string
			var points, rawScore, maxScore float64
			var version int
			if err := rows.Scan(&id, &eventID, &learnerID, &subStrand, &levelCode, &points,
				&rawScore, &maxScore, &remarks, &state, &version, &changedAt); err != nil {
				rows.Close()
				c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
				return
			}
			changes = append(changes, change{
				EntityType: EntityAssessmentResult,
				EntityID:   id,
				Version:    version,
				Values: map[string]any{
					"event_id":      eventID,
					"learner_id":    learnerID,
					"sub_strand_id": subStrand,
					"level_code":    levelCode,
					"points":        points,
					"raw_score":     rawScore,
					"max_score":     maxScore,
					"remarks":       remarks,
					"state":         state,
				},
				ChangedAt: changedAt,
			})
		}
		rows.Close()
	}

	if entityType == "" || entityType == EntityAttendanceMark {
		query := `SELECT mark_id, register_id, learner_id, status, COALESCE(notes,''), updated_at
			FROM attendance_marks WHERE tenant_id = $1`
		args := []interface{}{tenantID}
		if since != "" {
			query += " AND updated_at > $2::timestamptz"
			args = append(args, since)
		}
		query += " ORDER BY updated_at LIMIT 500"
		rows, err := tx.Query(query, args...)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		for rows.Next() {
			var id, registerID, learnerID, status, notes, changedAt string
			if err := rows.Scan(&id, &registerID, &learnerID, &status, &notes, &changedAt); err != nil {
				rows.Close()
				c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
				return
			}
			changes = append(changes, change{
				EntityType: EntityAttendanceMark,
				EntityID:   id,
				Values: map[string]any{
					"register_id": registerID,
					"learner_id":  learnerID,
					"status":      status,
					"notes":       notes,
				},
				ChangedAt: changedAt,
			})
		}
		rows.Close()
	}

	c.JSON(http.StatusOK, gin.H{"changes": changes, "count": len(changes)})
}

// ListConflicts returns unresolved conflicts.
func (h *Handler) ListConflicts(c *gin.Context) {
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	tenantID := c.GetString("tenant_id")
	includeResolved := c.Query("include_resolved") == "true"

	query := `SELECT conflict_id, entity_type, entity_id, client_version, server_version,
		client_values, server_values, resolved, created_at
		FROM sync_conflicts WHERE tenant_id = $1`
	args := []interface{}{tenantID}
	if !includeResolved {
		query += " AND resolved = false"
	}
	query += " ORDER BY created_at DESC"

	rows, err := tx.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	type conflict struct {
		ConflictID    string         `json:"conflict_id"`
		EntityType    string         `json:"entity_type"`
		EntityID      string         `json:"entity_id"`
		ClientVersion int            `json:"client_version"`
		ServerVersion int            `json:"server_version"`
		ClientValues  map[string]any `json:"client_values"`
		ServerValues  map[string]any `json:"server_values"`
		Resolved      bool           `json:"resolved"`
		CreatedAt     string         `json:"created_at"`
	}
	items := make([]conflict, 0)
	for rows.Next() {
		var cf conflict
		var clientRaw, serverRaw []byte
		if err := rows.Scan(&cf.ConflictID, &cf.EntityType, &cf.EntityID, &cf.ClientVersion,
			&cf.ServerVersion, &clientRaw, &serverRaw, &cf.Resolved, &cf.CreatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		cf.ClientValues = map[string]any{}
		cf.ServerValues = map[string]any{}
		_ = json.Unmarshal(clientRaw, &cf.ClientValues)
		_ = json.Unmarshal(serverRaw, &cf.ServerValues)
		items = append(items, cf)
	}
	c.JSON(http.StatusOK, items)
}

// ResolveConflict applies a manual resolution. The device sends the values it
// wants to keep; the server records them and marks the conflict resolved.
func (h *Handler) ResolveConflict(c *gin.Context) {
	conflictID := c.Param("id")
	var req struct {
		Resolution string         `json:"resolution" binding:"required"`
		Values     map[string]any `json:"values"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	resolution := strings.ToUpper(strings.TrimSpace(req.Resolution))
	if resolution != "KEEP_MINE" && resolution != "KEEP_THEIRS" {
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "resolution", Code: "INVALID_VALUE", Message: "'resolution' must be KEEP_MINE or KEEP_THEIRS"},
		})
		return
	}

	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")

	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}

	var entityType, entityID string
	var clientValues, serverValues []byte
	var resolved bool
	err := tx.QueryRow(
		`SELECT entity_type, entity_id, client_values, server_values, resolved
		 FROM sync_conflicts WHERE conflict_id = $1 AND tenant_id = $2`,
		conflictID, tenantID).Scan(&entityType, &entityID, &clientValues, &serverValues, &resolved)
	if err == sql.ErrNoRows {
		validation.NotFound(c, "Conflict not found")
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	if resolved {
		validation.Conflict(c, "Conflict is already resolved")
		return
	}

	chosen := map[string]any{}
	if resolution == "KEEP_MINE" {
		_ = json.Unmarshal(clientValues, &chosen)
	} else {
		_ = json.Unmarshal(serverValues, &chosen)
	}
	for k, v := range req.Values {
		chosen[k] = v
	}
	raw, _ := json.Marshal(chosen)

	_, err = tx.Exec(
		`UPDATE sync_conflicts SET resolved = true, resolution_values = $1::jsonb, resolved_by = $2, resolved_at = now()
		 WHERE conflict_id = $3 AND tenant_id = $4`, string(raw), nullableString(userID), conflictID, tenantID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"conflict_id": conflictID, "resolution": resolution, "values": chosen})
}

func (h *Handler) recordConflict(tx *sqlx.Tx, tenantID, entityType, entityID string, clientVersion, serverVersion int, clientValues map[string]any, serverSummary string) (string, error) {
	clientRaw, _ := json.Marshal(clientValues)
	serverRaw, _ := json.Marshal(map[string]any{"summary": serverSummary})

	var conflictID string
	err := tx.QueryRow(
		`INSERT INTO sync_conflicts (tenant_id, entity_type, entity_id, client_version, server_version, client_values, server_values)
		 VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb) RETURNING conflict_id`,
		tenantID, entityType, entityID, clientVersion, serverVersion, string(clientRaw), string(serverRaw)).Scan(&conflictID)
	if err != nil {
		return "", err
	}
	return conflictID, nil
}

// ---------- helpers ----------

type syncError struct{ msg string }

func (e *syncError) Error() string { return e.msg }

func nullableString(s string) interface{} {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

func nullableNumber(f float64) interface{} {
	if f == 0 {
		return nil
	}
	return f
}

func numberOf(v any) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case int:
		return float64(n)
	case json.Number:
		f, _ := n.Float64()
		return f
	}
	return 0
}

func defaultString(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func statusFor(failed int) string {
	if failed > 0 {
		return "PARTIAL"
	}
	return "COMPLETED"
}

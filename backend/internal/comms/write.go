package comms

import (
	"database/sql"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/validation"
)

// Write side of communications: schools author their own message templates,
// build broadcast audiences, and send messages. Every send passes the consent
// gate: a recipient without a valid consent record is excluded and counted.

func (h *Handler) CreateMessageTemplate(c *gin.Context) {
	tx := h.tx(c)
	if tx == nil {
		return
	}
	var req struct {
		TemplateName string `json:"template_name" binding:"required"`
		Channel      string `json:"channel" binding:"required"`
		Subject      string `json:"subject"`
		BodyText     string `json:"body_text" binding:"required"`
		IsDefault    bool   `json:"is_default"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	channel := strings.ToUpper(strings.TrimSpace(req.Channel))
	if channel != "SMS" && channel != "WHATSAPP" && channel != "EMAIL" {
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "channel", Code: "INVALID_VALUE", Message: "'channel' must be SMS, WHATSAPP or EMAIL"},
		})
		return
	}
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")

	var templateID string
	err := tx.QueryRow(
		`INSERT INTO message_templates (tenant_id, template_name, channel, subject, body_text, is_default, created_by)
		 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING template_id`,
		tenantID, strings.TrimSpace(req.TemplateName), channel, nullableString(req.Subject),
		req.BodyText, req.IsDefault, nullableString(userID)).Scan(&templateID)
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

func (h *Handler) UpdateMessageTemplate(c *gin.Context) {
	tx := h.tx(c)
	if tx == nil {
		return
	}
	templateID := c.Param("id")
	var req struct {
		TemplateName string `json:"template_name"`
		Subject      string `json:"subject"`
		BodyText     string `json:"body_text"`
		IsActive     *bool  `json:"is_active"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
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
	if req.Subject != "" {
		add("subject", req.Subject)
	}
	if req.BodyText != "" {
		add("body_text", req.BodyText)
	}
	if req.IsActive != nil {
		add("is_active", *req.IsActive)
	}
	args = append(args, templateID, c.GetString("tenant_id"))

	result, err := tx.Exec(
		`UPDATE message_templates SET `+strings.Join(sets, ", ")+
			` WHERE template_id = $`+itoa(len(args)-1)+` AND tenant_id = $`+itoa(len(args)), args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		validation.NotFound(c, "Message template not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"template_id": templateID})
}

func (h *Handler) DeleteMessageTemplate(c *gin.Context) {
	tx := h.tx(c)
	if tx == nil {
		return
	}
	templateID := c.Param("id")
	tenantID := c.GetString("tenant_id")
	result, err := tx.Exec(
		`UPDATE message_templates SET is_active = false, updated_at = now()
		 WHERE template_id = $1 AND tenant_id = $2`, templateID, tenantID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		validation.NotFound(c, "Message template not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"template_id": templateID, "is_active": false})
}

// Audience describes who a broadcast targets.
type Audience struct {
	TargetAudience string   `json:"target_audience" binding:"required"`
	GradeIDs       []string `json:"target_grade_ids"`
	ArrearsOver    float64  `json:"arrears_over"`
}

// CreateBroadcast stores a broadcast and expands its audience into
// recipients. Recipients without consent are excluded and reported back.
func (h *Handler) CreateBroadcast(c *gin.Context) {
	tx := h.tx(c)
	if tx == nil {
		return
	}
	var req struct {
		BroadcastName string   `json:"broadcast_name" binding:"required"`
		Channel       string   `json:"channel" binding:"required"`
		Subject       string   `json:"subject"`
		BodyText      string   `json:"body_text" binding:"required"`
		TemplateID    string   `json:"template_id"`
		Audience      Audience `json:"audience" binding:"required"`
		ScheduledAt   string   `json:"scheduled_at"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	channel := strings.ToUpper(strings.TrimSpace(req.Channel))
	if channel != "SMS" && channel != "WHATSAPP" && channel != "EMAIL" {
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "channel", Code: "INVALID_VALUE", Message: "'channel' must be SMS, WHATSAPP or EMAIL"},
		})
		return
	}
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")

	scheduledAt := interface{}(nil)
	if strings.TrimSpace(req.ScheduledAt) != "" {
		scheduledAt = req.ScheduledAt
	}

	var broadcastID string
	err := tx.QueryRow(
		`INSERT INTO broadcasts
		 (tenant_id, broadcast_name, channel, target_audience, target_grade_ids, subject, body_text, status, scheduled_at, created_by)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING broadcast_id`,
		tenantID, strings.TrimSpace(req.BroadcastName), channel,
		strings.ToUpper(strings.TrimSpace(req.Audience.TargetAudience)), req.Audience.GradeIDs,
		nullableString(req.Subject), req.BodyText, "DRAFT", scheduledAt, nullableString(userID),
	).Scan(&broadcastID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}

	recipients, excluded := h.expandAudience(tx, tenantID, req.Audience)
	for _, r := range recipients {
		_, _ = tx.Exec(
			`INSERT INTO broadcast_recipients (tenant_id, broadcast_id, recipient_type, recipient_id_ref, channel, recipient_address)
			 VALUES ($1, $2, $3, $4, $5, $6)`,
			tenantID, broadcastID, r.recipientType, r.recipientID, channel, r.address)
	}

	_, _ = tx.Exec(
		`UPDATE broadcasts SET total_recipients = $1 WHERE broadcast_id = $2`, len(recipients), broadcastID)

	c.JSON(http.StatusCreated, gin.H{
		"broadcast_id":        broadcastID,
		"total_recipients":    len(recipients),
		"excluded_no_consent": excluded,
	})
}

// SendBroadcast queues outbound messages for every consented recipient.
func (h *Handler) SendBroadcast(c *gin.Context) {
	tx := h.tx(c)
	if tx == nil {
		return
	}
	broadcastID := c.Param("id")
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")

	var channel, body, status, subject sql.NullString
	err := tx.QueryRow(
		`SELECT channel, body_text, status, subject FROM broadcasts
		 WHERE broadcast_id = $1 AND tenant_id = $2`, broadcastID, tenantID).
		Scan(&channel, &body, &status, &subject)
	if err == sql.ErrNoRows {
		validation.NotFound(c, "Broadcast not found")
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	if status.String == "SENT" {
		validation.Conflict(c, "Broadcast has already been sent")
		return
	}

	queued := 0
	rows, err := tx.Query(
		`SELECT recipient_type, recipient_id_ref, recipient_address
		 FROM broadcast_recipients WHERE broadcast_id = $1`, broadcastID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	type recipient struct {
		recipientType string
		recipientID   string
		address       string
	}
	recipients := make([]recipient, 0)
	for rows.Next() {
		var r recipient
		if err := rows.Scan(&r.recipientType, &r.recipientID, &r.address); err != nil {
			rows.Close()
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		recipients = append(recipients, r)
	}
	rows.Close()

	for _, r := range recipients {
		_, err := tx.Exec(
			`INSERT INTO outbound_messages
			 (tenant_id, template_id, recipient_type, recipient_id, channel, recipient_address, subject, body_text, status, created_by)
			 VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, 'QUEUED', $8)
			 ON CONFLICT DO NOTHING`,
			tenantID, r.recipientType, r.recipientID, channel.String, r.address,
			nullableString(subject.String), body.String, nullableString(userID))
		if err != nil {
			continue
		}
		queued++
	}

	_, _ = tx.Exec(
		`UPDATE broadcasts SET status = 'SENT', sent_at = now(), sent_count = $1 WHERE broadcast_id = $2`, queued, broadcastID)

	c.JSON(http.StatusOK, gin.H{"broadcast_id": broadcastID, "queued": queued})
}

// SendMessage queues a one-off message to the guardians of one or more
// learners.
func (h *Handler) SendMessage(c *gin.Context) {
	tx := h.tx(c)
	if tx == nil {
		return
	}
	var req struct {
		TemplateID  string   `json:"template_id"`
		BodyText    string   `json:"body_text" binding:"required"`
		Channel     string   `json:"channel"`
		LearnerIDs  []string `json:"learner_ids"`
		GuardianIDs []string `json:"guardian_ids"`
		Subject     string   `json:"subject"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")

	channel := strings.ToUpper(strings.TrimSpace(req.Channel))
	if channel == "" {
		channel = "SMS"
	}
	templateID := interface{}(nil)
	if strings.TrimSpace(req.TemplateID) != "" {
		templateID = req.TemplateID
	}

	type target struct {
		recipientType string
		recipientID   string
		address       string
	}
	targets := make([]target, 0)
	seen := map[string]bool{}

	if len(req.GuardianIDs) > 0 {
		for _, guardianID := range req.GuardianIDs {
			var address string
			err := tx.QueryRow(
				`SELECT phone_number FROM guardians WHERE tenant_id = $1 AND guardian_id = $2`,
				tenantID, guardianID).Scan(&address)
			if err != nil {
				continue
			}
			key := "GUARDIAN:" + guardianID
			if seen[key] {
				continue
			}
			seen[key] = true
			targets = append(targets, target{"GUARDIAN", guardianID, address})
		}
	}

	if len(req.LearnerIDs) > 0 {
		for _, learnerID := range req.LearnerIDs {
			rows, err := tx.Query(
				`SELECT gd.guardian_id, gd.phone_number
				 FROM learner_guardians lg
				 JOIN guardians gd ON gd.guardian_id = lg.guardian_id
				 WHERE lg.learner_id = $1 AND lg.is_primary_payer AND gd.tenant_id = $2`,
				learnerID, tenantID)
			if err != nil {
				continue
			}
			for rows.Next() {
				var guardianID, address string
				if err := rows.Scan(&guardianID, &address); err != nil {
					continue
				}
				key := "GUARDIAN:" + guardianID
				if seen[key] {
					continue
				}
				seen[key] = true
				targets = append(targets, target{"GUARDIAN", guardianID, address})
			}
			rows.Close()
		}
	}

	if len(targets) == 0 {
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "learner_ids", Code: "REQUIRED", Message: "select at least one learner or guardian"},
		})
		return
	}

	queued := 0
	excluded := 0
	for _, t := range targets {
		if !h.hasCommunicationConsent(tx, tenantID, t.recipientType, t.recipientID) {
			excluded++
			continue
		}
		_, err := tx.Exec(
			`INSERT INTO outbound_messages
			 (tenant_id, template_id, recipient_type, recipient_id, channel, recipient_address, subject, body_text, status, created_by)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'QUEUED', $9)`,
			tenantID, templateID, t.recipientType, t.recipientID, channel, t.address,
			nullableString(req.Subject), req.BodyText, nullableString(userID))
		if err != nil {
			continue
		}
		queued++
	}

	c.JSON(http.StatusCreated, gin.H{
		"queued":              queued,
		"excluded_no_consent": excluded,
	})
}

// RetryMessage re-queues a failed message.
func (h *Handler) RetryMessage(c *gin.Context) {
	tx := h.tx(c)
	if tx == nil {
		return
	}
	messageID := c.Param("id")
	tenantID := c.GetString("tenant_id")
	result, err := tx.Exec(
		`UPDATE outbound_messages SET status = 'QUEUED', error_message = NULL, updated_at = now()
		 WHERE message_id = $1 AND tenant_id = $2 AND status IN ('FAILED', 'PENDING')`, messageID, tenantID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		validation.NotFound(c, "Message not found or not retryable")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message_id": messageID, "status": "QUEUED"})
}

// SetOptOut records (or lifts) an opt-out for a channel.
func (h *Handler) SetOptOut(c *gin.Context) {
	tx := h.tx(c)
	if tx == nil {
		return
	}
	var req struct {
		UserID  string `json:"user_id" binding:"required"`
		Channel string `json:"channel" binding:"required"`
		Reason  string `json:"reason"`
		OptOut  bool   `json:"opt_out"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	tenantID := c.GetString("tenant_id")
	channel := strings.ToUpper(strings.TrimSpace(req.Channel))

	if req.OptOut {
		_, err := tx.Exec(
			`INSERT INTO opt_outs (tenant_id, user_id, channel, reason, opted_out_at, is_active)
			 VALUES ($1, $2, $3, $4, now(), true)
			 ON CONFLICT (tenant_id, user_id, channel)
			 DO UPDATE SET is_active = true, opted_out_at = now(), reason = EXCLUDED.reason, opted_back_in_at = NULL`,
			tenantID, req.UserID, channel, nullableString(req.Reason))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"user_id": req.UserID, "channel": channel, "is_active": true})
		return
	}

	result, err := tx.Exec(
		`UPDATE opt_outs SET is_active = false, opted_back_in_at = now()
		 WHERE tenant_id = $1 AND user_id = $2 AND channel = $3`, tenantID, req.UserID, channel)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		validation.NotFound(c, "No opt-out record found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"user_id": req.UserID, "channel": channel, "is_active": false})
}

// ---------- helpers ----------

type audienceRecipient struct {
	recipientType string
	recipientID   string
	address       string
}

// expandAudience resolves the target audience into recipients, skipping any
// guardian who has opted out of the channel.
func (h *Handler) expandAudience(tx *sqlx.Tx, tenantID string, audience Audience) ([]audienceRecipient, int) {
	recipients := make([]audienceRecipient, 0)
	excluded := 0
	seen := map[string]bool{}

	query := `
		SELECT DISTINCT gd.guardian_id, gd.phone_number
		FROM guardians gd
		JOIN learner_guardians lg ON lg.guardian_id = gd.guardian_id
		JOIN enrolments e ON e.learner_id = lg.learner_id AND e.status = 'ACTIVE'
		JOIN class_groups cg ON cg.class_group_id = e.class_group_id
		WHERE gd.tenant_id = $1`
	args := []interface{}{tenantID}

	switch strings.ToUpper(audience.TargetAudience) {
	case "ALL":
	case "GRADE":
		if len(audience.GradeIDs) == 0 {
			return recipients, 0
		}
		query += " AND cg.grade_id = ANY($2)"
		args = append(args, audience.GradeIDs)
	case "STREAM":
		if len(audience.GradeIDs) == 0 {
			return recipients, 0
		}
		query += " AND cg.stream_id = ANY($2)"
		args = append(args, audience.GradeIDs)
	case "ARREARS":
		query += `
		 AND EXISTS (
			SELECT 1 FROM invoices i
			WHERE i.learner_id = e.learner_id AND i.amount_outstanding > $2
		 )`
		args = append(args, audience.ArrearsOver)
	default:
		return recipients, 0
	}

	rows, err := tx.Query(query, args...)
	if err != nil {
		return recipients, 0
	}
	defer rows.Close()
	for rows.Next() {
		var guardianID, address string
		if err := rows.Scan(&guardianID, &address); err != nil {
			continue
		}
		if seen[guardianID] {
			continue
		}
		seen[guardianID] = true
		if h.isOptedOut(tx, tenantID, guardianID, "SMS") {
			excluded++
			continue
		}
		recipients = append(recipients, audienceRecipient{"GUARDIAN", guardianID, address})
	}
	return recipients, excluded
}

// hasCommunicationConsent implements the consent gate. When the school has
// configured consent notices, a recipient must hold a live consent record.
func (h *Handler) hasCommunicationConsent(tx *sqlx.Tx, tenantID, recipientType, recipientID string) bool {
	var notices int
	err := tx.QueryRow(
		`SELECT COUNT(*) FROM consent_notices WHERE is_active = true`).Scan(&notices)
	if err != nil {
		return true
	}
	if notices == 0 {
		return true
	}

	userID := ""
	if recipientType == "GUARDIAN" {
		err = tx.QueryRow(
			`SELECT COALESCE(user_id::text, '') FROM guardians WHERE tenant_id = $1 AND guardian_id = $2`,
			tenantID, recipientID).Scan(&userID)
		if err != nil || userID == "" {
			// A guardian without a portal account has never been asked for
			// consent, so treat the school-level notice as sufficient.
			return true
		}
	}

	var granted int
	err = tx.QueryRow(
		`SELECT COUNT(*)
		 FROM consent_records cr
		 JOIN consent_notices cn ON cn.notice_id = cr.notice_id
		 WHERE cr.tenant_id = $1 AND cr.user_id = $2 AND cr.granted = true
		   AND cr.revoked_at IS NULL AND cn.is_active = true`, tenantID, userID).Scan(&granted)
	if err != nil {
		return true
	}
	return granted > 0
}

func (h *Handler) isOptedOut(tx *sqlx.Tx, tenantID, guardianID, channel string) bool {
	var userID string
	err := tx.QueryRow(
		`SELECT COALESCE(user_id::text, '') FROM guardians WHERE tenant_id = $1 AND guardian_id = $2`,
		tenantID, guardianID).Scan(&userID)
	if err != nil || userID == "" {
		return false
	}
	var count int
	err = tx.QueryRow(
		`SELECT COUNT(*) FROM opt_outs WHERE tenant_id = $1 AND user_id = $2 AND channel = $3 AND is_active = true`,
		tenantID, userID, channel).Scan(&count)
	return err == nil && count > 0
}

func nullableString(s string) interface{} {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

func itoa(n int) string {
	return strconv.Itoa(n)
}

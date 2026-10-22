package comms

import (
	"database/sql"
	"net/http"

	"github.com/gin-gonic/gin"
	"kenyan-primary-saas/backend/internal/db"
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

// MessageTemplate
type MessageTemplate struct {
	TemplateID   string `json:"template_id"`
	TenantID     string `json:"tenant_id"`
	TemplateName string `json:"template_name"`
	Channel      string `json:"channel"`
	Subject      string `json:"subject,omitempty"`
	BodyText     string `json:"body_text"`
	BodyHTML     string `json:"body_html,omitempty"`
	IsActive     bool   `json:"is_active"`
	IsDefault    bool   `json:"is_default"`
	CreatedBy    string `json:"created_by,omitempty"`
	CreatedAt    string `json:"created_at"`
	UpdatedAt    string `json:"updated_at"`
}

func (h *Handler) ListMessageTemplates(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	rows, err := h.service.database.Query(
		`SELECT template_id, tenant_id, template_name, channel, subject,
			body_text, body_html, is_active, is_default, created_by, created_at, updated_at
		 FROM message_templates WHERE (tenant_id = $1 OR tenant_id IS NULL)
		 ORDER BY channel, template_name`,
		tenantID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	var templates []MessageTemplate
	for rows.Next() {
		var t MessageTemplate
		if err := rows.Scan(&t.TemplateID, &t.TenantID, &t.TemplateName, &t.Channel,
			&t.Subject, &t.BodyText, &t.BodyHTML, &t.IsActive, &t.IsDefault,
			&t.CreatedBy, &t.CreatedAt, &t.UpdatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		templates = append(templates, t)
	}
	c.JSON(http.StatusOK, templates)
}

// OutboundMessage
type OutboundMessage struct {
	MessageID        string `json:"message_id"`
	TenantID         string `json:"tenant_id"`
	TemplateID       string `json:"template_id,omitempty"`
	RecipientType    string `json:"recipient_type"`
	RecipientID      string `json:"recipient_id"`
	Channel          string `json:"channel"`
	RecipientAddress string `json:"recipient_address"`
	Subject          string `json:"subject,omitempty"`
	BodyText         string `json:"body_text"`
	Status           string `json:"status"`
	ProviderMsgID    string `json:"provider_message_id,omitempty"`
	SentAt           string `json:"sent_at,omitempty"`
	DeliveredAt      string `json:"delivered_at,omitempty"`
	ReadAt           string `json:"read_at,omitempty"`
	ErrorMessage     string `json:"error_message,omitempty"`
	CreatedBy        string `json:"created_by,omitempty"`
	CreatedAt        string `json:"created_at"`
	UpdatedAt        string `json:"updated_at"`
}

func (h *Handler) ListOutboundMessages(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	rows, err := h.service.database.Query(
		`SELECT message_id, tenant_id, template_id, recipient_type, recipient_id,
			channel, recipient_address, subject, body_text, status,
			provider_message_id, sent_at, delivered_at, read_at, error_message,
			created_by, created_at, updated_at
		 FROM outbound_messages WHERE tenant_id = $1 ORDER BY created_at DESC`,
		tenantID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	var messages []OutboundMessage
	for rows.Next() {
		var m OutboundMessage
		if err := rows.Scan(&m.MessageID, &m.TenantID, &m.TemplateID, &m.RecipientType,
			&m.RecipientID, &m.Channel, &m.RecipientAddress, &m.Subject, &m.BodyText,
			&m.Status, &m.ProviderMsgID, &m.SentAt, &m.DeliveredAt, &m.ReadAt,
			&m.ErrorMessage, &m.CreatedBy, &m.CreatedAt, &m.UpdatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		messages = append(messages, m)
	}
	c.JSON(http.StatusOK, messages)
}

// Broadcast
type Broadcast struct {
	BroadcastID     string `json:"broadcast_id"`
	TenantID        string `json:"tenant_id"`
	BroadcastName   string `json:"broadcast_name"`
	Channel         string `json:"channel"`
	TargetAudience  string `json:"target_audience"`
	TargetGradeIDs  string `json:"target_grade_ids,omitempty"`
	Subject         string `json:"subject,omitempty"`
	BodyText        string `json:"body_text"`
	Status          string `json:"status"`
	ScheduledAt     string `json:"scheduled_at,omitempty"`
	SentAt          string `json:"sent_at,omitempty"`
	CompletedAt     string `json:"completed_at,omitempty"`
	TotalRecipients int    `json:"total_recipients"`
	SentCount       int    `json:"sent_count"`
	FailedCount     int    `json:"failed_count"`
	CreatedBy       string `json:"created_by,omitempty"`
	CreatedAt       string `json:"created_at"`
	UpdatedAt       string `json:"updated_at"`
}

func (h *Handler) ListBroadcasts(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	rows, err := h.service.database.Query(
		`SELECT broadcast_id, tenant_id, broadcast_name, channel, target_audience,
			target_grade_ids, subject, body_text, status, scheduled_at, sent_at,
			completed_at, total_recipients, sent_count, failed_count, created_by,
			created_at, updated_at
		 FROM broadcasts WHERE tenant_id = $1 ORDER BY created_at DESC`,
		tenantID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	var broadcasts []Broadcast
	for rows.Next() {
		var b Broadcast
		var gradeIDs []byte
		if err := rows.Scan(&b.BroadcastID, &b.TenantID, &b.BroadcastName, &b.Channel,
			&b.TargetAudience, &gradeIDs, &b.Subject, &b.BodyText, &b.Status,
			&b.ScheduledAt, &b.SentAt, &b.CompletedAt, &b.TotalRecipients,
			&b.SentCount, &b.FailedCount, &b.CreatedBy, &b.CreatedAt, &b.UpdatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		b.TargetGradeIDs = string(gradeIDs)
		broadcasts = append(broadcasts, b)
	}
	c.JSON(http.StatusOK, broadcasts)
}

// OptOut
type OptOut struct {
	OptOutID      string `json:"opt_out_id"`
	TenantID      string `json:"tenant_id"`
	UserID        string `json:"user_id"`
	Channel       string `json:"channel"`
	Reason        string `json:"reason,omitempty"`
	OptedOutAt    string `json:"opted_out_at"`
	OptedBackInAt string `json:"opted_back_in_at,omitempty"`
	IsActive      bool   `json:"is_active"`
}

func (h *Handler) ListOptOuts(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	rows, err := h.service.database.Query(
		`SELECT opt_out_id, tenant_id, user_id, channel, reason,
			opted_out_at, opted_back_in_at, is_active
		 FROM opt_outs WHERE tenant_id = $1 AND is_active = TRUE
		 ORDER BY opted_out_at DESC`,
		tenantID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	var optOuts []OptOut
	for rows.Next() {
		var o OptOut
		if err := rows.Scan(&o.OptOutID, &o.TenantID, &o.UserID, &o.Channel,
			&o.Reason, &o.OptedOutAt, &o.OptedBackInAt, &o.IsActive); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		optOuts = append(optOuts, o)
	}
	c.JSON(http.StatusOK, optOuts)
}

var _ = http.StatusOK
var _ = sql.ErrNoRows

package compliance

import (
	"database/sql"
	"encoding/json"
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

// ConsentNotice
type ConsentNotice struct {
	NoticeID          string `json:"notice_id"`
	NoticeCode        string `json:"notice_code"`
	Title             string `json:"title"`
	ContentText       string `json:"content_text"`
	Version           int    `json:"version"`
	IsActive          bool   `json:"is_active"`
	RequiresRenewal   bool   `json:"requires_renewal"`
	RenewalPeriodDays int    `json:"renewal_period_days,omitempty"`
	CreatedBy         string `json:"created_by,omitempty"`
	CreatedAt         string `json:"created_at"`
	UpdatedAt         string `json:"updated_at"`
}

func (h *Handler) ListConsentNotices(c *gin.Context) {
	rows, err := h.service.database.Query(
		`SELECT notice_id, notice_code, title, content_text, version, is_active,
			requires_renewal, renewal_period_days, created_by, created_at, updated_at
		 FROM consent_notices WHERE is_active = TRUE ORDER BY notice_code`,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	var notices []ConsentNotice
	for rows.Next() {
		var n ConsentNotice
		if err := rows.Scan(&n.NoticeID, &n.NoticeCode, &n.Title, &n.ContentText,
			&n.Version, &n.IsActive, &n.RequiresRenewal, &n.RenewalPeriodDays,
			&n.CreatedBy, &n.CreatedAt, &n.UpdatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		notices = append(notices, n)
	}
	c.JSON(http.StatusOK, notices)
}

// ConsentRecord
type ConsentRecord struct {
	ConsentID     string `json:"consent_id"`
	TenantID      string `json:"tenant_id"`
	UserID        string `json:"user_id"`
	NoticeID      string `json:"notice_id"`
	NoticeVersion int    `json:"notice_version"`
	Granted       bool   `json:"granted"`
	GrantedAt     string `json:"granted_at,omitempty"`
	RevokedAt     string `json:"revoked_at,omitempty"`
	CreatedAt     string `json:"created_at"`
	UpdatedAt     string `json:"updated_at"`
}

func (h *Handler) ListConsentRecords(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	rows, err := h.service.database.Query(
		`SELECT consent_id, tenant_id, user_id, notice_id, notice_version,
			granted, granted_at, revoked_at, created_at, updated_at
		 FROM consent_records WHERE tenant_id = $1 ORDER BY created_at DESC`,
		tenantID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	var records []ConsentRecord
	for rows.Next() {
		var r ConsentRecord
		if err := rows.Scan(&r.ConsentID, &r.TenantID, &r.UserID, &r.NoticeID,
			&r.NoticeVersion, &r.Granted, &r.GrantedAt, &r.RevokedAt,
			&r.CreatedAt, &r.UpdatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		records = append(records, r)
	}
	c.JSON(http.StatusOK, records)
}

// AccessLog
type AccessLog struct {
	LogID        string `json:"log_id"`
	TenantID     string `json:"tenant_id"`
	UserID       string `json:"user_id,omitempty"`
	Action       string `json:"action"`
	ResourceType string `json:"resource_type"`
	ResourceID   string `json:"resource_id"`
	IPAddress    string `json:"ip_address,omitempty"`
	AccessedAt   string `json:"accessed_at"`
}

func (h *Handler) ListAccessLogs(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	rows, err := h.service.database.Query(
		`SELECT log_id, tenant_id, user_id, action, resource_type, resource_id,
			ip_address, accessed_at
		 FROM access_logs WHERE tenant_id = $1 ORDER BY accessed_at DESC LIMIT 100`,
		tenantID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	var logs []AccessLog
	for rows.Next() {
		var l AccessLog
		if err := rows.Scan(&l.LogID, &l.TenantID, &l.UserID, &l.Action,
			&l.ResourceType, &l.ResourceID, &l.IPAddress, &l.AccessedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		logs = append(logs, l)
	}
	c.JSON(http.StatusOK, logs)
}

// DSRRequest
type DSRRequest struct {
	RequestID    string                 `json:"request_id"`
	TenantID     string                 `json:"tenant_id"`
	UserID       string                 `json:"user_id"`
	RequestType  string                 `json:"request_type"`
	Status       string                 `json:"status"`
	Description  string                 `json:"description,omitempty"`
	ResponseData map[string]interface{} `json:"response_data,omitempty"`
	RespondedBy  string                 `json:"responded_by,omitempty"`
	RespondedAt  string                 `json:"responded_at,omitempty"`
	DueDate      string                 `json:"due_date,omitempty"`
	CreatedAt    string                 `json:"created_at"`
	UpdatedAt    string                 `json:"updated_at"`
}

func (h *Handler) ListDSRRequests(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	rows, err := h.service.database.Query(
		`SELECT request_id, tenant_id, user_id, request_type, status,
			description, response_data, responded_by, responded_at, due_date, created_at, updated_at
		 FROM dsr_requests WHERE tenant_id = $1 ORDER BY created_at DESC`,
		tenantID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	requests := make([]DSRRequest, 0)
	for rows.Next() {
		var r DSRRequest
		// description, responded_by, responded_at and due_date are nullable.
		var description, respondedBy, respondedAt, dueDate sql.NullString
		var responseData []byte
		if err := rows.Scan(&r.RequestID, &r.TenantID, &r.UserID, &r.RequestType,
			&r.Status, &description, &responseData, &respondedBy, &respondedAt, &dueDate,
			&r.CreatedAt, &r.UpdatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		r.Description = description.String
		r.RespondedBy = respondedBy.String
		r.RespondedAt = respondedAt.String
		r.DueDate = dueDate.String
		if len(responseData) > 0 {
			_ = json.Unmarshal(responseData, &r.ResponseData)
		}
		requests = append(requests, r)
	}
	c.JSON(http.StatusOK, requests)
}

// BreachRegister
type BreachRegister struct {
	BreachID            string `json:"breach_id"`
	TenantID            string `json:"tenant_id"`
	BreachTitle         string `json:"breach_title"`
	Description         string `json:"description"`
	DiscoveredAt        string `json:"discovered_at"`
	ReportedToAuthority bool   `json:"reported_to_authority"`
	Severity            string `json:"severity"`
	Status              string `json:"status"`
	AffectedCount       int    `json:"affected_data_subjects"`
	ResolutionNotes     string `json:"resolution_notes,omitempty"`
	ReportedBy          string `json:"reported_by,omitempty"`
	CreatedAt           string `json:"created_at"`
	UpdatedAt           string `json:"updated_at"`
}

func (h *Handler) ListBreachRegister(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	rows, err := h.service.database.Query(
		`SELECT breach_id, tenant_id, breach_title, description, discovered_at,
			reported_to_authority, affected_data_subjects, severity, status,
			resolution_notes, reported_by, created_at, updated_at
		 FROM breach_register WHERE tenant_id = $1 ORDER BY discovered_at DESC`,
		tenantID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	var breaches []BreachRegister
	for rows.Next() {
		var b BreachRegister
		if err := rows.Scan(&b.BreachID, &b.TenantID, &b.BreachTitle, &b.Description,
			&b.DiscoveredAt, &b.ReportedToAuthority, &b.AffectedCount, &b.Severity,
			&b.Status, &b.ResolutionNotes, &b.ReportedBy, &b.CreatedAt, &b.UpdatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		breaches = append(breaches, b)
	}
	c.JSON(http.StatusOK, breaches)
}

var _ = http.StatusOK
var _ = sql.ErrNoRows

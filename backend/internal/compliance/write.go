package compliance

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/validation"
)

// Write side of compliance: consent notices and records, data-subject
// requests, the breach register, DPIA records and retention policies.

// CreateConsentNotice publishes a new consent notice version. Notices are
// global reference data shared by every school.
func (h *Handler) CreateConsentNotice(c *gin.Context) {
	tx := h.tx(c)
	if tx == nil {
		return
	}
	var req struct {
		NoticeCode        string `json:"notice_code" binding:"required"`
		Title             string `json:"title" binding:"required"`
		ContentText       string `json:"content_text" binding:"required"`
		Version           int    `json:"version"`
		RequiresRenewal   bool   `json:"requires_renewal"`
		RenewalPeriodDays int    `json:"renewal_period_days"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	userID := c.GetString("user_id")

	version := req.Version
	if version <= 0 {
		version = 1
	}

	var noticeID string
	err := tx.QueryRow(
		`INSERT INTO consent_notices
		 (notice_code, title, content_text, version, is_active, requires_renewal, renewal_period_days, created_by)
		 VALUES ($1, $2, $3, $4, true, $5, $6, $7) RETURNING notice_id`,
		strings.TrimSpace(req.NoticeCode), req.Title, req.ContentText, version,
		req.RequiresRenewal, nullableInt(req.RenewalPeriodDays), nullableString(userID)).Scan(&noticeID)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate key value") {
			validation.Conflict(c, "That notice version already exists")
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"notice_id": noticeID})
}

// UpdateConsentNotice edits the text or retires a notice version.
func (h *Handler) UpdateConsentNotice(c *gin.Context) {
	tx := h.tx(c)
	if tx == nil {
		return
	}
	noticeID := c.Param("id")
	var req struct {
		Title       string `json:"title"`
		ContentText string `json:"content_text"`
		IsActive    *bool  `json:"is_active"`
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
	if req.Title != "" {
		add("title", req.Title)
	}
	if req.ContentText != "" {
		add("content_text", req.ContentText)
	}
	if req.IsActive != nil {
		add("is_active", *req.IsActive)
	}
	args = append(args, noticeID)

	result, err := tx.Exec(
		`UPDATE consent_notices SET `+strings.Join(sets, ", ")+` WHERE notice_id = $`+itoa(len(args)), args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		validation.NotFound(c, "Consent notice not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"notice_id": noticeID})
}

// RecordConsent grants (or withdraws) consent for a user against a notice.
func (h *Handler) RecordConsent(c *gin.Context) {
	tx := h.tx(c)
	if tx == nil {
		return
	}
	var req struct {
		UserID   string `json:"user_id" binding:"required"`
		NoticeID string `json:"notice_id" binding:"required"`
		Granted  bool   `json:"granted"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	tenantID := c.GetString("tenant_id")

	var noticeVersion int
	err := tx.QueryRow(
		`SELECT version FROM consent_notices WHERE notice_id = $1`, req.NoticeID).Scan(&noticeVersion)
	if err == sql.ErrNoRows {
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "notice_id", Code: "INVALID_VALUE", Message: "consent notice does not exist"},
		})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}

	var consentID string
	err = tx.QueryRow(
		`INSERT INTO consent_records (tenant_id, user_id, notice_id, notice_version, granted, granted_at, revoked_at)
		 VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 THEN now() ELSE NULL END, CASE WHEN $5 THEN NULL ELSE now() END)
		 ON CONFLICT (tenant_id, user_id, notice_id)
		 DO UPDATE SET granted = EXCLUDED.granted, notice_version = EXCLUDED.notice_version,
		   granted_at = CASE WHEN EXCLUDED.granted THEN now() ELSE consent_records.granted_at END,
		   revoked_at = CASE WHEN EXCLUDED.granted THEN NULL ELSE now() END, updated_at = now()
		 RETURNING consent_id`,
		tenantID, req.UserID, req.NoticeID, noticeVersion, req.Granted).Scan(&consentID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"consent_id": consentID, "granted": req.Granted})
}

// RevokeConsent withdraws a previously granted consent.
func (h *Handler) RevokeConsent(c *gin.Context) {
	tx := h.tx(c)
	if tx == nil {
		return
	}
	consentID := c.Param("id")
	tenantID := c.GetString("tenant_id")
	result, err := tx.Exec(
		`UPDATE consent_records SET granted = false, revoked_at = now(), updated_at = now()
		 WHERE consent_id = $1 AND tenant_id = $2`, consentID, tenantID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		validation.NotFound(c, "Consent record not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"consent_id": consentID, "granted": false})
}

// CreateDSRRequest opens a data-subject request.
func (h *Handler) CreateDSRRequest(c *gin.Context) {
	tx := h.tx(c)
	if tx == nil {
		return
	}
	var req struct {
		UserID      string `json:"user_id" binding:"required"`
		RequestType string `json:"request_type" binding:"required"`
		Description string `json:"description"`
		DueDate     string `json:"due_date"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	tenantID := c.GetString("tenant_id")

	var requestID string
	err := tx.QueryRow(
		`INSERT INTO dsr_requests (tenant_id, user_id, request_type, description, due_date)
		 VALUES ($1, $2, $3, $4, $5) RETURNING request_id`,
		tenantID, req.UserID, strings.ToUpper(strings.TrimSpace(req.RequestType)),
		nullableString(req.Description), nullableString(req.DueDate)).Scan(&requestID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"request_id": requestID})
}

// UpdateDSRRequest changes a request's status and stores the response.
func (h *Handler) UpdateDSRRequest(c *gin.Context) {
	tx := h.tx(c)
	if tx == nil {
		return
	}
	requestID := c.Param("id")
	var req struct {
		Status       string         `json:"status" binding:"required"`
		ResponseData map[string]any `json:"response_data"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	status := strings.ToUpper(strings.TrimSpace(req.Status))
	switch status {
	case "PENDING", "IN_PROGRESS", "COMPLETED", "REJECTED":
	default:
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "status", Code: "INVALID_VALUE", Message: "'status' must be PENDING, IN_PROGRESS, COMPLETED or REJECTED"},
		})
		return
	}
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")

	response := req.ResponseData
	if response == nil {
		response = map[string]any{}
	}
	raw, _ := json.Marshal(response)

	result, err := tx.Exec(
		`UPDATE dsr_requests SET status = $1::varchar, response_data = $2::jsonb, responded_by = $3::uuid,
		   responded_at = CASE WHEN $1::varchar IN ('COMPLETED','REJECTED') THEN now() ELSE responded_at END, updated_at = now()
		 WHERE request_id = $4::uuid AND tenant_id = $5::varchar`,
		status, string(raw), nullableString(userID), requestID, tenantID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		validation.NotFound(c, "DSR request not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"request_id": requestID, "status": status})
}

// CreateBreach records a personal-data breach.
func (h *Handler) CreateBreach(c *gin.Context) {
	tx := h.tx(c)
	if tx == nil {
		return
	}
	var req struct {
		BreachTitle          string `json:"breach_title" binding:"required"`
		Description          string `json:"description" binding:"required"`
		DiscoveredAt         string `json:"discovered_at" binding:"required"`
		Severity             string `json:"severity"`
		AffectedDataSubjects int    `json:"affected_data_subjects"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	severity := strings.ToUpper(strings.TrimSpace(req.Severity))
	switch severity {
	case "", "LOW", "MEDIUM", "HIGH", "CRITICAL":
	default:
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "severity", Code: "INVALID_VALUE", Message: "'severity' must be LOW, MEDIUM, HIGH or CRITICAL"},
		})
		return
	}
	if severity == "" {
		severity = "LOW"
	}
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")

	var breachID string
	err := tx.QueryRow(
		`INSERT INTO breach_register
		 (tenant_id, breach_title, description, discovered_at, severity, affected_data_subjects, reported_by)
		 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING breach_id`,
		tenantID, req.BreachTitle, req.Description, req.DiscoveredAt, severity,
		req.AffectedDataSubjects, nullableString(userID)).Scan(&breachID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"breach_id": breachID})
}

// UpdateBreach updates the status, severity and resolution of a breach.
func (h *Handler) UpdateBreach(c *gin.Context) {
	tx := h.tx(c)
	if tx == nil {
		return
	}
	breachID := c.Param("id")
	var req struct {
		Status              string `json:"status"`
		Severity            string `json:"severity"`
		ResolutionNotes     string `json:"resolution_notes"`
		ReportedToAuthority *bool  `json:"reported_to_authority"`
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
	// addExpr appends a fragment that is evaluated by the database itself.
	addExpr := func(fragment string) {
		sets = append(sets, fragment)
	}
	if req.Status != "" {
		add("status", strings.ToUpper(req.Status))
	}
	if req.Severity != "" {
		add("severity", strings.ToUpper(req.Severity))
	}
	if req.ResolutionNotes != "" {
		add("resolution_notes", req.ResolutionNotes)
	}
	if req.ReportedToAuthority != nil {
		add("reported_to_authority", *req.ReportedToAuthority)
		if *req.ReportedToAuthority {
			addExpr("authority_reported_at = now()")
		} else {
			addExpr("authority_reported_at = NULL")
		}
	}
	args = append(args, breachID, c.GetString("tenant_id"))

	result, err := tx.Exec(
		`UPDATE breach_register SET `+strings.Join(sets, ", ")+
			` WHERE breach_id = $`+itoa(len(args)-1)+` AND tenant_id = $`+itoa(len(args)), args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		validation.NotFound(c, "Breach not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"breach_id": breachID})
}

// UpsertRetentionPolicy stores the retention rule for a resource type.
func (h *Handler) UpsertRetentionPolicy(c *gin.Context) {
	tx := h.tx(c)
	if tx == nil {
		return
	}
	var req struct {
		ResourceType         string `json:"resource_type" binding:"required"`
		RetentionDays        int    `json:"retention_days" binding:"required"`
		ActionAfterRetention string `json:"action_after_retention" binding:"required"`
		IsActive             bool   `json:"is_active"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	if req.RetentionDays <= 0 {
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "retention_days", Code: "OUT_OF_RANGE", Message: "'retention_days' must be greater than zero"},
		})
		return
	}
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")

	var policyID string
	err := tx.QueryRow(
		`INSERT INTO retention_policies (tenant_id, resource_type, retention_days, action_after_retention, is_active, created_by)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 ON CONFLICT (tenant_id, resource_type)
		 DO UPDATE SET retention_days = EXCLUDED.retention_days,
		   action_after_retention = EXCLUDED.action_after_retention,
		   is_active = EXCLUDED.is_active, updated_at = now()
		 RETURNING policy_id`,
		tenantID, strings.TrimSpace(req.ResourceType), req.RetentionDays,
		strings.ToUpper(strings.TrimSpace(req.ActionAfterRetention)), req.IsActive, nullableString(userID)).Scan(&policyID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"policy_id": policyID})
}

// ListRetentionPolicies returns the school's retention rules.
func (h *Handler) ListRetentionPolicies(c *gin.Context) {
	tx := h.tx(c)
	if tx == nil {
		return
	}
	tenantID := c.GetString("tenant_id")
	rows, err := tx.Query(
		`SELECT policy_id, tenant_id, resource_type, retention_days, action_after_retention, is_active
		 FROM retention_policies WHERE tenant_id = $1 ORDER BY resource_type`, tenantID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	type policy struct {
		PolicyID             string `json:"policy_id"`
		TenantID             string `json:"tenant_id"`
		ResourceType         string `json:"resource_type"`
		RetentionDays        int    `json:"retention_days"`
		ActionAfterRetention string `json:"action_after_retention"`
		IsActive             bool   `json:"is_active"`
	}
	policies := make([]policy, 0)
	for rows.Next() {
		var p policy
		if err := rows.Scan(&p.PolicyID, &p.TenantID, &p.ResourceType, &p.RetentionDays,
			&p.ActionAfterRetention, &p.IsActive); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		policies = append(policies, p)
	}
	c.JSON(http.StatusOK, policies)
}

// CreateDPIA records a data-protection impact assessment.
func (h *Handler) CreateDPIA(c *gin.Context) {
	tx := h.tx(c)
	if tx == nil {
		return
	}
	var req struct {
		ProcessingActivity string `json:"processing_activity" binding:"required"`
		Description        string `json:"description" binding:"required"`
		RiskLevel          string `json:"risk_level"`
		MitigationMeasures string `json:"mitigation_measures"`
		ReviewDate         string `json:"review_date"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	risk := strings.ToUpper(strings.TrimSpace(req.RiskLevel))
	switch risk {
	case "", "LOW", "MEDIUM", "HIGH":
	default:
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "risk_level", Code: "INVALID_VALUE", Message: "'risk_level' must be LOW, MEDIUM or HIGH"},
		})
		return
	}
	if risk == "" {
		risk = "LOW"
	}
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")

	var dpiaID string
	err := tx.QueryRow(
		`INSERT INTO dpia_records
		 (tenant_id, processing_activity, description, risk_level, mitigation_measures, status, assessed_by, review_date)
		 VALUES ($1, $2, $3, $4, $5, 'DRAFT', $6, $7) RETURNING dpia_id`,
		tenantID, req.ProcessingActivity, req.Description, risk,
		nullableString(req.MitigationMeasures), nullableString(userID), nullableString(req.ReviewDate)).Scan(&dpiaID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"dpia_id": dpiaID})
}

// ComplianceSummary gives the dashboard its coverage figures.
func (h *Handler) ComplianceSummary(c *gin.Context) {
	tx := h.tx(c)
	if tx == nil {
		return
	}
	tenantID := c.GetString("tenant_id")

	var learners, withConsent, pendingDSR, openBreaches int
	_ = tx.QueryRow(
		`SELECT COUNT(*) FROM learners WHERE tenant_id = $1 AND status = 'ACTIVE'`, tenantID).Scan(&learners)
	_ = tx.QueryRow(
		`SELECT COUNT(DISTINCT lg.learner_id)
		 FROM learner_guardians lg
		 JOIN guardians gd ON gd.guardian_id = lg.guardian_id
		 JOIN consent_records cr ON cr.user_id = gd.user_id AND cr.granted = true AND cr.revoked_at IS NULL
		 WHERE gd.tenant_id = $1`, tenantID).Scan(&withConsent)
	_ = tx.QueryRow(
		`SELECT COUNT(*) FROM dsr_requests WHERE tenant_id = $1 AND status IN ('PENDING','IN_PROGRESS')`, tenantID).Scan(&pendingDSR)
	_ = tx.QueryRow(
		`SELECT COUNT(*) FROM breach_register WHERE tenant_id = $1 AND status <> 'CLOSED'`, tenantID).Scan(&openBreaches)

	c.JSON(http.StatusOK, gin.H{
		"active_learners":       learners,
		"learners_with_consent": withConsent,
		"pending_dsr_requests":  pendingDSR,
		"open_breaches":         openBreaches,
	})
}

// ---------- helpers ----------

func nullableString(s string) interface{} {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

func nullableInt(n int) interface{} {
	if n == 0 {
		return nil
	}
	return n
}

func itoa(n int) string { return strconv.Itoa(n) }

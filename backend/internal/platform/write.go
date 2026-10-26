package platform

import (
	"crypto/rand"
	"encoding/hex"
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/auth"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/validation"
)

// Write side of the platform console: tenant registry, subscriptions, plans,
// reference data (curriculum versions, weighting profiles, KNEC tools) and
// export jobs.

// Tenant is the platform view of a school.
type Tenant struct {
	TenantID     string `json:"tenant_id"`
	SchoolName   string `json:"school_name"`
	Subdomain    string `json:"subdomain"`
	SchoolType   string `json:"school_type"`
	FundingMode  string `json:"funding_mode"`
	Status       string `json:"status"`
	County       string `json:"county"`
	Learners     int    `json:"learners"`
	LastActivity string `json:"last_activity"`
}

func (h *Handler) ListTenants(c *gin.Context) {
	rows, err := h.service.database.Query(
		`SELECT s.tenant_id, s.school_name, s.subdomain, s.school_type, s.funding_mode,
			s.status, COALESCE(s.county, ''),
			(SELECT COUNT(*) FROM learners l WHERE l.tenant_id = s.tenant_id AND l.status = 'ACTIVE'),
			COALESCE((SELECT MAX(a.created_at)::text FROM audit_events a WHERE a.tenant_id = s.tenant_id), '')
		 FROM schools s ORDER BY s.school_name`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	tenants := make([]Tenant, 0)
	for rows.Next() {
		var t Tenant
		if err := rows.Scan(&t.TenantID, &t.SchoolName, &t.Subdomain, &t.SchoolType,
			&t.FundingMode, &t.Status, &t.County, &t.Learners, &t.LastActivity); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		tenants = append(tenants, t)
	}
	c.JSON(http.StatusOK, tenants)
}

// CreateTenant registers a new school and its first administrator.
func (h *Handler) CreateTenant(c *gin.Context) {
	var req struct {
		SchoolName    string `json:"school_name" binding:"required"`
		Subdomain     string `json:"subdomain" binding:"required"`
		SchoolType    string `json:"school_type"`
		FundingMode   string `json:"funding_mode"`
		County        string `json:"county"`
		LicenseTier   string `json:"license_tier"`
		AdminEmail    string `json:"admin_email" binding:"required"`
		AdminPhone    string `json:"admin_phone" binding:"required"`
		AdminPassword string `json:"admin_password"`
		PlanCode      string `json:"plan_code"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	adminUserID := c.GetString("user_id")

	schoolType := strings.ToUpper(strings.TrimSpace(req.SchoolType))
	if schoolType == "" {
		schoolType = "PRIVATE"
	}
	fundingMode := strings.ToUpper(strings.TrimSpace(req.FundingMode))
	if fundingMode == "" {
		fundingMode = "CUSTOM"
	}
	licenseTier := strings.ToUpper(strings.TrimSpace(req.LicenseTier))
	if licenseTier == "" {
		licenseTier = "STANDARD"
	}
	subdomain := strings.ToLower(strings.TrimSpace(req.Subdomain))

	tenantID := subdomain
	var exists int
	if err := h.service.database.QueryRow(`SELECT COUNT(*) FROM schools WHERE tenant_id = $1`, tenantID).Scan(&exists); err == nil && exists > 0 {
		validation.Conflict(c, "That subdomain is already in use")
		return
	}

	tx, err := h.service.database.Beginx()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer tx.Rollback()

	// The tenant context must be set for RLS-protected writes inside the tx.
	if _, err := tx.Exec(`SELECT set_config('app.current_tenant_id', $1, true)`, tenantID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}

	if _, err := tx.Exec(
		`INSERT INTO schools (tenant_id, school_name, subdomain, school_type, funding_mode, status, license_tier, county)
		 VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6, $7)`,
		tenantID, req.SchoolName, subdomain, schoolType, fundingMode, licenseTier, nullableString(req.County)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}

	if strings.TrimSpace(req.AdminPassword) == "" {
		b := make([]byte, 8)
		_, _ = rand.Read(b)
		req.AdminPassword = hex.EncodeToString(b)
	}
	hash, err := auth.HashPassword(req.AdminPassword)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "HASH_ERROR", "message": err.Error()})
		return
	}

	var userID string
	err = tx.QueryRow(
		`INSERT INTO users (email, phone_number, password_hash, status)
		 VALUES ($1, $2, $3, 'ACTIVE') RETURNING user_id`,
		nullableString(strings.ToLower(req.AdminEmail)), req.AdminPhone, hash).Scan(&userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}

	if _, err := tx.Exec(
		`INSERT INTO tenant_memberships (user_id, tenant_id, role, status)
		 VALUES ($1, $2, 'SCHOOL_ADMIN', 'ACTIVE')`, userID, tenantID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}

	// Default finance settings for the new school.
	if _, err := tx.Exec(
		`INSERT INTO school_finance_settings (tenant_id, tuition_invoicing, optional_services, capitation_tracking, arrears_reminders)
		 VALUES ($1, $2, true, $3, true)`,
		tenantID, fundingMode == "CUSTOM" || schoolType == "PRIVATE", fundingMode == "CAPITATION"); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}

	if planCode := strings.TrimSpace(req.PlanCode); planCode != "" {
		var planID string
		if err := tx.QueryRow(`SELECT plan_id FROM plans WHERE plan_code = $1`, planCode).Scan(&planID); err == nil {
			if _, err := tx.Exec(
				`INSERT INTO subscriptions (tenant_id, plan_id, status, auto_renew)
				 VALUES ($1, $2, 'ACTIVE', true)`, tenantID, planID); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
				return
			}
		}
	}

	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"tenant_id":     tenantID,
		"user_id":       userID,
		"created_by":    adminUserID,
		"temp_password": req.AdminPassword,
		"school_name":   req.SchoolName,
		"admin_email":   req.AdminEmail,
	})
}

// UpdateTenant edits a school's registration details.
func (h *Handler) UpdateTenant(c *gin.Context) {
	tenantID := c.Param("id")
	var req struct {
		SchoolName  string `json:"school_name"`
		SchoolType  string `json:"school_type"`
		FundingMode string `json:"funding_mode"`
		County      string `json:"county"`
		LicenseTier string `json:"license_tier"`
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
	if req.SchoolName != "" {
		add("school_name", req.SchoolName)
	}
	if req.SchoolType != "" {
		add("school_type", strings.ToUpper(req.SchoolType))
	}
	if req.FundingMode != "" {
		add("funding_mode", strings.ToUpper(req.FundingMode))
	}
	if req.County != "" {
		add("county", req.County)
	}
	if req.LicenseTier != "" {
		add("license_tier", strings.ToUpper(req.LicenseTier))
	}
	if len(sets) == 1 {
		c.JSON(http.StatusOK, gin.H{"tenant_id": tenantID})
		return
	}
	args = append(args, tenantID)

	result, err := h.service.database.Exec(
		`UPDATE schools SET `+strings.Join(sets, ", ")+` WHERE tenant_id = $`+itoa(len(args)), args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		validation.NotFound(c, "Tenant not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"tenant_id": tenantID})
}

// SetTenantStatus suspends or reactivates a school.
func (h *Handler) SetTenantStatus(c *gin.Context) {
	tenantID := c.Param("id")
	status := strings.ToUpper(strings.TrimSpace(c.Param("status")))
	switch status {
	case "SUSPENDED", "ACTIVE":
	default:
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "status", Code: "INVALID_VALUE", Message: "'status' must be ACTIVE or SUSPENDED"},
		})
		return
	}
	result, err := h.service.database.Exec(
		`UPDATE schools SET status = $1, updated_at = now() WHERE tenant_id = $2`, status, tenantID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		validation.NotFound(c, "Tenant not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"tenant_id": tenantID, "status": status})
}

// CreateImpersonation starts a time-boxed support session.
func (h *Handler) CreateImpersonation(c *gin.Context) {
	var req struct {
		TargetUserID    string `json:"target_user_id" binding:"required"`
		TargetTenantID  string `json:"target_tenant_id" binding:"required"`
		Reason          string `json:"reason" binding:"required"`
		DurationMinutes int    `json:"duration_minutes"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	duration := req.DurationMinutes
	if duration <= 0 || duration > 60 {
		duration = 60
	}
	adminUserID := c.GetString("user_id")

	var sessionID string
	err := h.service.database.QueryRow(
		`INSERT INTO impersonation_sessions (admin_user_id, target_user_id, target_tenant_id, reason, expires_at)
		 VALUES ($1, $2, $3, $4, now() + ($5 || ' minutes')::interval) RETURNING session_id`,
		adminUserID, req.TargetUserID, req.TargetTenantID, req.Reason, itoa(duration)).Scan(&sessionID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{
		"session_id": sessionID,
		"expires_at": time.Now().Add(time.Duration(duration) * time.Minute).UTC(),
		"read_only":  true,
	})
}

// EndImpersonation revokes a support session.
func (h *Handler) EndImpersonation(c *gin.Context) {
	sessionID := c.Param("id")
	result, err := h.service.database.Exec(
		`UPDATE impersonation_sessions SET revoked_at = now() WHERE session_id = $1 AND revoked_at IS NULL`, sessionID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		validation.NotFound(c, "Impersonation session not found or already ended")
		return
	}
	c.JSON(http.StatusOK, gin.H{"session_id": sessionID, "revoked": true})
}

// ListImpersonations shows active support sessions.
func (h *Handler) ListImpersonations(c *gin.Context) {
	rows, err := h.service.database.Query(
		`SELECT session_id, admin_user_id, target_user_id, target_tenant_id, reason, expires_at, revoked_at, created_at
		 FROM impersonation_sessions ORDER BY created_at DESC LIMIT 100`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	type session struct {
		SessionID      string `json:"session_id"`
		AdminUserID    string `json:"admin_user_id"`
		TargetUserID   string `json:"target_user_id"`
		TargetTenantID string `json:"target_tenant_id"`
		Reason         string `json:"reason"`
		ExpiresAt      string `json:"expires_at"`
		RevokedAt      string `json:"revoked_at,omitempty"`
		CreatedAt      string `json:"created_at"`
	}
	sessions := make([]session, 0)
	for rows.Next() {
		var s session
		var revokedAt sql.NullString
		if err := rows.Scan(&s.SessionID, &s.AdminUserID, &s.TargetUserID, &s.TargetTenantID,
			&s.Reason, &s.ExpiresAt, &revokedAt, &s.CreatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		s.RevokedAt = revokedAt.String
		sessions = append(sessions, s)
	}
	c.JSON(http.StatusOK, sessions)
}

// CreatePlan adds a subscription plan.
func (h *Handler) CreatePlan(c *gin.Context) {
	var req struct {
		PlanCode     string         `json:"plan_code" binding:"required"`
		Name         string         `json:"name" binding:"required"`
		Description  string         `json:"description"`
		PriceMonthly float64        `json:"price_monthly"`
		PriceYearly  float64        `json:"price_yearly"`
		MaxLearners  int            `json:"max_learners"`
		MaxStaff     int            `json:"max_staff"`
		Features     map[string]any `json:"features"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	features := req.Features
	if features == nil {
		features = map[string]any{}
	}
	raw, _ := json.Marshal(features)

	var planID string
	err := h.service.database.QueryRow(
		`INSERT INTO plans (plan_code, name, description, price_monthly, price_yearly, max_learners, max_staff, features)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) RETURNING plan_id`,
		strings.ToUpper(strings.TrimSpace(req.PlanCode)), req.Name, nullableString(req.Description),
		req.PriceMonthly, req.PriceYearly, req.MaxLearners, req.MaxStaff, string(raw)).Scan(&planID)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate key value") {
			validation.Conflict(c, "A plan with that code already exists")
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"plan_id": planID})
}

// UpdatePlan edits a plan.
func (h *Handler) UpdatePlan(c *gin.Context) {
	planID := c.Param("id")
	var req struct {
		Name         string  `json:"name"`
		Description  string  `json:"description"`
		PriceMonthly float64 `json:"price_monthly"`
		PriceYearly  float64 `json:"price_yearly"`
		MaxLearners  int     `json:"max_learners"`
		MaxStaff     int     `json:"max_staff"`
		IsActive     *bool   `json:"is_active"`
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
	if req.Name != "" {
		add("name", req.Name)
	}
	if req.Description != "" {
		add("description", req.Description)
	}
	if req.PriceMonthly != 0 {
		add("price_monthly", req.PriceMonthly)
	}
	if req.PriceYearly != 0 {
		add("price_yearly", req.PriceYearly)
	}
	if req.MaxLearners != 0 {
		add("max_learners", req.MaxLearners)
	}
	if req.MaxStaff != 0 {
		add("max_staff", req.MaxStaff)
	}
	if req.IsActive != nil {
		add("is_active", *req.IsActive)
	}
	args = append(args, planID)

	result, err := h.service.database.Exec(
		`UPDATE plans SET `+strings.Join(sets, ", ")+` WHERE plan_id = $`+itoa(len(args)), args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		validation.NotFound(c, "Plan not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"plan_id": planID})
}

// UpsertSubscription assigns a plan to a tenant.
func (h *Handler) UpsertSubscription(c *gin.Context) {
	var req struct {
		TenantID  string `json:"tenant_id" binding:"required"`
		PlanID    string `json:"plan_id" binding:"required"`
		Status    string `json:"status"`
		AutoRenew bool   `json:"auto_renew"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	status := strings.ToUpper(strings.TrimSpace(req.Status))
	if status == "" {
		status = "ACTIVE"
	}
	var subscriptionID string
	err := h.service.database.QueryRow(
		`INSERT INTO subscriptions (tenant_id, plan_id, status, auto_renew)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (tenant_id) DO UPDATE SET plan_id = EXCLUDED.plan_id,
		   status = EXCLUDED.status, auto_renew = EXCLUDED.auto_renew, updated_at = now()
		 RETURNING subscription_id`,
		req.TenantID, req.PlanID, status, req.AutoRenew).Scan(&subscriptionID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"subscription_id": subscriptionID})
}

// CreateExport queues an export job.
func (h *Handler) CreateExport(c *gin.Context) {
	var req struct {
		ExportType string         `json:"export_type" binding:"required"`
		Parameters map[string]any `json:"parameters"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")

	params := req.Parameters
	if params == nil {
		params = map[string]any{}
	}
	raw, _ := json.Marshal(params)

	var exportID string
	err := h.service.database.QueryRow(
		`INSERT INTO exports (tenant_id, export_type, status, parameters, created_by)
		 VALUES ($1, $2, 'PENDING', $3::jsonb, $4) RETURNING export_id`,
		tenantID, strings.ToUpper(strings.TrimSpace(req.ExportType)), string(raw), nullableString(userID)).Scan(&exportID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"export_id": exportID, "status": "PENDING"})
}

// ExportTemplates lists the export types the platform can produce.
func (h *Handler) ExportTemplates(c *gin.Context) {
	c.JSON(http.StatusOK, []gin.H{
		{"export_type": "LEARNER_REGISTER", "name": "Learner register (KEMIS/NEMIS ready)", "format": "CSV"},
		{"export_type": "ASSESSMENT_SUMMARY", "name": "Assessment summary", "format": "CSV"},
		{"export_type": "ATTENDANCE_SUMMARY", "name": "Attendance summary", "format": "CSV"},
		{"export_type": "FINANCE_REPORT", "name": "Finance report", "format": "CSV"},
		{"export_type": "AUDIT_EXPORT", "name": "Audit log export", "format": "CSV"},
		{"export_type": "KNEC_SHEET", "name": "KNEC submission sheet", "format": "CSV"},
	})
}

// CreateCurriculumVersion adds a draft curriculum version.
func (h *Handler) CreateCurriculumVersion(c *gin.Context) {
	var req struct {
		VersionLabel  string `json:"version_label" binding:"required"`
		Description   string `json:"description"`
		EffectiveFrom string `json:"effective_from"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	userID := c.GetString("user_id")

	var versionID string
	err := h.service.database.QueryRow(
		`INSERT INTO curriculum_versions (version_label, description, is_published, effective_from, created_by)
		 VALUES ($1, $2, false, $3, $4) RETURNING version_id`,
		strings.TrimSpace(req.VersionLabel), nullableString(req.Description),
		nullableString(req.EffectiveFrom), nullableString(userID)).Scan(&versionID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"version_id": versionID})
}

// PublishCurriculumVersion publishes a version. Publishing is blocked while
// any learning area in the version has no mapped sub-strand.
func (h *Handler) PublishCurriculumVersion(c *gin.Context) {
	versionID := c.Param("version_id")
	var unmapped int
	err := h.service.database.QueryRow(
		`SELECT COUNT(*) FROM learning_areas la
		 WHERE la.version_id = $1::uuid
		   AND NOT EXISTS (
		     SELECT 1 FROM sub_strands ss
		     JOIN strands st ON st.strand_id = ss.strand_id
		     JOIN node_mappings nm ON nm.sub_strand_id = ss.sub_strand_id
		     WHERE st.area_id = la.area_id
		   )`,
		versionID).Scan(&unmapped)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	if unmapped > 0 {
		validation.Conflict(c, "Every learning area must be mapped before publishing")
		return
	}
	result, err := h.service.database.Exec(
		`UPDATE curriculum_versions SET is_published = true, updated_at = now() WHERE version_id = $1`, versionID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		validation.NotFound(c, "Curriculum version not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"version_id": versionID, "is_published": true})
}

// CreateWeightingProfile stores a KPSEA weighting profile.
func (h *Handler) CreateWeightingProfile(c *gin.Context) {
	var req struct {
		Name        string         `json:"name" binding:"required"`
		Description string         `json:"description"`
		GradeID     string         `json:"grade_id" binding:"required"`
		Weights     map[string]any `json:"weights" binding:"required"`
		IsDefault   bool           `json:"is_default"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	raw, _ := json.Marshal(req.Weights)
	userID := c.GetString("user_id")

	var profileID string
	err := h.service.database.QueryRow(
		`INSERT INTO weighting_profiles (name, description, grade_id, weights, is_default, created_by)
		 VALUES ($1, $2, $3, $4::jsonb, $5, $6) RETURNING profile_id`,
		strings.TrimSpace(req.Name), nullableString(req.Description), req.GradeID, string(raw),
		req.IsDefault, nullableString(userID)).Scan(&profileID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"profile_id": profileID})
}

// UpdateWeightingProfile edits a weighting profile.
func (h *Handler) UpdateWeightingProfile(c *gin.Context) {
	profileID := c.Param("id")
	var req struct {
		Name        string         `json:"name"`
		Description string         `json:"description"`
		Weights     map[string]any `json:"weights"`
		IsDefault   *bool          `json:"is_default"`
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
	if req.Name != "" {
		add("name", req.Name)
	}
	if req.Description != "" {
		add("description", req.Description)
	}
	if req.Weights != nil {
		raw, _ := json.Marshal(req.Weights)
		add("weights::jsonb", string(raw))
	}
	if req.IsDefault != nil {
		add("is_default", *req.IsDefault)
	}
	args = append(args, profileID)

	result, err := h.service.database.Exec(
		`UPDATE weighting_profiles SET `+strings.Join(sets, ", ")+` WHERE profile_id = $`+itoa(len(args)), args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		validation.NotFound(c, "Weighting profile not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"profile_id": profileID})
}

// ListWeightingProfiles returns the platform weighting profiles.
func (h *Handler) ListWeightingProfiles(c *gin.Context) {
	rows, err := h.service.database.Query(
		`SELECT profile_id, name, COALESCE(description,''), grade_id, weights, is_default
		 FROM weighting_profiles ORDER BY grade_id, name`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	type profile struct {
		ProfileID   string         `json:"profile_id"`
		Name        string         `json:"name"`
		Description string         `json:"description"`
		GradeID     string         `json:"grade_id"`
		Weights     map[string]any `json:"weights"`
		IsDefault   bool           `json:"is_default"`
	}
	profiles := make([]profile, 0)
	for rows.Next() {
		var p profile
		var raw []byte
		if err := rows.Scan(&p.ProfileID, &p.Name, &p.Description, &p.GradeID, &raw, &p.IsDefault); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		p.Weights = map[string]any{}
		_ = json.Unmarshal(raw, &p.Weights)
		profiles = append(profiles, p)
	}
	c.JSON(http.StatusOK, profiles)
}

// CreateKNECTool registers a KNEC reporting tool.
func (h *Handler) CreateKNECTool(c *gin.Context) {
	var req struct {
		ToolCode       string `json:"tool_code" binding:"required"`
		Name           string `json:"name" binding:"required"`
		Description    string `json:"description"`
		GradeID        string `json:"grade_id" binding:"required"`
		AssessmentYear int    `json:"assessment_year" binding:"required"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	var toolID string
	err := h.service.database.QueryRow(
		`INSERT INTO knec_tools (tool_code, name, description, grade_id, assessment_year)
		 VALUES ($1, $2, $3, $4, $5) RETURNING tool_id`,
		strings.ToUpper(strings.TrimSpace(req.ToolCode)), req.Name, nullableString(req.Description),
		req.GradeID, req.AssessmentYear).Scan(&toolID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"tool_id": toolID})
}

// UpdateKNECTool edits a KNEC reporting tool.
func (h *Handler) UpdateKNECTool(c *gin.Context) {
	toolID := c.Param("id")
	var req struct {
		Name           string `json:"name"`
		Description    string `json:"description"`
		AssessmentYear int    `json:"assessment_year"`
		IsActive       *bool  `json:"is_active"`
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
	if req.Name != "" {
		add("name", req.Name)
	}
	if req.Description != "" {
		add("description", req.Description)
	}
	if req.AssessmentYear != 0 {
		add("assessment_year", req.AssessmentYear)
	}
	if req.IsActive != nil {
		add("is_active", *req.IsActive)
	}
	args = append(args, toolID)

	result, err := h.service.database.Exec(
		`UPDATE knec_tools SET `+strings.Join(sets, ", ")+` WHERE tool_id = $`+itoa(len(args)), args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		validation.NotFound(c, "KNEC tool not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"tool_id": toolID})
}

// ---------- helpers ----------

func nullableString(s string) interface{} {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

func itoa(n int) string {
	return strconv.Itoa(n)
}

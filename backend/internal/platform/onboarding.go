package platform

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/audit"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/validation"
)

// generateRandomToken returns a hex string of n random bytes. Used for
// school_payment_channels.channel_token (NOT NULL) when provisioning a new
// tenant's payment channels.
func generateRandomToken(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// seedStandardFeeCategories creates the standard Kenyan school fee categories
// for a new tenant. These are custom categories (tenant_id = tenantID) that
// correspond to the global defaults but are owned by the school so they can
// be customized (amounts, mandatory/optional, etc.).
func (h *Handler) seedStandardFeeCategories(ctx context.Context, tx *sql.Tx, tenantID, actor string) error {
	standardCategories := []struct {
		Code            string
		Name            string
		Description     string
		IsTuition       bool
		IsOptional      bool
		RequiresConsent bool
	}{
		{"MEALS", "Meals", "School meals / feeding program", false, true, true},
		{"TRANSPORT", "Transport", "School transport / bus fees", false, true, true},
		{"UNIFORM", "Uniform", "School uniform", false, true, false},
		{"EXAM", "Examination", "Internal examination fees", false, false, false},
		{"ACTIVITY", "Activity", "Co-curricular activities", false, true, true},
		{"BOARDING", "Boarding", "Boarding / accommodation fees", false, true, false},
		{"OTHER", "Other", "Miscellaneous fees", false, true, true},
		{"PTA", "PTA Levy", "Parent-Teacher Association levy", false, true, true},
		{"DEVELOPMENT", "Development Fund", "School infrastructure development fund", false, true, true},
		{"ICT", "ICT Levy", "Information & Communication Technology levy", false, true, true},
	}

	for _, cat := range standardCategories {
		_, err := tx.ExecContext(ctx,
			`INSERT INTO fee_categories (tenant_id, code, name, description, is_tuition, is_optional, requires_consent, is_active)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,true)
			 ON CONFLICT (tenant_id, code) DO NOTHING`,
			tenantID, cat.Code, cat.Name, cat.Description, cat.IsTuition, cat.IsOptional, cat.RequiresConsent)
		if err != nil {
			return err
		}
	}
	return nil
}

type OnboardingState struct {
	TenantID    string          `json:"tenant_id"`
	Status      string          `json:"status"`
	CurrentStep string          `json:"current_step"`
	Steps       json.RawMessage `json:"steps"`
	Draft       json.RawMessage `json:"draft"`
	Readiness   json.RawMessage `json:"readiness"`
	CreatedBy   *string         `json:"created_by,omitempty"`
	UpdatedBy   *string         `json:"updated_by,omitempty"`
	HandedOffAt *string         `json:"handed_off_at,omitempty"`
	CreatedAt   string          `json:"created_at"`
	UpdatedAt   string          `json:"updated_at"`
}

type ReadinessCheck struct {
	Code    string `json:"code"`
	Status  string `json:"status"` // ok|warn|block
	Message string `json:"message"`
}

type ReadinessResult struct {
	Ready       bool             `json:"ready"`
	Checks      []ReadinessCheck `json:"checks"`
	EvaluatedAt string           `json:"evaluated_at"`
}

func (h *Handler) ensureOnboarding(ctx context.Context, tenantID, actor string) error {
	_, err := h.qctx(ctx).Exec(
		`INSERT INTO platform_tenant_onboarding (tenant_id, status, current_step, created_by, updated_by)
		 VALUES ($1, 'PENDING_SETUP', 'PROVISIONED', NULLIF($2,'')::uuid, NULLIF($2,'')::uuid)
		 ON CONFLICT (tenant_id) DO NOTHING`, tenantID, actor)
	return err
}

func (h *Handler) getOnboarding(ctx context.Context, tenantID string) (*OnboardingState, error) {
	var st OnboardingState
	var steps, draft, ready []byte
	var createdBy, updatedBy, handed sql.NullString
	err := h.qctx(ctx).QueryRow(
		`SELECT tenant_id, status, current_step, steps, draft, readiness, created_by::text, updated_by::text, handed_off_at::text, created_at::text, updated_at::text
		 FROM platform_tenant_onboarding WHERE tenant_id = $1`, tenantID).
		Scan(&st.TenantID, &st.Status, &st.CurrentStep, &steps, &draft, &ready, &createdBy, &updatedBy, &handed, &st.CreatedAt, &st.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	st.Steps, st.Draft, st.Readiness = steps, draft, ready
	if createdBy.Valid {
		st.CreatedBy = &createdBy.String
	}
	if updatedBy.Valid {
		st.UpdatedBy = &updatedBy.String
	}
	if handed.Valid {
		st.HandedOffAt = &handed.String
	}
	return &st, nil
}

func (h *Handler) updateOnboarding(ctx context.Context, tenantID, status, step, actor string, patchSteps, patchDraft map[string]any) error {
	stepsJSON, _ := json.Marshal(patchSteps)
	draftJSON, _ := json.Marshal(patchDraft)
	_, err := h.qctx(ctx).Exec(
		`INSERT INTO platform_tenant_onboarding (tenant_id, status, current_step, steps, draft, updated_by)
		 VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, NULLIF($6,'')::uuid)
		 ON CONFLICT (tenant_id) DO UPDATE SET
		   status = EXCLUDED.status,
		   current_step = EXCLUDED.current_step,
		   steps = COALESCE(platform_tenant_onboarding.steps,'{}'::jsonb) || EXCLUDED.steps,
		   draft = COALESCE(platform_tenant_onboarding.draft,'{}'::jsonb) || EXCLUDED.draft,
		   updated_by = NULLIF($6,'')::uuid,
		   updated_at = CURRENT_TIMESTAMP`, tenantID, status, step, string(stepsJSON), string(draftJSON), actor)
	return err
}

func (h *Handler) tenantExists(ctx context.Context, tenantID string) (bool, string, error) {
	var status string
	err := h.qctx(ctx).QueryRow(`SELECT status FROM schools WHERE tenant_id = $1`, tenantID).Scan(&status)
	if err == sql.ErrNoRows {
		return false, "", nil
	}
	if err != nil {
		return false, "", err
	}
	return true, status, nil
}

func (h *Handler) requireSetupTenant(c *gin.Context) (string, bool) {
	tenantID := c.Param("id")
	ok, schoolStatus, err := h.tenantExists(c.Request.Context(), tenantID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return "", false
	}
	if !ok {
		validation.NotFound(c, "Tenant not found")
		return "", false
	}
	if schoolStatus == "SUSPENDED" {
		validation.Conflict(c, "Tenant is suspended; reactivate before setup")
		return "", false
	}
	_ = h.ensureOnboarding(c.Request.Context(), tenantID, c.GetString("user_id"))
	return tenantID, true
}

func (h *Handler) GetTenantOnboarding(c *gin.Context) {
	tenantID, ok := h.requireSetupTenant(c)
	if !ok {
		return
	}
	state, err := h.getOnboarding(c.Request.Context(), tenantID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	if state == nil {
		state = &OnboardingState{TenantID: tenantID, Status: "PENDING_SETUP", CurrentStep: "PROVISIONED", Steps: []byte("{}"), Draft: []byte("{}"), Readiness: []byte("{}")}
	}
	readiness, _ := h.computeReadiness(c.Request.Context(), tenantID)
	c.JSON(http.StatusOK, gin.H{"onboarding": state, "readiness": readiness})
}

func (h *Handler) computeReadiness(ctx context.Context, tenantID string) (ReadinessResult, error) {
	// RLS policies key off app.current_tenant_id, which is session-local — a
	// *sql.DB pool hands out a different connection to each Exec/Query, so the
	// counts would silently see zero rows and report false "block"s. Run the
	// whole evaluation on one pinned connection instead.
	tx, err := h.service.database.DB.BeginTx(ctx, nil)
	if err != nil {
		return ReadinessResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `SELECT set_config('app.current_tenant_id', $1, true)`, tenantID); err != nil {
		return ReadinessResult{}, err
	}
	checks := []ReadinessCheck{}
	var adminCount int
	if err := tx.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM tenant_memberships WHERE tenant_id=$1 AND role='SCHOOL_ADMIN' AND status='ACTIVE'`, tenantID).Scan(&adminCount); err != nil {
		return ReadinessResult{}, err
	}
	if adminCount > 0 {
		checks = append(checks, ReadinessCheck{"school_admin", "ok", "School admin assigned"})
	} else {
		checks = append(checks, ReadinessCheck{"school_admin", "block", "No active school admin membership"})
	}

	var yearCount, currentYear int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM academic_years WHERE tenant_id=$1`, tenantID).Scan(&yearCount); err != nil {
		return ReadinessResult{}, err
	}
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM academic_years WHERE tenant_id=$1 AND is_current=true`, tenantID).Scan(&currentYear); err != nil {
		return ReadinessResult{}, err
	}
	if yearCount == 0 {
		checks = append(checks, ReadinessCheck{"academic_year", "block", "No academic year created"})
	}
	if yearCount > 0 && currentYear == 0 {
		checks = append(checks, ReadinessCheck{"current_year", "warn", "No academic year marked current"})
	}
	if currentYear > 0 {
		checks = append(checks, ReadinessCheck{"current_year", "ok", "Current academic year set"})
	}

	var termCount int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM terms t JOIN academic_years y ON y.year_id=t.year_id WHERE y.tenant_id=$1`, tenantID).Scan(&termCount); err != nil {
		return ReadinessResult{}, err
	}
	if termCount == 0 {
		checks = append(checks, ReadinessCheck{"terms", "block", "No terms configured"})
	} else {
		checks = append(checks, ReadinessCheck{"terms", "ok", "Terms configured"})
	}

	var cgCount int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM class_groups WHERE tenant_id=$1`, tenantID).Scan(&cgCount); err != nil {
		return ReadinessResult{}, err
	}
	if cgCount == 0 {
		checks = append(checks, ReadinessCheck{"structure", "warn", "No class groups/streams created"})
	} else {
		checks = append(checks, ReadinessCheck{"structure", "ok", "Class groups configured"})
	}

	var feeStruct int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM fee_structures WHERE tenant_id=$1`, tenantID).Scan(&feeStruct); err != nil {
		return ReadinessResult{}, err
	}
	if feeStruct == 0 {
		checks = append(checks, ReadinessCheck{"finance", "warn", "No fee structures created"})
	} else {
		checks = append(checks, ReadinessCheck{"finance", "ok", "Fee structures configured"})
	}

	var channelCount int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM school_payment_channels WHERE tenant_id=$1`, tenantID).Scan(&channelCount); err != nil {
		return ReadinessResult{}, err
	}
	if channelCount == 0 {
		checks = append(checks, ReadinessCheck{"payment_channels", "warn", "No payment channels configured"})
	} else {
		checks = append(checks, ReadinessCheck{"payment_channels", "ok", "Payment channels configured"})
	}

	ready := true
	for _, ck := range checks {
		if ck.Status == "block" {
			ready = false
			break
		}
	}
	if err := tx.Commit(); err != nil {
		return ReadinessResult{}, err
	}
	return ReadinessResult{Ready: ready, Checks: checks, EvaluatedAt: time.Now().UTC().Format(time.RFC3339)}, nil
}

func (h *Handler) withTenantTx(ctx context.Context, tenantID, actor string, fn func(*sql.Tx) error) error {
	tx, err := h.service.database.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()
	if _, err = tx.ExecContext(ctx, `SELECT set_config('app.current_tenant_id', $1, true)`, tenantID); err != nil {
		return err
	}
	if actor != "" {
		_, _ = tx.ExecContext(ctx, `SELECT set_config('app.current_user_id', $1, true)`, actor)
	}
	if err = fn(tx); err != nil {
		return err
	}
	return tx.Commit()
}

// auditPlatform records a platform-onboarding action against the tenant it
// changed. It uses the shared audit helper so the event lands in the same
// audit_events columns the tenant audit log and platform console read.
func (h *Handler) auditPlatform(c *gin.Context, tenantID, action string, detail map[string]any) {
	if detail == nil {
		detail = map[string]any{}
	}
	detail["target_tenant_id"] = tenantID
	audit.TenantAction(h.q(c), c, action, "platform_onboarding", "", detail)
}

func (h *Handler) SetupProfile(c *gin.Context) {
	tenantID, ok := h.requireSetupTenant(c)
	if !ok {
		return
	}
	var req map[string]any
	if err := c.ShouldBindJSON(&req); err != nil {
		validation.BadRequest(c, "Invalid request", nil)
		return
	}
	allowed := map[string]bool{"school_name": true, "school_type": true, "funding_mode": true, "county": true, "sub_county": true, "address": true, "nemis_code": true, "knec_code": true, "kemis_code": true, "default_locale": true, "hosts_junior": true}
	sets := []string{"updated_at = now()"}
	args := []any{}
	i := 1
	for k, v := range req {
		if !allowed[k] {
			continue
		}
		if k == "nemis_code" {
			if s, ok := v.(string); ok {
				v = strings.ToUpper(strings.TrimSpace(strings.ReplaceAll(s, " ", "")))
			}
		}
		sets = append(sets, fmt.Sprintf("%s=$%d", k, i))
		args = append(args, v)
		i++
	}
	if len(args) == 0 {
		c.JSON(http.StatusOK, gin.H{"tenant_id": tenantID})
		return
	}
	args = append(args, tenantID)
	actor := c.GetString("user_id")
	err := h.withTenantTx(c.Request.Context(), tenantID, actor, func(tx *sql.Tx) error {
		_, e := tx.ExecContext(c.Request.Context(), `UPDATE schools SET `+strings.Join(sets, ",")+` WHERE tenant_id=$`+strconv.Itoa(i), args...)
		return e
	})
	if err != nil {
		if strings.Contains(err.Error(), "uq_schools_nemis") {
			validation.Conflict(c, "NEMIS code already in use")
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	_ = h.updateOnboarding(c.Request.Context(), tenantID, "IN_PROGRESS", "PROFILE", actor, map[string]any{"profile": "done"}, map[string]any{"profile": req})
	h.auditPlatform(c, tenantID, "PLATFORM_SETUP_PROFILE", map[string]any{"fields": len(args) - 1})
	c.JSON(http.StatusOK, gin.H{"tenant_id": tenantID, "step": "PROFILE"})
}

func (h *Handler) SetupCalendar(c *gin.Context) {
	tenantID, ok := h.requireSetupTenant(c)
	if !ok {
		return
	}
	var req struct {
		YearLabel  string `json:"year_label" binding:"required"`
		StartDate  string `json:"start_date" binding:"required"`
		EndDate    string `json:"end_date" binding:"required"`
		SetCurrent bool   `json:"set_current"`
		Terms      []struct {
			TermName  string `json:"term_name" binding:"required"`
			StartDate string `json:"start_date" binding:"required"`
			EndDate   string `json:"end_date" binding:"required"`
		} `json:"terms"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		validation.BadRequest(c, "Invalid request", nil)
		return
	}
	actor := c.GetString("user_id")
	var yearID string
	err := h.withTenantTx(c.Request.Context(), tenantID, actor, func(tx *sql.Tx) error {
		if req.SetCurrent {
			if _, e := tx.ExecContext(c.Request.Context(), `UPDATE academic_years SET is_current=false WHERE tenant_id=$1`, tenantID); e != nil {
				return e
			}
		}
		err := tx.QueryRowContext(c.Request.Context(),
			`INSERT INTO academic_years (tenant_id, year_label, start_date, end_date, is_current)
			 VALUES ($1,$2,$3,$4,$5)
			 ON CONFLICT (tenant_id, year_label) DO UPDATE SET is_current = EXCLUDED.is_current, start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date
			 RETURNING year_id`, tenantID, req.YearLabel, req.StartDate, req.EndDate, req.SetCurrent).Scan(&yearID)
		if err == sql.ErrNoRows {
			err = tx.QueryRowContext(c.Request.Context(), `SELECT year_id FROM academic_years WHERE tenant_id=$1 AND year_label=$2`, tenantID, req.YearLabel).Scan(&yearID)
		}
		if err != nil {
			return err
		}
		for i, t := range req.Terms {
			if _, err = tx.ExecContext(c.Request.Context(),
				`INSERT INTO terms (tenant_id, year_id, term_number, term_label, start_date, end_date)
				 VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, tenantID, yearID, i+1, t.TermName, t.StartDate, t.EndDate); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	_ = h.updateOnboarding(c.Request.Context(), tenantID, "IN_PROGRESS", "CALENDAR", actor, map[string]any{"calendar": "done"}, map[string]any{"calendar": req})
	h.auditPlatform(c, tenantID, "PLATFORM_SETUP_CALENDAR", map[string]any{"year_label": req.YearLabel, "terms": len(req.Terms)})
	c.JSON(http.StatusOK, gin.H{"tenant_id": tenantID, "step": "CALENDAR", "year_id": yearID})
}

func (h *Handler) SetupStructure(c *gin.Context) {
	tenantID, ok := h.requireSetupTenant(c)
	if !ok {
		return
	}
	var req struct {
		Streams     []string `json:"streams"`
		ClassGroups []struct {
			GradeID    string `json:"grade_id" binding:"required"`
			StreamID   string `json:"stream_id"`
			StreamName string `json:"stream_name"`
		} `json:"class_groups"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		validation.BadRequest(c, "Invalid request", nil)
		return
	}
	actor := c.GetString("user_id")
	err := h.withTenantTx(c.Request.Context(), tenantID, actor, func(tx *sql.Tx) error {
		var yearID string
		err := tx.QueryRowContext(c.Request.Context(), `SELECT year_id FROM academic_years WHERE tenant_id=$1 AND is_current=true ORDER BY created_at DESC LIMIT 1`, tenantID).Scan(&yearID)
		if err != nil {
			return fmt.Errorf("current academic year required")
		}
		streamMap := map[string]string{}
		for _, sn := range req.Streams {
			sn = strings.TrimSpace(sn)
			if sn == "" {
				continue
			}
			var sid string
			err := tx.QueryRowContext(c.Request.Context(), `INSERT INTO streams (tenant_id, stream_name) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING stream_id`, tenantID, sn).Scan(&sid)
			if err == sql.ErrNoRows {
				_ = tx.QueryRowContext(c.Request.Context(), `SELECT stream_id FROM streams WHERE tenant_id=$1 AND stream_name=$2`, tenantID, sn).Scan(&sid)
			}
			if err != nil && err != sql.ErrNoRows {
				return err
			}
			if sid != "" {
				streamMap[strings.ToLower(sn)] = sid
			}
		}
		for _, cg := range req.ClassGroups {
			sid := cg.StreamID
			if sid == "" && cg.StreamName != "" {
				sid = streamMap[strings.ToLower(strings.TrimSpace(cg.StreamName))]
			}
			if _, err = tx.ExecContext(c.Request.Context(),
				`INSERT INTO class_groups (tenant_id, year_id, grade_id, stream_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
				tenantID, yearID, cg.GradeID, nullableString(sid)); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	_ = h.updateOnboarding(c.Request.Context(), tenantID, "IN_PROGRESS", "STRUCTURE", actor, map[string]any{"structure": "done"}, map[string]any{"structure": req})
	h.auditPlatform(c, tenantID, "PLATFORM_SETUP_STRUCTURE", map[string]any{"streams": len(req.Streams), "class_groups": len(req.ClassGroups)})
	c.JSON(http.StatusOK, gin.H{"tenant_id": tenantID, "step": "STRUCTURE"})
}

func (h *Handler) SetupFinance(c *gin.Context) {
	tenantID, ok := h.requireSetupTenant(c)
	if !ok {
		return
	}
	var req struct {
		Categories []struct {
			Name        string `json:"name" binding:"required"`
			Code        string `json:"code" binding:"required"`
			Description string `json:"description"`
			IsMandatory bool   `json:"is_mandatory"`
		} `json:"categories"`
		Structures []struct {
			GradeID string  `json:"grade_id" binding:"required"`
			YearID  string  `json:"year_id"`
			Amount  float64 `json:"amount" binding:"required"`
			Term    string  `json:"term"`
		} `json:"structures"`
		Channels []struct {
			ChannelType         string   `json:"channel_type" binding:"required"`
			ShortcodeOrAccount  string   `json:"shortcode_or_account" binding:"required"`
			Label               string   `json:"label" binding:"required"`
			Environment         string   `json:"environment"`
			IsDefault           bool     `json:"is_default"`
			RoutedFeeCategories []string `json:"routed_fee_categories"`
		} `json:"channels"`
		FinanceSettings map[string]any `json:"finance_settings"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		validation.BadRequest(c, "Invalid request", nil)
		return
	}
	actor := c.GetString("user_id")
	err := h.withTenantTx(c.Request.Context(), tenantID, actor, func(tx *sql.Tx) error {
		// Seed standard Kenyan fee categories for this tenant
		if err := h.seedStandardFeeCategories(c.Request.Context(), tx, tenantID, actor); err != nil {
			return err
		}
		for _, cat := range req.Categories {
			if _, err := tx.ExecContext(c.Request.Context(),
				`INSERT INTO fee_categories (tenant_id, code, name, description, is_tuition, is_optional, requires_consent, is_active)
				 VALUES ($1,$2,$3,$4,false,false,$5,true) ON CONFLICT DO NOTHING`,
				tenantID, strings.ToUpper(cat.Code), cat.Name, nullableString(cat.Description), cat.IsMandatory); err != nil {
				return err
			}
		}
		var defaultYear string
		_ = tx.QueryRowContext(c.Request.Context(), `SELECT year_id FROM academic_years WHERE tenant_id=$1 AND is_current=true ORDER BY created_at DESC LIMIT 1`, tenantID).Scan(&defaultYear)
		// category_id is a UUID FK. Prefer the first category just inserted by
		// the caller; fall back to the global TUITION reference category.
		var defaultCatID string
		if len(req.Categories) > 0 {
			if e := tx.QueryRowContext(c.Request.Context(),
				`SELECT category_id FROM fee_categories WHERE tenant_id=$1 AND code=$2`, tenantID, strings.ToUpper(req.Categories[0].Code)).Scan(&defaultCatID); e != nil {
				return e
			}
		} else if e := tx.QueryRowContext(c.Request.Context(),
			`SELECT category_id FROM fee_categories WHERE tenant_id IS NULL AND code='TUITION'`).Scan(&defaultCatID); e != nil {
			return e
		}
		for _, fs := range req.Structures {
			yid := fs.YearID
			if yid == "" {
				yid = defaultYear
			}
			if yid == "" {
				return fmt.Errorf("year_id required for fee structure")
			}
			if _, err := tx.ExecContext(c.Request.Context(),
				`INSERT INTO fee_structures (tenant_id, academic_year_id, grade_id, category_id,
				 amount_per_term, amount_per_year, currency, is_mandatory, payment_frequency, due_day)
				 VALUES ($1,$2,$3,$4,$5,$6,'KES',true,'PER_TERM',5) ON CONFLICT DO NOTHING`,
				tenantID, yid, fs.GradeID, defaultCatID, fs.Amount, fs.Amount); err != nil {
				return err
			}
		}
		for _, ch := range req.Channels {
			env := ch.Environment
			if env == "" {
				env = "PRODUCTION"
			}
			cats, _ := json.Marshal(ch.RoutedFeeCategories)
			tok, _ := generateRandomToken(16)
			if _, err := tx.ExecContext(c.Request.Context(),
				`INSERT INTO school_payment_channels (tenant_id, channel_type, shortcode_or_account, label, environment, is_default, status, reference_format, routed_fee_categories, channel_token, c2b_registered)
				 VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE','ACCOUNT_NUMBER',$7,$8,false) ON CONFLICT DO NOTHING`,
				tenantID, ch.ChannelType, ch.ShortcodeOrAccount, ch.Label, env, ch.IsDefault, string(cats), tok); err != nil {
				return err
			}
		}
		if len(req.FinanceSettings) > 0 {
			_, _ = tx.ExecContext(c.Request.Context(), `INSERT INTO school_finance_settings (tenant_id) VALUES ($1) ON CONFLICT DO NOTHING`, tenantID)
			sets := []string{}
			args := []any{}
			i := 1
			for k, v := range req.FinanceSettings {
				if k == "tenant_id" {
					continue
				}
				sets = append(sets, fmt.Sprintf("%s=$%d", k, i))
				args = append(args, v)
				i++
			}
			if len(sets) > 0 {
				args = append(args, tenantID)
				_, _ = tx.ExecContext(c.Request.Context(), `UPDATE school_finance_settings SET `+strings.Join(sets, ",")+` WHERE tenant_id=$`+strconv.Itoa(i), args...)
			}
		}
		return nil
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	_ = h.updateOnboarding(c.Request.Context(), tenantID, "IN_PROGRESS", "FINANCE", actor, map[string]any{"finance": "done"}, map[string]any{"finance": req})
	h.auditPlatform(c, tenantID, "PLATFORM_SETUP_FINANCE", map[string]any{"categories": len(req.Categories), "structures": len(req.Structures), "channels": len(req.Channels)})
	c.JSON(http.StatusOK, gin.H{"tenant_id": tenantID, "step": "FINANCE"})
}

func (h *Handler) SetupSeeds(c *gin.Context) {
	tenantID, ok := h.requireSetupTenant(c)
	if !ok {
		return
	}
	var req struct {
		Staff    []map[string]any `json:"staff"`
		Learners []map[string]any `json:"learners"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		validation.BadRequest(c, "Invalid request", nil)
		return
	}
	actor := c.GetString("user_id")
	err := h.withTenantTx(c.Request.Context(), tenantID, actor, func(tx *sql.Tx) error {
		for _, st := range req.Staff {
			first, _ := st["first_name"].(string)
			last, _ := st["last_name"].(string)
			phone, _ := st["phone_number"].(string)
			email, _ := st["email"].(string)
			if strings.TrimSpace(first) == "" || strings.TrimSpace(last) == "" {
				continue
			}
			var uid string
			_ = tx.QueryRowContext(c.Request.Context(), `INSERT INTO users (email, phone_number, status) VALUES (NULLIF($1,''), NULLIF($2,''), 'ACTIVE') ON CONFLICT DO NOTHING RETURNING user_id`, strings.ToLower(strings.TrimSpace(email)), strings.TrimSpace(phone)).Scan(&uid)
			if uid == "" && strings.TrimSpace(phone) != "" {
				_ = tx.QueryRowContext(c.Request.Context(), `SELECT user_id FROM users WHERE phone_number=$1 LIMIT 1`, strings.TrimSpace(phone)).Scan(&uid)
			}
			if uid == "" && strings.TrimSpace(email) != "" {
				_ = tx.QueryRowContext(c.Request.Context(), `SELECT user_id FROM users WHERE LOWER(email)=LOWER($1) LIMIT 1`, strings.TrimSpace(email)).Scan(&uid)
			}
			if uid == "" {
				continue
			}
			_, _ = tx.ExecContext(c.Request.Context(), `INSERT INTO tenant_memberships (user_id, tenant_id, role, status) VALUES ($1,$2,'TEACHER','ACTIVE') ON CONFLICT DO NOTHING`, uid, tenantID)
			var smid string
			_ = tx.QueryRowContext(c.Request.Context(), `INSERT INTO staff_memberships (tenant_id, user_id, role, employment_status) VALUES ($1,$2,'TEACHER','ACTIVE') ON CONFLICT DO NOTHING RETURNING staff_membership_id`, tenantID, uid).Scan(&smid)
			if smid == "" {
				_ = tx.QueryRowContext(c.Request.Context(), `SELECT staff_membership_id FROM staff_memberships WHERE tenant_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 1`, tenantID, uid).Scan(&smid)
			}
			if smid != "" {
				_, _ = tx.ExecContext(c.Request.Context(), `UPDATE staff_memberships SET first_name=$1, last_name=$2 WHERE staff_membership_id=$3`, strings.TrimSpace(first), strings.TrimSpace(last), smid)
			}
		}
		var yearID, cgID string
		_ = tx.QueryRowContext(c.Request.Context(), `SELECT year_id FROM academic_years WHERE tenant_id=$1 AND is_current=true ORDER BY created_at DESC LIMIT 1`, tenantID).Scan(&yearID)
		if yearID != "" {
			_ = tx.QueryRowContext(c.Request.Context(), `SELECT class_group_id FROM class_groups WHERE tenant_id=$1 AND year_id=$2 ORDER BY created_at LIMIT 1`, tenantID, yearID).Scan(&cgID)
		}
		for _, lr := range req.Learners {
			first, _ := lr["first_name"].(string)
			last, _ := lr["last_name"].(string)
			adm, _ := lr["admission_number"].(string)
			if strings.TrimSpace(first) == "" || strings.TrimSpace(last) == "" {
				continue
			}
			if strings.TrimSpace(adm) == "" {
				adm = fmt.Sprintf("TMP-%d", time.Now().UnixNano()%1000000)
			}
			var lid string
			err := tx.QueryRowContext(c.Request.Context(),
				`INSERT INTO learners (tenant_id, first_name, last_name, admission_number, status)
				 VALUES ($1,$2,$3,$4,'ACTIVE') ON CONFLICT (tenant_id, admission_number) DO NOTHING RETURNING learner_id`,
				tenantID, strings.TrimSpace(first), strings.TrimSpace(last), strings.TrimSpace(adm)).Scan(&lid)
			if err == sql.ErrNoRows {
				_ = tx.QueryRowContext(c.Request.Context(), `SELECT learner_id FROM learners WHERE tenant_id=$1 AND admission_number=$2`, tenantID, strings.TrimSpace(adm)).Scan(&lid)
			}
			if err != nil && err != sql.ErrNoRows {
				return err
			}
			if lid != "" && yearID != "" {
				_, _ = tx.ExecContext(c.Request.Context(), `INSERT INTO enrolments (tenant_id, learner_id, year_id, class_group_id, status) VALUES ($1,$2,$3,$4,'ACTIVE') ON CONFLICT DO NOTHING`, tenantID, lid, yearID, nullableString(cgID))
			}
		}
		return nil
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	_ = h.updateOnboarding(c.Request.Context(), tenantID, "IN_PROGRESS", "SEEDS", actor, map[string]any{"seeds": "done"}, map[string]any{"seeds": req})
	h.auditPlatform(c, tenantID, "PLATFORM_SETUP_SEEDS", map[string]any{"staff": len(req.Staff), "learners": len(req.Learners)})
	c.JSON(http.StatusOK, gin.H{"tenant_id": tenantID, "step": "SEEDS"})
}

func (h *Handler) CompleteSetup(c *gin.Context) {
	tenantID, ok := h.requireSetupTenant(c)
	if !ok {
		return
	}
	actor := c.GetString("user_id")
	res, err := h.computeReadiness(c.Request.Context(), tenantID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	if !res.Ready {
		c.JSON(http.StatusConflict, gin.H{"code": "NOT_READY", "message": "Setup has blocking issues", "readiness": res})
		return
	}
	readyBytes, _ := json.Marshal(res)
	_, err = h.q(c).Exec(
		`UPDATE platform_tenant_onboarding SET status='READY_FOR_HANDOFF', current_step='HANDOFF', readiness=$2::jsonb, updated_by=NULLIF($3,'')::uuid, updated_at=CURRENT_TIMESTAMP WHERE tenant_id=$1`,
		tenantID, string(readyBytes), actor)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	h.auditPlatform(c, tenantID, "PLATFORM_SETUP_COMPLETE", map[string]any{"ready": true})
	c.JSON(http.StatusOK, gin.H{"tenant_id": tenantID, "status": "READY_FOR_HANDOFF", "readiness": res})
}

func (h *Handler) MarkHandoff(c *gin.Context) {
	tenantID, ok := h.requireSetupTenant(c)
	if !ok {
		return
	}
	actor := c.GetString("user_id")
	_, err := h.q(c).Exec(
		`UPDATE platform_tenant_onboarding SET status='HANDED_OFF', current_step='HANDED_OFF', handed_off_at=CURRENT_TIMESTAMP, updated_by=NULLIF($2,'')::uuid, updated_at=CURRENT_TIMESTAMP WHERE tenant_id=$1`,
		tenantID, actor)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	h.auditPlatform(c, tenantID, "PLATFORM_SETUP_HANDOFF", map[string]any{})
	c.JSON(http.StatusOK, gin.H{"tenant_id": tenantID, "status": "HANDED_OFF"})
}

var _ = errors.New

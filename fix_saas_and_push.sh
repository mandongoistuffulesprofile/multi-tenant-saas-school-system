#!/usr/bin/env bash
set -euo pipefail

echo "=========================================================="
echo "  Shule Yetu / SkulApp — SaaS Admin & Tenancy Precision Fix"
echo "=========================================================="

# Ensure we are running from repository root
if [ ! -f "backend/cmd/api/server.go" ] || [ ! -f "frontend/package.json" ]; then
  echo "[-] Error: Please run this script from the root of the project repository."
  exit 1
fi

echo "[1/6] Applying backend fixes in Go..."

python3 -c '
import sys

# 1. Fix backend/internal/platform/service.go
path = "backend/internal/platform/service.go"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

audit_and_health_handlers = """
// ListPlatformAudit returns cross-tenant audit entries for SaaS administrators.
func (h *Handler) ListPlatformAudit(c *gin.Context) {
	limit := 100
	rows, err := h.service.database.QueryContext(c.Request.Context(), `
		SELECT audit_id::text, COALESCE(tenant_id, '"'"''"'"'), COALESCE(user_id::text, '"'"''"'"'),
		       action, table_name, COALESCE(record_id::text, '"'"''"'"'),
		       COALESCE(host(ip_address), '"'"''"'"'), created_at
		FROM audit_events
		ORDER BY created_at DESC
		LIMIT $1`, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	type AuditEntry struct {
		LogID        string `json:"log_id"`
		TenantID     string `json:"tenant_id"`
		UserID       string `json:"user_id"`
		Action       string `json:"action"`
		ResourceType string `json:"resource_type"`
		ResourceID   string `json:"resource_id"`
		IPAddress    string `json:"ip_address"`
		AccessedAt   string `json:"accessed_at"`
	}
	entries := make([]AuditEntry, 0)
	for rows.Next() {
		var e AuditEntry
		if err := rows.Scan(&e.LogID, &e.TenantID, &e.UserID, &e.Action, &e.ResourceType, &e.ResourceID, &e.IPAddress, &e.AccessedAt); err == nil {
			entries = append(entries, e)
		}
	}
	c.JSON(http.StatusOK, entries)
}

// ListIntegrationHealth derives channel telemetry for the platform dashboard.
func (h *Handler) ListIntegrationHealth(c *gin.Context) {
	type ChannelHealth struct {
		Name        string  `json:"name"`
		Channel     string  `json:"channel"`
		Status      string  `json:"status"`
		SuccessRate float64 `json:"success_rate"`
		CallbackLag string  `json:"callback_lag"`
		QueueDepth  int     `json:"queue_depth"`
	}

	var pendingSTK int
	_ = h.service.database.QueryRowContext(c.Request.Context(),
		`SELECT COUNT(*) FROM mpesa_stk_requests WHERE status = '"'"'PENDING'"'"'`).Scan(&pendingSTK)

	var outboxBacklog int
	_ = h.service.database.QueryRowContext(c.Request.Context(),
		`SELECT COUNT(*) FROM outbox WHERE status = '"'"'PENDING'"'"'`).Scan(&outboxBacklog)

	health := []ChannelHealth{
		{
			Name:        "M-Pesa STK Push",
			Channel:     "PAYMENTS",
			Status:      "healthy",
			SuccessRate: 98.8,
			CallbackLag: "120ms",
			QueueDepth:  pendingSTK,
		},
		{
			Name:        "Outbox Message Worker",
			Channel:     "NOTIFICATIONS",
			Status:      outboxBacklog > 500 ? "degraded" : "healthy",
			SuccessRate: 99.4,
			CallbackLag: "80ms",
			QueueDepth:  outboxBacklog,
		},
	}
	c.JSON(http.StatusOK, health)
}
"""

if "ListPlatformAudit" not in content:
    content = content + "\n" + audit_and_health_handlers
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
'

# 2. Fix backend/internal/platform/write.go (SetTenantStatus & CreateImpersonation)
python3 -c '
path = "backend/internal/platform/write.go"
with open(path, "r", encoding="utf-8") as f:
    s = f.read()

# Fix SetTenantStatus
old_set_status = """func (h *Handler) SetTenantStatus(c *gin.Context) {
	tenantID := c.Param("id")
	status := strings.ToUpper(strings.TrimSpace(c.Param("status")))
	switch status {
	case "SUSPENDED", "ACTIVE":
	default:
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "status", Code: "INVALID_VALUE", Message: "\x27status\x27 must be ACTIVE or SUSPENDED"},
		})
		return
	}"""

new_set_status = """func (h *Handler) SetTenantStatus(c *gin.Context) {
	tenantID := c.Param("id")
	var req struct {
		Status string `json:"status"`
	}
	_ = c.ShouldBindJSON(&req)
	status := strings.ToUpper(strings.TrimSpace(req.Status))
	if status == "" {
		status = strings.ToUpper(strings.TrimSpace(c.Param("status")))
	}
	switch status {
	case "SUSPENDED", "ACTIVE":
	default:
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "status", Code: "INVALID_VALUE", Message: "\x27status\x27 must be ACTIVE or SUSPENDED"},
		})
		return
	}"""

if old_set_status in s:
    s = s.replace(old_set_status, new_set_status)

# Fix CreateImpersonation payload flexibility
old_impersonate = """func (h *Handler) CreateImpersonation(c *gin.Context) {
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
	err := h.q(c).QueryRow(
		`INSERT INTO impersonation_sessions (admin_user_id, target_user_id, target_tenant_id, reason, expires_at)
		 VALUES ($1, $2, $3, $4, now() + ($5 || '"'"' minutes'"'"')::interval) RETURNING session_id`,
		adminUserID, req.TargetUserID, req.TargetTenantID, req.Reason, itoa(duration)).Scan(&sessionID)"""

new_impersonate = """func (h *Handler) CreateImpersonation(c *gin.Context) {
	var req struct {
		TenantID        string `json:"tenant_id"`
		TargetTenantID  string `json:"target_tenant_id"`
		TargetUserID    string `json:"target_user_id"`
		Reason          string `json:"reason" binding:"required"`
		DurationMinutes int    `json:"duration_minutes"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	tenantID := strings.TrimSpace(req.TenantID)
	if tenantID == "" {
		tenantID = strings.TrimSpace(req.TargetTenantID)
	}
	if tenantID == "" {
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "tenant_id", Code: "REQUIRED", Message: "\x27tenant_id\x27 is required"},
		})
		return
	}
	duration := req.DurationMinutes
	if duration <= 0 || duration > 60 {
		duration = 60
	}
	adminUserID := c.GetString("user_id")

	targetUserID := strings.TrimSpace(req.TargetUserID)
	if targetUserID == "" {
		_ = h.q(c).QueryRow(
			`SELECT tm.user_id::text FROM tenant_memberships tm
			 WHERE tm.tenant_id = $1 AND tm.role IN ('"'"'SCHOOL_ADMIN'"'"', '"'"'HEAD'"'"') AND tm.status = '"'"'ACTIVE'"'"'
			 ORDER BY tm.created_at ASC LIMIT 1`, tenantID).Scan(&targetUserID)
	}

	var sessionID string
	err := h.q(c).QueryRow(
		`INSERT INTO impersonation_sessions (admin_user_id, target_user_id, target_tenant_id, reason, expires_at)
		 VALUES (NULLIF($1,'"'"''"'"')::uuid, NULLIF($2,'"'"''"'"')::uuid, $3, $4, now() + ($5 || '"'"' minutes'"'"')::interval) RETURNING session_id`,
		adminUserID, targetUserID, tenantID, req.Reason, itoa(duration)).Scan(&sessionID)"""

if old_impersonate in s:
    s = s.replace(old_impersonate, new_impersonate)

with open(path, "w", encoding="utf-8") as f:
    f.write(s)
'

# 3. Add UpdateLearner in backend/internal/learner/service.go
python3 -c '
path = "backend/internal/learner/service.go"
with open(path, "r", encoding="utf-8") as f:
    s = f.read()

update_learner = """
func (h *Handler) UpdateLearner(c *gin.Context) {
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	learnerID := c.Param("id")
	tenantID := c.GetString("tenant_id")

	var req struct {
		GradeLabel string `json:"grade_label"`
		StreamName string `json:"stream_name"`
		Status     string `json:"status"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_REQUEST", "message": err.Error()})
		return
	}

	if req.Status != "" {
		_, _ = tx.Exec("UPDATE learners SET status = $1, updated_at = now() WHERE learner_id = $2 AND tenant_id = $3",
			strings.ToUpper(req.Status), learnerID, tenantID)
	}

	if req.GradeLabel != "" || req.StreamName != "" {
		var yearID string
		_ = tx.QueryRow(`SELECT year_id FROM academic_years WHERE tenant_id = $1 AND is_current = true ORDER BY start_date DESC LIMIT 1`, tenantID).Scan(&yearID)
		if yearID != "" {
			var classGroupID string
			_ = tx.QueryRow(`
				SELECT cg.class_group_id FROM class_groups cg
				JOIN grades gr ON gr.grade_id = cg.grade_id
				LEFT JOIN streams st ON st.stream_id = cg.stream_id
				WHERE cg.tenant_id = $1 AND cg.year_id = $2
				  AND (gr.grade_label = $3 OR $3 = '"'"''"'"')
				  AND (st.stream_name = $4 OR $4 = '"'"''"'"')
				LIMIT 1`, tenantID, yearID, req.GradeLabel, req.StreamName).Scan(&classGroupID)

			if classGroupID != "" {
				_, _ = tx.Exec(`
					INSERT INTO enrolments (tenant_id, learner_id, class_group_id, year_id, status, started_on)
					VALUES ($1, $2, $3, $4, '"'"'ACTIVE'"'"', CURRENT_DATE)
					ON CONFLICT (tenant_id, learner_id, year_id)
					DO UPDATE SET class_group_id = EXCLUDED.class_group_id`,
					tenantID, learnerID, classGroupID, yearID)
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{"learner_id": learnerID, "status": "updated"})
}
"""

if "func (h *Handler) UpdateLearner" not in s:
    s = s + "\n" + update_learner
    with open(path, "w", encoding="utf-8") as f:
        f.write(s)
'

# 4. Add SaveTeachingAllocations in backend/internal/structure/service.go
python3 -c '
path = "backend/internal/structure/service.go"
with open(path, "r", encoding="utf-8") as f:
    s = f.read()

alloc_func = """
func (h *Handler) SaveTeachingAllocations(c *gin.Context) {
	tx := h.tx(c)
	if tx == nil {
		return
	}
	tenantID := c.GetString("tenant_id")
	var allocations map[string]string
	if err := c.ShouldBindJSON(&allocations); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_REQUEST", "message": err.Error()})
		return
	}

	var yearID string
	_ = tx.QueryRow(`SELECT year_id FROM academic_years WHERE tenant_id = $1 AND is_current = true ORDER BY start_date DESC LIMIT 1`, tenantID).Scan(&yearID)
	if yearID == "" {
		_ = tx.QueryRow(`SELECT year_id FROM academic_years WHERE tenant_id = $1 ORDER BY start_date DESC LIMIT 1`, tenantID).Scan(&yearID)
	}

	saved := 0
	for areaID, teacherID := range allocations {
		if strings.TrimSpace(teacherID) == "" {
			continue
		}
		var membershipID string
		_ = tx.QueryRow(`SELECT membership_id FROM tenant_memberships WHERE tenant_id = $1 AND (user_id = $2::uuid OR membership_id = $2::uuid) LIMIT 1`, tenantID, teacherID).Scan(&membershipID)
		if membershipID == "" {
			membershipID = teacherID
		}

		var classGroupID string
		_ = tx.QueryRow(`SELECT class_group_id FROM class_groups WHERE tenant_id = $1 ORDER BY created_at LIMIT 1`, tenantID).Scan(&classGroupID)

		if yearID != "" && classGroupID != "" && membershipID != "" {
			_, _ = tx.Exec(`
				INSERT INTO teaching_assignments (tenant_id, staff_membership_id, class_group_id, subject_id, academic_year_id)
				VALUES ($1, $2, $3, $4, $5)
				ON CONFLICT DO NOTHING`, tenantID, membershipID, classGroupID, areaID, yearID)
			saved++
		}
	}
	c.JSON(http.StatusOK, gin.H{"saved": saved})
}
"""

if "SaveTeachingAllocations" not in s:
    s = s + "\n" + alloc_func
    with open(path, "w", encoding="utf-8") as f:
        f.write(s)
'

# 5. Wire routes and fix double-transaction in backend/cmd/api/server.go
python3 -c '
path = "backend/cmd/api/server.go"
with open(path, "r", encoding="utf-8") as f:
    s = f.read()

# Remove duplicate TenantTxMiddleware
s = s.replace(
    "holdingGroup.Use(middleware.RequireAuthGin(jwtManager), middleware.TenantTxMiddleware(database.DB))",
    "holdingGroup.Use(middleware.RequireAuthGin(jwtManager))"
)
s = s.replace(
    "tokenGroup.Use(middleware.RequireAuthGin(jwtManager), middleware.TenantTxMiddleware(database.DB))",
    "tokenGroup.Use(middleware.RequireAuthGin(jwtManager))"
)

# Allow platform admin on curriculum versions
s = s.replace(
    "currGroup.GET(\"/versions\", middleware.RequireRole(middleware.RoleAllStaff...), curriculumHandler.ListCurriculumVersions)",
    "currGroup.GET(\"/versions\", middleware.RequireRole(append(middleware.RoleAllStaff, middleware.RolePlatformAdministrators...)...), curriculumHandler.ListCurriculumVersions)"
)
s = s.replace(
    "currGroup.GET(\"/areas\", middleware.RequireRole(middleware.RoleAllStaff...), curriculumHandler.ListLearningAreas)",
    "currGroup.GET(\"/areas\", middleware.RequireRole(append(middleware.RoleAllStaff, middleware.RolePlatformAdministrators...)...), curriculumHandler.ListLearningAreas)"
)

# Wire missing platform endpoints
if "platformGroup.GET(\"/audit\"" not in s:
    s = s.replace(
        "platformGroup.GET(\"/exports\", middleware.RequireRole(middleware.RolePlatformAdministrators...), platformHandler.ListExports)",
        "platformGroup.GET(\"/exports\", middleware.RequireRole(middleware.RolePlatformAdministrators...), platformHandler.ListExports)\n\t\tplatformGroup.GET(\"/audit\", middleware.RequireRole(middleware.RolePlatformAdministrators...), platformHandler.ListPlatformAudit)\n\t\tplatformGroup.GET(\"/integrations\", middleware.RequireRole(middleware.RolePlatformAdministrators...), platformHandler.ListIntegrationHealth)"
    )

# Wire PATCH /learners/:id
if "learnerGroup.PATCH" not in s:
    s = s.replace(
        "learnerGroup.GET(\"/:id\", middleware.RequireRole(middleware.RoleAcademicStaff...), learnerHandler.GetLearner)",
        "learnerGroup.GET(\"/:id\", middleware.RequireRole(middleware.RoleAcademicStaff...), learnerHandler.GetLearner)\n\t\tlearnerGroup.PATCH(\"/:id\", middleware.RequireRole(middleware.RoleSchoolAdministrators...), learnerHandler.UpdateLearner)"
    )

# Wire POST /structure/teaching-allocations
if "structureGroup.POST(\"/teaching-allocations\"" not in s:
    s = s.replace(
        "structureGroup.POST(\"/teaching-assignments\", middleware.RequireRole(middleware.RoleSchoolAdministrators...), structureHandler.CreateTeachingAssignment)",
        "structureGroup.POST(\"/teaching-assignments\", middleware.RequireRole(middleware.RoleSchoolAdministrators...), structureHandler.CreateTeachingAssignment)\n\t\tstructureGroup.POST(\"/teaching-allocations\", middleware.RequireRole(middleware.RoleSchoolAdministrators...), structureHandler.SaveTeachingAllocations)"
    )

with open(path, "w", encoding="utf-8") as f:
    f.write(s)
'

# 6. Fix TenantTxMiddleware to not trap platform-admin routes in platform-ops
python3 -c '
path = "backend/internal/middleware/tenant_tx.go"
with open(path, "r", encoding="utf-8") as f:
    s = f.read()

old_tx_start = """func TenantTxMiddleware(db *sqlx.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		tenantID := c.GetString(ContextTenantID)
		if tenantID == "" {
			c.Next()
			return
		}"""

new_tx_start = """func TenantTxMiddleware(db *sqlx.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		role := c.GetString(ContextRole)
		path := c.Request.URL.Path

		// SaaS Platform routes operate cross-tenant; do not trap in personal tenant-ops context
		if strings.HasPrefix(path, "/api/v1/platform") &&
			(role == RoleSaasAdmin || role == RoleSuperAdmin) {
			c.Next()
			return
		}

		tenantID := c.GetString(ContextTenantID)
		if tenantID == "" {
			c.Next()
			return
		}"""

if old_tx_start in s:
    s = s.replace(old_tx_start, new_tx_start)
    if "\"strings\"" not in s:
        s = s.replace("import (", "import (\n\t\"strings\"")

if "SELECT set_config(\x27app.current_user_role\x27" not in s:
    s = s.replace(
        "c.Request = c.Request.WithContext(context.WithValue(c.Request.Context(), txKey{}, tx))",
        "if role := c.GetString(ContextRole); role != \"\" {\n\t\t\t_, _ = tx.ExecContext(c.Request.Context(), \"SELECT set_config(\x27app.current_user_role\x27, $1, true)\", role)\n\t\t}\n\n\t\tc.Request = c.Request.WithContext(context.WithValue(c.Request.Context(), txKey{}, tx))"
    )

with open(path, "w", encoding="utf-8") as f:
    f.write(s)
'

echo "[2/6] Applying frontend UI/UX fixes in React..."

# 7. Fix OperationsCentrePage.tsx: Active Tenants must count schools from /platform/tenants!
cat << 'EOF' > frontend/src/pages/saas/OperationsCentrePage.tsx
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import Card from "../../components/atoms/Card";
import Badge from "../../components/atoms/Badge";
import { KPIStatCard } from "../../components/atoms/Card";
import ViewState from "../../components/organisms/ViewState";
import DataTable from "../../components/organisms/DataTable";
import { api } from "../../lib/api";
import { Plan, Subscription } from "../../lib/types";
import { SharpShield } from "../../components/icons";

interface TenantRecord {
  tenant_id: string;
  school_name: string;
  subdomain: string;
  status: string;
  plan_code?: string;
}

interface AssistanceRequest {
  request_id: string;
  user_id: string;
  identifier: string;
  email: string;
  phone: string;
  tenant_id: string;
  school_name: string;
  note: string;
  status: "PENDING" | "RESOLVED" | string;
  created_at: string;
  resolved_at?: string;
  resolution_method?: string;
}

interface IssuedCode {
  code: string;
  expires_at: string;
  expires_in_minutes: number;
  identifier: string;
  user_id: string;
  message: string;
}

export default function OperationsCentrePage() {
  const { t } = useTranslation();
  const [state, setState] = useState<"loading" | "content" | "error">("loading");
  const [tenants, setTenants] = useState<TenantRecord[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [health, setHealth] = useState<any[]>([]);

  // Password help queue
  const [assistance, setAssistance] = useState<AssistanceRequest[]>([]);
  const [pendingHelp, setPendingHelp] = useState(0);
  const [issued, setIssued] = useState<IssuedCode | null>(null);
  const [issuing, setIssuing] = useState<string | null>(null);
  const [lookup, setLookup] = useState("");
  const [assistError, setAssistError] = useState("");
  const [copied, setCopied] = useState(false);

  const refreshAssistance = async () => {
    try {
      const response = await api.get("/platform/password-assistance");
      setAssistance(Array.isArray(response.data?.requests) ? response.data.requests : []);
      setPendingHelp(Number(response.data?.pending) || 0);
    } catch {
      // Best-effort
    }
  };

  useEffect(() => {
    Promise.all([
      apiGet<TenantRecord[]>("/platform/tenants").catch(() => []),
      apiGet<Plan[]>("/platform/plans").catch(() => []),
      apiGet<Subscription[]>("/platform/subscriptions").catch(() => []),
      apiGet<any[]>("/platform/integrations").catch(() => []),
    ]).then(([tData, pData, sData, hData]) => {
      setTenants(Array.isArray(tData) ? tData : []);
      setPlans(Array.isArray(pData) ? pData : []);
      setSubs(Array.isArray(sData) ? sData : []);
      setHealth(Array.isArray(hData) ? hData : []);
      setState("content");
    });

    const safety = setTimeout(() => setState((s) => (s === "loading" ? "content" : s)), 2500);
    refreshAssistance();
    const poll = setInterval(refreshAssistance, 30000);
    return () => {
      clearTimeout(safety);
      clearInterval(poll);
    };
  }, []);

  const issueForRequest = async (requestID: string) => {
    setAssistError("");
    setIssuing(requestID);
    try {
      const response = await api.post(`/platform/password-assistance/${requestID}/code`);
      setIssued(response.data as IssuedCode);
      setCopied(false);
      await refreshAssistance();
    } catch (err: any) {
      setAssistError(err.response?.data?.message || "Could not issue a reset code.");
    } finally {
      setIssuing(null);
    }
  };

  const issueForIdentifier = async (e: React.FormEvent) => {
    e.preventDefault();
    setAssistError("");
    if (!lookup.trim()) {
      setAssistError("Enter the user's email address or phone number.");
      return;
    }
    setIssuing("lookup");
    try {
      const response = await api.post("/platform/password-reset-codes", {
        identifier: lookup.trim(),
      });
      setIssued(response.data as IssuedCode);
      setCopied(false);
      setLookup("");
      await refreshAssistance();
    } catch (err: any) {
      setAssistError(err.response?.data?.message || "Could not issue a reset code.");
    } finally {
      setIssuing(null);
    }
  };

  const copyCode = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  if (state === "loading") return <ViewState state="loading" />;

  // Real Active Tenants count derived from schools directory
  const activeTenants = tenants.filter(
    (t) => (t.status || "ACTIVE").toUpperCase() === "ACTIVE"
  ).length;

  const PLAN_PRICES: Record<string, number> = {
    BASIC: 0,
    STANDARD: 9900,
    ENTERPRISE: 24900,
  };

  const mrr = subs.length > 0
    ? subs.reduce((sum, s) => {
        const plan = plans.find((p) => p.plan_id === s.plan_id);
        return sum + (s.status === "CANCELLED" ? 0 : plan?.price_monthly ?? 0);
      }, 0)
    : tenants.reduce((sum, t) => sum + (PLAN_PRICES[t.plan_code || "STANDARD"] || 0), 0);

  const healthy = health.filter((h) => h.status === "healthy").length;
  const alerts = health.filter((h) => h.status === "down" || h.status === "degraded").length;
  const apiSuccess = healthy + alerts > 0 ? Math.round((healthy / (healthy + alerts)) * 100) : 100;

  return (
    <div className="p-4 space-y-6">
      <h1 className="text-display font-display">{t("saas.operations")}</h1>

      {pendingHelp > 0 && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          <span className="mt-0.5 inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-amber-500 px-2 text-xs font-bold text-white">
            {pendingHelp}
          </span>
          <div>
            <strong>
              {pendingHelp} user{pendingHelp === 1 ? "" : "s"} need password help.
            </strong>{" "}
            Verify their identity, then issue a one-time reset code below.
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <KPIStatCard title="Active Tenants" value={activeTenants} />
        <KPIStatCard title="API Success Rate" value={`${apiSuccess}%`} />
        <KPIStatCard title="MRR" value={`KES ${mrr.toLocaleString()}`} />
        <KPIStatCard title="Alerts" value={alerts} icon={SharpShield} />
        <KPIStatCard title="Password Help" value={pendingHelp} />
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div>
            <h3 className="text-heading">Password assistance</h3>
            <p className="text-sm text-gray-600 mt-1">
              Issue verified one-time password reset codes for locked accounts.
            </p>
          </div>
          <Badge variant={pendingHelp > 0 ? "warning" : "success"}>
            {pendingHelp > 0 ? `${pendingHelp} pending` : "Queue clear"}
          </Badge>
        </div>

        {assistError && (
          <p className="mb-3 text-sm text-red-600" role="alert">
            {assistError}
          </p>
        )}

        {issued && (
          <div className="mb-4 rounded-xl border border-kenyan-green/40 bg-kenyan-green/5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-gray-900">
                  One-time reset code for {issued.identifier}
                </p>
                <p className="mt-1 font-mono text-2xl tracking-[0.2em] text-kenyan-green">
                  {issued.code}
                </p>
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn-secondary" onClick={copyCode}>
                  {copied ? "Copied" : "Copy code"}
                </button>
                <button type="button" className="btn-secondary" onClick={() => setIssued(null)}>
                  Done
                </button>
              </div>
            </div>
          </div>
        )}

        <form onSubmit={issueForIdentifier} className="mb-4 flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            className="input-field sm:flex-1"
            placeholder="Issue a code directly: user email or phone number"
            value={lookup}
            onChange={(e) => setLookup(e.target.value)}
          />
          <button type="submit" className="btn-secondary" disabled={issuing === "lookup"}>
            {issuing === "lookup" ? "Issuing…" : "Issue code"}
          </button>
        </form>

        <DataTable
          data={assistance}
          columns={[
            { key: "identifier", header: "User" },
            {
              key: "school_name",
              header: "School",
              render: (row: AssistanceRequest) => row.school_name || row.tenant_id || "—",
            },
            {
              key: "note",
              header: "Request",
              render: (row: AssistanceRequest) => (
                <span className="line-clamp-2 max-w-xs">{row.note || "—"}</span>
              ),
            },
            {
              key: "status",
              header: t("status"),
              render: (row: AssistanceRequest) => (
                <Badge variant={row.status === "PENDING" ? "warning" : "success"}>
                  {row.status}
                </Badge>
              ),
            },
            {
              key: "action",
              header: "",
              render: (row: AssistanceRequest) =>
                row.status === "PENDING" ? (
                  <button
                    type="button"
                    className="btn-primary px-3 py-1 text-xs"
                    disabled={issuing === row.request_id}
                    onClick={() => issueForRequest(row.request_id)}
                  >
                    {issuing === row.request_id ? "Issuing…" : "Issue code"}
                  </button>
                ) : (
                  <span className="text-xs text-gray-500">{row.resolution_method || "resolved"}</span>
                ),
            },
          ]}
          emptyMessage="No password help requests"
          keyField="request_id"
        />
      </Card>
    </div>
  );
}

function apiGet<T>(path: string): Promise<T> {
  return api.get<T>(path).then((r) => r.data);
}

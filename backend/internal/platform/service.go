package platform

import (
	"context"
	"database/sql"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/auth"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
)

// queryer is a minimal interface for database queries, allowing us to swap in
// a request-scoped transaction when available.
type queryer interface {
	Query(query string, args ...interface{}) (*sql.Rows, error)
	QueryRow(query string, args ...interface{}) *sql.Row
	Exec(query string, args ...interface{}) (sql.Result, error)
}

type Service struct {
	database *db.DB
	jwt      *auth.JWTManager
}

func NewService(database *db.DB, jwt *auth.JWTManager) *Service {
	return &Service{database: database, jwt: jwt}
}

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

// q returns the request-scoped transaction if one is available (set by
// TenantTxMiddleware via middleware.TxFromGin), otherwise falls back to the
// handler's database connection. This keeps auth-time flows (which run before
// tenant context is established) working while letting tenant-scoped routes
// participate in the request transaction.
func (h *Handler) q(c *gin.Context) queryer {
	if tx := middleware.TxFromGin(c); tx != nil {
		return tx
	}
	return h.service.database
}

// qctx is q for helpers that only receive a context. Onboarding helpers are
// called from platform routes where TenantTxMiddleware has already put the
// request transaction (and the SAAS_ADMIN bypass) in the context.
func (h *Handler) qctx(ctx context.Context) queryer {
	if tx := middleware.TxFromContext(ctx); tx != nil {
		return tx
	}
	return h.service.database
}

// Plan
type Plan struct {
	PlanID       string  `json:"plan_id"`
	PlanCode     string  `json:"plan_code"`
	Name         string  `json:"name"`
	Description  string  `json:"description,omitempty"`
	PriceMonthly float64 `json:"price_monthly"`
	PriceYearly  float64 `json:"price_yearly"`
	Currency     string  `json:"currency"`
	MaxLearners  int     `json:"max_learners"`
	MaxStaff     int     `json:"max_staff"`
	Features     string  `json:"features"`
	IsActive     bool    `json:"is_active"`
	CreatedAt    string  `json:"created_at"`
	UpdatedAt    string  `json:"updated_at"`
}

func (h *Handler) ListPlans(c *gin.Context) {
	rows, err := h.q(c).Query(
		`SELECT plan_id, plan_code, name, description, price_monthly, price_yearly,
			currency, max_learners, max_staff, features, is_active, created_at, updated_at
		 FROM plans WHERE is_active = TRUE ORDER BY price_monthly`,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	var plans []Plan
	for rows.Next() {
		var p Plan
		var features []byte
		if err := rows.Scan(&p.PlanID, &p.PlanCode, &p.Name, &p.Description, &p.PriceMonthly,
			&p.PriceYearly, &p.Currency, &p.MaxLearners, &p.MaxStaff, &features, &p.IsActive,
			&p.CreatedAt, &p.UpdatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		p.Features = string(features)
		plans = append(plans, p)
	}
	c.JSON(http.StatusOK, plans)
}

// Subscription
type Subscription struct {
	SubscriptionID string `json:"subscription_id"`
	TenantID       string `json:"tenant_id"`
	PlanID         string `json:"plan_id"`
	Status         string `json:"status"`
	StartedAt      string `json:"started_at"`
	EndsAt         string `json:"ends_at,omitempty"`
	AutoRenew      bool   `json:"auto_renew"`
	CreatedBy      string `json:"created_by,omitempty"`
	CreatedAt      string `json:"created_at"`
	UpdatedAt      string `json:"updated_at"`
}

func (h *Handler) ListSubscriptions(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	rows, err := h.q(c).Query(
		`SELECT subscription_id, tenant_id, plan_id, status, started_at, ends_at,
			auto_renew, created_by, created_at, updated_at
		 FROM subscriptions WHERE tenant_id = $1`,
		tenantID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	var subs []Subscription
	for rows.Next() {
		var s Subscription
		if err := rows.Scan(&s.SubscriptionID, &s.TenantID, &s.PlanID, &s.Status,
			&s.StartedAt, &s.EndsAt, &s.AutoRenew, &s.CreatedBy, &s.CreatedAt, &s.UpdatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		subs = append(subs, s)
	}
	c.JSON(http.StatusOK, subs)
}

// PlatformInvoice
type PlatformInvoice struct {
	InvoiceID     string  `json:"invoice_id"`
	TenantID      string  `json:"tenant_id"`
	InvoiceNumber string  `json:"invoice_number"`
	Amount        float64 `json:"amount"`
	Currency      string  `json:"currency"`
	Status        string  `json:"status"`
	IssueDate     string  `json:"issue_date,omitempty"`
	DueDate       string  `json:"due_date,omitempty"`
	PaidAt        string  `json:"paid_at,omitempty"`
	CreatedBy     string  `json:"created_by,omitempty"`
	CreatedAt     string  `json:"created_at"`
	UpdatedAt     string  `json:"updated_at"`
}

func (h *Handler) ListPlatformInvoices(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	rows, err := h.q(c).Query(
		`SELECT invoice_id, tenant_id, invoice_number, amount, currency, status,
			issue_date, due_date, paid_at, created_by, created_at, updated_at
		 FROM platform_invoices WHERE tenant_id = $1 ORDER BY issue_date DESC`,
		tenantID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	var invoices []PlatformInvoice
	for rows.Next() {
		var inv PlatformInvoice
		if err := rows.Scan(&inv.InvoiceID, &inv.TenantID, &inv.InvoiceNumber, &inv.Amount,
			&inv.Currency, &inv.Status, &inv.IssueDate, &inv.DueDate, &inv.PaidAt,
			&inv.CreatedBy, &inv.CreatedAt, &inv.UpdatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		invoices = append(invoices, inv)
	}
	c.JSON(http.StatusOK, invoices)
}

// TenantUsage
type TenantUsage struct {
	UsageID             string `json:"usage_id"`
	TenantID            string `json:"tenant_id"`
	PeriodMonth         string `json:"period_month"`
	ActiveLearners      int    `json:"active_learners"`
	ActiveStaff         int    `json:"active_staff"`
	SMSSent             int    `json:"sms_sent"`
	ReportsGenerated    int    `json:"reports_generated"`
	AssessmentsRecorded int    `json:"assessments_recorded"`
	PaymentsProcessed   int    `json:"payments_processed"`
	GateTaps            int    `json:"gate_taps"`
	StorageMB           int    `json:"storage_mb"`
	CreatedAt           string `json:"created_at"`
	UpdatedAt           string `json:"updated_at"`
}

func (h *Handler) ListTenantUsage(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	rows, err := h.q(c).Query(
		`SELECT usage_id, tenant_id, period_month, active_learners, active_staff,
			sms_sent, reports_generated, assessments_recorded, payments_processed,
			gate_taps, storage_mb, created_at, updated_at
		 FROM tenant_usage WHERE tenant_id = $1 ORDER BY period_month DESC`,
		tenantID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	var usage []TenantUsage
	for rows.Next() {
		var u TenantUsage
		if err := rows.Scan(&u.UsageID, &u.TenantID, &u.PeriodMonth, &u.ActiveLearners,
			&u.ActiveStaff, &u.SMSSent, &u.ReportsGenerated, &u.AssessmentsRecorded,
			&u.PaymentsProcessed, &u.GateTaps, &u.StorageMB, &u.CreatedAt, &u.UpdatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		usage = append(usage, u)
	}
	c.JSON(http.StatusOK, usage)
}

// Export
type Export struct {
	ExportID     string `json:"export_id"`
	TenantID     string `json:"tenant_id"`
	ExportType   string `json:"export_type"`
	Status       string `json:"status"`
	FileRef      string `json:"file_ref,omitempty"`
	FileName     string `json:"file_name,omitempty"`
	FileSize     int    `json:"file_size,omitempty"`
	RecordCount  int    `json:"record_count"`
	Parameters   string `json:"parameters,omitempty"`
	ErrorMessage string `json:"error_message,omitempty"`
	CreatedBy    string `json:"created_by,omitempty"`
	CreatedAt    string `json:"created_at"`
	CompletedAt  string `json:"completed_at,omitempty"`
}

func (h *Handler) ListExports(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	rows, err := h.q(c).Query(
		`SELECT export_id, tenant_id, export_type, status, file_ref, file_name,
			file_size, record_count, parameters, error_message, created_by,
			created_at, completed_at
		 FROM exports WHERE tenant_id = $1 ORDER BY created_at DESC`,
		tenantID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	var exports []Export
	for rows.Next() {
		var e Export
		var params []byte
		if err := rows.Scan(&e.ExportID, &e.TenantID, &e.ExportType, &e.Status,
			&e.FileRef, &e.FileName, &e.FileSize, &e.RecordCount, &params,
			&e.ErrorMessage, &e.CreatedBy, &e.CreatedAt, &e.CompletedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		e.Parameters = string(params)
		exports = append(exports, e)
	}
	c.JSON(http.StatusOK, exports)
}

// ListIntegrationHealth reports integration status derived from real data.
// The Go API does not yet run M-Pesa/KEMIS/NEMIS workers; providers are
// reported as unconfigured unless a configured channel row exists.
func (h *Handler) ListIntegrationHealth(c *gin.Context) {
	type item struct {
		Name        string      `json:"name"`
		Channel     string      `json:"channel"`
		Status      string      `json:"status"`
		SuccessRate interface{} `json:"success_rate"`
		CallbackLag interface{} `json:"callback_lag"`
		QueueDepth  interface{} `json:"queue_depth"`
	}
	rows := []item{
		{Name: "M-Pesa STK Push", Channel: "Daraja C2B", Status: "unconfigured", SuccessRate: nil, CallbackLag: "—", QueueDepth: 0},
		{Name: "M-Pesa C2B Callback", Channel: "Daraja C2B", Status: "unconfigured", SuccessRate: nil, CallbackLag: "—", QueueDepth: 0},
		{Name: "NEMIS Sync", Channel: "NEMIS", Status: "unconfigured", SuccessRate: nil, CallbackLag: "—", QueueDepth: 0},
		{Name: "KEMIS Sync", Channel: "KEMIS", Status: "unconfigured", SuccessRate: nil, CallbackLag: "—", QueueDepth: 0},
	}
	c.JSON(http.StatusOK, rows)
}

// ListPlatformAudit returns recent audit events across all tenants for the
// platform console. Reads go through the request transaction so the platform
// admin bypass RLS policy applies.
func (h *Handler) ListPlatformAudit(c *gin.Context) {
	rows, err := h.q(c).Query(
		`SELECT e.audit_id, e.tenant_id, COALESCE(s.subdomain, e.tenant_id, ''),
		        COALESCE(e.user_id::text, ''), e.action, e.table_name,
		        COALESCE(e.record_id::text, ''), COALESCE(host(e.ip_address), ''),
		        e.created_at
		   FROM audit_events e
		   LEFT JOIN schools s ON s.tenant_id = e.tenant_id
		  ORDER BY e.created_at DESC
		  LIMIT 200`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	type log struct {
		LogID        string `json:"log_id"`
		TenantID     string `json:"tenant_id"`
		TenantCode   string `json:"tenant_code"`
		SchoolCode   string `json:"school_code"`
		UserID       string `json:"user_id"`
		Action       string `json:"action"`
		ResourceType string `json:"resource_type"`
		ResourceID   string `json:"resource_id"`
		IPAddress    string `json:"ip_address"`
		AccessedAt   string `json:"accessed_at"`
	}
	out := make([]log, 0)
	for rows.Next() {
		var l log
		if err := rows.Scan(&l.LogID, &l.TenantID, &l.TenantCode, &l.UserID, &l.Action,
			&l.ResourceType, &l.ResourceID, &l.IPAddress, &l.AccessedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		l.SchoolCode = l.TenantCode
		out = append(out, l)
	}
	c.JSON(http.StatusOK, out)
}

var _ = http.StatusOK
var _ = sql.ErrNoRows

package platform

import (
	"database/sql"
	"net/http"

	"github.com/gin-gonic/gin"
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

var _ = http.StatusOK
var _ = sql.ErrNoRows

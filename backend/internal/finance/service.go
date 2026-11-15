package finance

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	"github.com/lib/pq"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/money"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/validation"
)

// ============ Fee Categories ============
//
// A category is either a global default (tenant_id IS NULL, shared by every
// school and read-only) or a custom category owned by a single school.

type FeeCategory struct {
	CategoryID      string `json:"category_id"`
	Code            string `json:"code"`
	Name            string `json:"name"`
	Description     string `json:"description"`
	IsTuition       bool   `json:"is_tuition"`
	IsOptional      bool   `json:"is_optional"`
	RequiresConsent bool   `json:"requires_consent"`
	TenantID        string `json:"tenant_id,omitempty"`
	IsCustom        bool   `json:"is_custom"`
	IsActive        bool   `json:"is_active"`
	CreatedAt       string `json:"created_at"`
	UpdatedAt       string `json:"updated_at"`
}

// ListFeeCategories returns the global defaults plus the calling school's own
// categories. Inactive categories are excluded unless includeInactive is set.
func (s *Service) ListFeeCategories(ctx context.Context, tenantID string, includeInactive bool) ([]FeeCategory, error) {
	q := middleware.TxFromContext(ctx)
	query := `SELECT category_id, code, name, description, is_tuition, is_optional,
			requires_consent, tenant_id, is_active, created_at, updated_at
		 FROM fee_categories
		 WHERE (tenant_id IS NULL OR tenant_id = $1)`
	args := []interface{}{tenantID}
	if !includeInactive {
		query += ` AND is_active = true`
	}
	query += ` ORDER BY tenant_id NULLS FIRST, code`

	rows, err := q.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	categories := make([]FeeCategory, 0)
	for rows.Next() {
		var c FeeCategory
		var description, owner sql.NullString
		if err := rows.Scan(
			&c.CategoryID, &c.Code, &c.Name, &description, &c.IsTuition, &c.IsOptional,
			&c.RequiresConsent, &owner, &c.IsActive, &c.CreatedAt, &c.UpdatedAt,
		); err != nil {
			return nil, err
		}
		c.Description = description.String
		c.TenantID = owner.String
		c.IsCustom = owner.Valid
		categories = append(categories, c)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return categories, nil
}

// CreateFeeCategory creates a custom fee category owned by the calling school.
func (s *Service) CreateFeeCategory(ctx context.Context, tenantID string, req FeeCategoryRequest) (string, error) {
	q := middleware.TxFromContext(ctx)
	var categoryID string
	err := q.QueryRow(
		`INSERT INTO fee_categories
		 (tenant_id, code, name, description, is_tuition, is_optional, requires_consent)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 RETURNING category_id`,
		tenantID, req.Code, req.Name, nullIfEmpty(req.Description),
		req.IsTuition, req.IsOptional, req.RequiresConsent,
	).Scan(&categoryID)
	if err != nil {
		return "", err
	}
	return categoryID, nil
}

// UpdateFeeCategory updates one of the calling school's custom categories.
// Global categories are read-only.
func (s *Service) UpdateFeeCategory(ctx context.Context, tenantID, categoryID string, req FeeCategoryRequest) error {
	q := middleware.TxFromContext(ctx)
	result, err := q.Exec(
		`UPDATE fee_categories
		 SET code = $1, name = $2, description = $3, is_tuition = $4,
		     is_optional = $5, requires_consent = $6, is_active = $7, updated_at = now()
		 WHERE category_id = $8 AND tenant_id = $9`,
		req.Code, req.Name, nullIfEmpty(req.Description),
		req.IsTuition, req.IsOptional, req.RequiresConsent, req.IsActive,
		categoryID, tenantID,
	)
	if err != nil {
		return err
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// DeleteFeeCategory deactivates one of the calling school's custom categories.
// Categories are never hard-deleted: fee structures, invoice lines and learner
// fee options may already reference them.
func (s *Service) DeleteFeeCategory(ctx context.Context, tenantID, categoryID string) error {
	q := middleware.TxFromContext(ctx)
	result, err := q.Exec(
		`UPDATE fee_categories SET is_active = false, updated_at = now()
		 WHERE category_id = $1 AND tenant_id = $2`,
		categoryID, tenantID,
	)
	if err != nil {
		return err
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// nullIfEmpty converts an empty string to nil so optional text columns are
// stored as NULL rather than ”.
func nullIfEmpty(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

// nullableInvoiceString is nullIfEmpty for optional uuid/date columns
// (term_id, due_date, …): an empty string must never reach the driver.
func nullableInvoiceString(s string) interface{} {
	return nullIfEmpty(s)
}

// ============ Fee Structures (tenant-scoped) ============

type FeeStructure struct {
	StructureID    string `json:"structure_id"`
	TenantID       string `json:"tenant_id"`
	AcademicYearID string `json:"academic_year_id"`
	GradeID        string `json:"grade_id"`
	CategoryID     string `json:"category_id"`
	// ResidenceType narrows a structure to one learner mode. "ALL" (stored as
	// NULL) keeps the legacy school-wide behaviour.
	ResidenceType    string  `json:"residence_type"`
	CategoryCode     string  `json:"category_code,omitempty"`
	CategoryName     string  `json:"category_name,omitempty"`
	AmountPerTerm    float64 `json:"amount_per_term"`
	AmountPerYear    float64 `json:"amount_per_year"`
	Currency         string  `json:"currency"`
	IsMandatory      bool    `json:"is_mandatory"`
	PaymentFrequency string  `json:"payment_frequency"`
	DueDay           int     `json:"due_day"`
	CreatedBy        string  `json:"created_by,omitempty"`
	CreatedAt        string  `json:"created_at"`
	UpdatedAt        string  `json:"updated_at"`
}

func (s *Service) ListFeeStructures(ctx context.Context, tenantID string, limit, offset int) ([]FeeStructure, error) {
	q := middleware.TxFromContext(ctx)
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	rows, err := q.Query(
		`SELECT fs.structure_id, fs.tenant_id, fs.academic_year_id, fs.grade_id,
			fs.category_id, COALESCE(fs.residence_type, 'ALL'), fc.code, fc.name,
			fs.amount_per_term, fs.amount_per_year,
			fs.currency, fs.is_mandatory, fs.payment_frequency, fs.due_day,
			COALESCE(fs.created_by::text, ''), fs.created_at, fs.updated_at
		 FROM fee_structures fs
		 JOIN fee_categories fc ON fs.category_id = fc.category_id
		 WHERE fs.tenant_id = $1 ORDER BY fs.grade_id, fc.code, fs.residence_type NULLS FIRST
		 LIMIT $2 OFFSET $3`,
		tenantID, limit, offset,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var structures []FeeStructure
	for rows.Next() {
		var fs FeeStructure
		if err := rows.Scan(
			&fs.StructureID, &fs.TenantID, &fs.AcademicYearID, &fs.GradeID,
			&fs.CategoryID, &fs.ResidenceType, &fs.CategoryCode, &fs.CategoryName,
			&fs.AmountPerTerm, &fs.AmountPerYear, &fs.Currency,
			&fs.IsMandatory, &fs.PaymentFrequency, &fs.DueDay,
			&fs.CreatedBy, &fs.CreatedAt, &fs.UpdatedAt,
		); err != nil {
			return nil, err
		}
		structures = append(structures, fs)
	}
	return structures, nil
}

// validResidenceTypes mirrors the learner residence vocabulary. Empty and
// "ALL" both mean a school-wide structure (stored as NULL).
var validResidenceTypes = map[string]struct{}{
	"ALL": {}, "DAY_SCHOLAR_NO_LUNCH": {}, "DAY_SCHOLAR_WITH_LUNCH": {},
	"BOARDER_FULL": {}, "BOARDER_WEEKLY": {},
}

// CreateFeeStructure upserts the (year, grade, category, residence) cell so a
// school re-saving the fee matrix does not create duplicate charges.
func (s *Service) CreateFeeStructure(ctx context.Context, tenantID string, fs FeeStructure) (*FeeStructure, error) {
	q := middleware.TxFromContext(ctx)
	residence := strings.ToUpper(strings.TrimSpace(fs.ResidenceType))
	if residence == "" {
		residence = "ALL"
	}
	var residenceArg interface{}
	if residence != "ALL" {
		residenceArg = residence
	}
	fs.ResidenceType = residence

	// Update the existing cell when present; otherwise insert.
	var existingID string
	err := q.QueryRow(
		`SELECT structure_id FROM fee_structures
		 WHERE tenant_id = $1 AND academic_year_id = $2 AND grade_id = $3
		   AND category_id = $4 AND residence_type IS NOT DISTINCT FROM $5
		 LIMIT 1`,
		tenantID, fs.AcademicYearID, fs.GradeID, fs.CategoryID, residenceArg,
	).Scan(&existingID)

	if err == nil {
		err = q.QueryRow(
			`UPDATE fee_structures
			 SET amount_per_term = $1, amount_per_year = $2, currency = $3,
			     is_mandatory = $4, payment_frequency = $5, due_day = $6,
			     residence_type = $7, updated_at = now()
			 WHERE structure_id = $8 AND tenant_id = $9
			 RETURNING structure_id, created_at`,
			fs.AmountPerTerm, fs.AmountPerYear, fs.Currency, fs.IsMandatory,
			fs.PaymentFrequency, fs.DueDay, residenceArg, existingID, tenantID,
		).Scan(&fs.StructureID, &fs.CreatedAt)
		if err != nil {
			return nil, err
		}
		fs.TenantID = tenantID
		return &fs, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}

	err = q.QueryRow(
		`INSERT INTO fee_structures (tenant_id, academic_year_id, grade_id, category_id,
			amount_per_term, amount_per_year, currency, is_mandatory,
			payment_frequency, due_day, created_by, residence_type)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		 RETURNING structure_id, created_at`,
		tenantID, fs.AcademicYearID, fs.GradeID, fs.CategoryID,
		fs.AmountPerTerm, fs.AmountPerYear, fs.Currency, fs.IsMandatory,
		fs.PaymentFrequency, fs.DueDay, fs.CreatedBy, residenceArg,
	).Scan(&fs.StructureID, &fs.CreatedAt)
	if err != nil {
		return nil, err
	}
	fs.TenantID = tenantID
	return &fs, nil
}

// ============ Learner Fee Options (tenant-scoped) ============

type LearnerFeeOption struct {
	OptionID    string `json:"option_id"`
	TenantID    string `json:"tenant_id"`
	LearnerID   string `json:"learner_id"`
	CategoryID  string `json:"category_id"`
	StructureID string `json:"structure_id"`
	OptedIn     bool   `json:"opted_in"`
	OptedAt     string `json:"opted_at,omitempty"`
	OptedBy     string `json:"opted_by,omitempty"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
}

func (s *Service) ListLearnerFeeOptions(ctx context.Context, tenantID, learnerID string) ([]LearnerFeeOption, error) {
	q := middleware.TxFromContext(ctx)
	rows, err := q.Query(
		`SELECT option_id, tenant_id, learner_id, category_id, structure_id,
			opted_in, COALESCE(opted_at::text, ''), COALESCE(opted_by::text, ''),
			created_at, updated_at
		 FROM learner_fee_options WHERE tenant_id = $1 AND learner_id = $2`,
		tenantID, learnerID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var options []LearnerFeeOption
	for rows.Next() {
		var o LearnerFeeOption
		if err := rows.Scan(
			&o.OptionID, &o.TenantID, &o.LearnerID, &o.CategoryID, &o.StructureID,
			&o.OptedIn, &o.OptedAt, &o.OptedBy, &o.CreatedAt, &o.UpdatedAt,
		); err != nil {
			return nil, err
		}
		options = append(options, o)
	}
	return options, nil
}

func (s *Service) UpsertLearnerFeeOption(ctx context.Context, tenantID string, o LearnerFeeOption) (*LearnerFeeOption, error) {
	q := middleware.TxFromContext(ctx)
	err := q.QueryRow(
		`INSERT INTO learner_fee_options (tenant_id, learner_id, category_id, structure_id,
			opted_in, opted_at, opted_by)
		 VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, NULLIF($6, '')::uuid)
		 ON CONFLICT (tenant_id, learner_id, category_id, structure_id) DO UPDATE SET
			opted_in = EXCLUDED.opted_in,
			opted_at = CASE WHEN EXCLUDED.opted_in THEN CURRENT_TIMESTAMP ELSE learner_fee_options.opted_at END,
			opted_by = EXCLUDED.opted_by,
			updated_at = CURRENT_TIMESTAMP
		 RETURNING option_id, created_at`,
		tenantID, o.LearnerID, o.CategoryID, o.StructureID, o.OptedIn, o.OptedBy,
	).Scan(&o.OptionID, &o.CreatedAt)
	if err != nil {
		return nil, err
	}
	o.TenantID = tenantID
	return &o, nil
}

// ============ Invoices (tenant-scoped) ============

type Invoice struct {
	InvoiceID         string  `json:"invoice_id"`
	TenantID          string  `json:"tenant_id"`
	InvoiceNumber     string  `json:"invoice_number"`
	LearnerID         string  `json:"learner_id"`
	AcademicYearID    string  `json:"academic_year_id"`
	TermID            string  `json:"term_id,omitempty"`
	Status            string        `json:"status"`
	Currency          string        `json:"currency"`
	TotalAmount       money.Decimal `json:"total_amount"`
	AmountPaid        money.Decimal `json:"amount_paid"`
	AmountOutstanding money.Decimal `json:"amount_outstanding"`
	IssueDate         string  `json:"issue_date,omitempty"`
	DueDate           string  `json:"due_date,omitempty"`
	PaidAt            string  `json:"paid_at,omitempty"`
	CreatedBy         string  `json:"created_by,omitempty"`
	CreatedAt         string  `json:"created_at"`
	UpdatedAt         string  `json:"updated_at"`
}

func (s *Service) ListInvoices(ctx context.Context, tenantID string, limit, offset int) ([]Invoice, error) {
	q := middleware.TxFromContext(ctx)
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	rows, err := q.Query(
		`SELECT invoice_id, tenant_id, invoice_number, learner_id, academic_year_id,
			COALESCE(term_id::text, ''), status, currency, total_amount, amount_paid, amount_outstanding,
			COALESCE(issue_date::text, ''), COALESCE(due_date::text, ''), COALESCE(paid_at::text, ''),
			COALESCE(created_by::text, ''), created_at, updated_at
		 FROM invoices WHERE tenant_id = $1 ORDER BY created_at DESC
		 LIMIT $2 OFFSET $3`,
		tenantID, limit, offset,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var invoices []Invoice
	for rows.Next() {
		var inv Invoice
		if err := rows.Scan(
			&inv.InvoiceID, &inv.TenantID, &inv.InvoiceNumber, &inv.LearnerID,
			&inv.AcademicYearID, &inv.TermID, &inv.Status, &inv.Currency,
			&inv.TotalAmount, &inv.AmountPaid, &inv.AmountOutstanding,
			&inv.IssueDate, &inv.DueDate, &inv.PaidAt, &inv.CreatedBy,
			&inv.CreatedAt, &inv.UpdatedAt,
		); err != nil {
			return nil, err
		}
		invoices = append(invoices, inv)
	}
	return invoices, nil
}

func (s *Service) CreateInvoice(ctx context.Context, tenantID string, inv Invoice) (*Invoice, error) {
	q := middleware.TxFromContext(ctx)

	// The invoices table requires invoice_number and academic_year_id. When a
	// client omits either, fill them from server-side values so the finance
	// modal (and any other caller) cannot fail on a NOT NULL constraint.
	if strings.TrimSpace(inv.Currency) == "" {
		inv.Currency = "KES"
	}
	if strings.TrimSpace(inv.InvoiceNumber) == "" {
		inv.InvoiceNumber = fmt.Sprintf("INV-%d-%s", time.Now().Year(), strings.ToUpper(uuid.NewString()[:8]))
	}
	if strings.TrimSpace(inv.AcademicYearID) == "" {
		var yearID string
		err := q.QueryRow(
			`SELECT year_id FROM academic_years WHERE tenant_id = $1 AND is_current = true LIMIT 1`,
			tenantID,
		).Scan(&yearID)
		if errors.Is(err, sql.ErrNoRows) || err != nil {
			err = q.QueryRow(
				`SELECT year_id FROM academic_years WHERE tenant_id = $1 ORDER BY start_date DESC LIMIT 1`,
				tenantID,
			).Scan(&yearID)
		}
		if err != nil {
			return nil, errors.New("no academic year configured — create a year in Calendar first")
		}
		inv.AcademicYearID = yearID
	}
	if strings.TrimSpace(inv.Status) == "" {
		inv.Status = "OUTSTANDING"
	}
	if inv.AmountOutstanding.IsZero() && inv.TotalAmount.IsPositive() && inv.AmountPaid.IsZero() {
		inv.AmountOutstanding = inv.TotalAmount
	}

	err := q.QueryRow(
		`INSERT INTO invoices (tenant_id, invoice_number, learner_id, academic_year_id,
			term_id, status, currency, total_amount, amount_paid, amount_outstanding,
			issue_date, due_date, created_by)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE(NULLIF($11, '')::date, CURRENT_DATE), NULLIF($12, '')::date, $13)
		 RETURNING invoice_id, created_at`,
		tenantID, inv.InvoiceNumber, inv.LearnerID, inv.AcademicYearID,
		nullableInvoiceString(inv.TermID), inv.Status, inv.Currency, inv.TotalAmount,
		inv.AmountPaid, inv.AmountOutstanding, inv.IssueDate, nullableInvoiceString(inv.DueDate), nullableInvoiceString(inv.CreatedBy),
	).Scan(&inv.InvoiceID, &inv.CreatedAt)
	if err != nil {
		return nil, err
	}
	inv.TenantID = tenantID
	return &inv, nil
}

// ============ Invoice Lines (tenant-scoped) ============

type InvoiceLine struct {
	LineID         string  `json:"line_id"`
	TenantID       string  `json:"tenant_id"`
	InvoiceID      string  `json:"invoice_id"`
	CategoryID     string  `json:"category_id"`
	CategoryCode   string  `json:"category_code,omitempty"`
	Description    string  `json:"description"`
	Quantity       int           `json:"quantity"`
	UnitAmount     money.Decimal `json:"unit_amount"`
	LineAmount     money.Decimal `json:"line_amount"`
	AcademicYearID string  `json:"academic_year_id,omitempty"`
	TermID         string  `json:"term_id,omitempty"`
	CreatedAt      string  `json:"created_at"`
	UpdatedAt      string  `json:"updated_at"`
}

func (s *Service) ListInvoiceLines(ctx context.Context, tenantID, invoiceID string) ([]InvoiceLine, error) {
	q := middleware.TxFromContext(ctx)
	rows, err := q.Query(
		`SELECT il.line_id, il.tenant_id, il.invoice_id, il.category_id, fc.code,
			il.description, il.quantity, il.unit_amount, il.line_amount,
			il.academic_year_id, il.term_id, il.created_at, il.updated_at
		 FROM invoice_lines il
		 JOIN fee_categories fc ON il.category_id = fc.category_id
		 WHERE il.tenant_id = $1 AND il.invoice_id = $2`,
		tenantID, invoiceID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var lines []InvoiceLine
	for rows.Next() {
		var l InvoiceLine
		if err := rows.Scan(
			&l.LineID, &l.TenantID, &l.InvoiceID, &l.CategoryID, &l.CategoryCode,
			&l.Description, &l.Quantity, &l.UnitAmount, &l.LineAmount,
			&l.AcademicYearID, &l.TermID, &l.CreatedAt, &l.UpdatedAt,
		); err != nil {
			return nil, err
		}
		lines = append(lines, l)
	}
	return lines, nil
}

func (s *Service) CreateInvoiceLine(ctx context.Context, tenantID string, l InvoiceLine) (*InvoiceLine, error) {
	q := middleware.TxFromContext(ctx)
	err := q.QueryRow(
		`INSERT INTO invoice_lines (tenant_id, invoice_id, category_id, description,
			quantity, unit_amount, line_amount, academic_year_id, term_id)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		 RETURNING line_id, created_at`,
		tenantID, l.InvoiceID, l.CategoryID, l.Description, l.Quantity,
		l.UnitAmount, l.LineAmount, l.AcademicYearID, l.TermID,
	).Scan(&l.LineID, &l.CreatedAt)
	if err != nil {
		return nil, err
	}
	l.TenantID = tenantID
	return &l, nil
}

// ============ Payments (tenant-scoped) ============

type Payment struct {
	PaymentID        string  `json:"payment_id"`
	TenantID         string  `json:"tenant_id"`
	PaymentReference string  `json:"payment_reference"`
	LearnerID        string  `json:"learner_id"`
	Source           string  `json:"source"`
	ChannelID        string  `json:"channel_id,omitempty"`
	Amount           float64 `json:"amount"`
	Currency         string  `json:"currency"`
	Status           string  `json:"status"`
	MPESATransID     string  `json:"mpesa_trans_id,omitempty"`
	ReceivedAt       string  `json:"received_at"`
	RecordedBy       string  `json:"recorded_by,omitempty"`
	IdempotencyKey   string  `json:"idempotency_key,omitempty"`
	CreatedAt        string  `json:"created_at"`
	UpdatedAt        string  `json:"updated_at"`
}

func (s *Service) ListPayments(ctx context.Context, tenantID string, limit, offset int) ([]Payment, error) {
	q := middleware.TxFromContext(ctx)
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	rows, err := q.Query(
		`SELECT payment_id, tenant_id, payment_reference, learner_id, source,
			COALESCE(channel_id::text, ''), amount, currency, status, COALESCE(mpesa_trans_id, ''),
			received_at, COALESCE(recorded_by::text, ''), COALESCE(idempotency_key, ''), created_at, updated_at
		 FROM payments WHERE tenant_id = $1 ORDER BY received_at DESC
		 LIMIT $2 OFFSET $3`,
		tenantID, limit, offset,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var payments []Payment
	for rows.Next() {
		var p Payment
		if err := rows.Scan(
			&p.PaymentID, &p.TenantID, &p.PaymentReference, &p.LearnerID,
			&p.Source, &p.ChannelID, &p.Amount, &p.Currency, &p.Status,
			&p.MPESATransID, &p.ReceivedAt, &p.RecordedBy, &p.IdempotencyKey,
			&p.CreatedAt, &p.UpdatedAt,
		); err != nil {
			return nil, err
		}
		payments = append(payments, p)
	}
	return payments, nil
}

// ParentInvoices lists the invoices belonging to the learners linked to one
// guardian user. The staff list is tenant-wide; this one is filtered by the
// learner_guardians links, so a parent can never read another family's bill.
func (s *Service) ParentInvoices(ctx context.Context, tenantID, userID string, limit, offset int) ([]Invoice, error) {
	q := middleware.TxFromContext(ctx)
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	rows, err := q.Query(
		`SELECT i.invoice_id, i.tenant_id, i.invoice_number, i.learner_id, i.academic_year_id,
			COALESCE(i.term_id::text, ''), i.status, i.currency, i.total_amount, i.amount_paid, i.amount_outstanding,
			COALESCE(i.issue_date::text, ''), COALESCE(i.due_date::text, ''), COALESCE(i.paid_at::text, ''),
			COALESCE(i.created_by::text, ''), i.created_at, i.updated_at
		 FROM invoices i
		 JOIN learner_guardians lg ON lg.learner_id = i.learner_id
		 JOIN guardians gd ON gd.guardian_id = lg.guardian_id
		 WHERE i.tenant_id = $1 AND gd.user_id = $2 AND gd.tenant_id = $1
		 ORDER BY i.created_at DESC
		 LIMIT $3 OFFSET $4`,
		tenantID, userID, limit, offset,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	invoices := make([]Invoice, 0)
	for rows.Next() {
		var inv Invoice
		if err := rows.Scan(
			&inv.InvoiceID, &inv.TenantID, &inv.InvoiceNumber, &inv.LearnerID,
			&inv.AcademicYearID, &inv.TermID, &inv.Status, &inv.Currency,
			&inv.TotalAmount, &inv.AmountPaid, &inv.AmountOutstanding,
			&inv.IssueDate, &inv.DueDate, &inv.PaidAt, &inv.CreatedBy,
			&inv.CreatedAt, &inv.UpdatedAt,
		); err != nil {
			return nil, err
		}
		invoices = append(invoices, inv)
	}
	return invoices, rows.Err()
}

// ParentPayments lists completed receipts for the learners linked to one
// guardian user.
func (s *Service) ParentPayments(ctx context.Context, tenantID, userID string, limit, offset int) ([]Payment, error) {
	q := middleware.TxFromContext(ctx)
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	rows, err := q.Query(
		`SELECT p.payment_id, p.tenant_id, p.payment_reference, p.learner_id, p.source,
			COALESCE(p.channel_id::text, ''), p.amount, p.currency, p.status, COALESCE(p.mpesa_trans_id, ''),
			p.received_at, COALESCE(p.recorded_by::text, ''), COALESCE(p.idempotency_key, ''), p.created_at, p.updated_at
		 FROM payments p
		 JOIN learner_guardians lg ON lg.learner_id = p.learner_id
		 JOIN guardians gd ON gd.guardian_id = lg.guardian_id
		 WHERE p.tenant_id = $1 AND gd.user_id = $2 AND gd.tenant_id = $1
		 ORDER BY p.received_at DESC
		 LIMIT $3 OFFSET $4`,
		tenantID, userID, limit, offset,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	payments := make([]Payment, 0)
	for rows.Next() {
		var p Payment
		if err := rows.Scan(
			&p.PaymentID, &p.TenantID, &p.PaymentReference, &p.LearnerID,
			&p.Source, &p.ChannelID, &p.Amount, &p.Currency, &p.Status,
			&p.MPESATransID, &p.ReceivedAt, &p.RecordedBy, &p.IdempotencyKey,
			&p.CreatedAt, &p.UpdatedAt,
		); err != nil {
			return nil, err
		}
		payments = append(payments, p)
	}
	return payments, rows.Err()
}

// ============ Payment Allocations (tenant-scoped) ============

type PaymentAllocation struct {
	AllocationID    string  `json:"allocation_id"`
	TenantID        string  `json:"tenant_id"`
	PaymentID       string  `json:"payment_id"`
	InvoiceID       string  `json:"invoice_id"`
	AllocatedAmount float64 `json:"allocated_amount"`
	AllocatedAt     string  `json:"allocated_at"`
	AllocatedBy     string  `json:"allocated_by,omitempty"`
	CreatedAt       string  `json:"created_at"`
}

func (s *Service) AllocatePayment(ctx context.Context, tenantID string, alloc PaymentAllocation) (*PaymentAllocation, error) {
	tx := middleware.TxFromContext(ctx)
	if tx == nil {
		return nil, errors.New("no tenant transaction")
	}
	if alloc.AllocatedAmount <= 0 {
		return nil, errors.New("allocated amount must be positive")
	}

	// 1. Lock the invoice row to prevent concurrent allocation races.
	// Scan monetary columns as strings to preserve exact NUMERIC(12,2) value
	// without IEEE 754 float drift, then parse into money.Decimal.
	var (
		currentState string
		totalStr     string
		paidStr      string
		outStr       string
	)
	err := tx.QueryRowContext(ctx, `
		SELECT status, total_amount::text, amount_paid::text, amount_outstanding::text
		  FROM invoices
		 WHERE invoice_id = $1 AND tenant_id = $2
		 FOR UPDATE`,
		alloc.InvoiceID, tenantID).Scan(&currentState, &totalStr, &paidStr, &outStr)
	if err == sql.ErrNoRows {
		return nil, sql.ErrNoRows
	}
	if err != nil {
		return nil, err
	}

	totalAmount := money.New(totalStr)
	paidAmount := money.New(paidStr)
	outstanding := money.New(outStr)

	// Snap the client-supplied allocation to 2dp cents to recover the intended
	// currency value from the float64 JSON transport without drift.
	allocAmount := money.New(fmt.Sprintf("%.2f", alloc.AllocatedAmount))

	// 2. Evaluate the pure FSM transition (APPLY_CREDIT) using exact decimal.
	newPaid := paidAmount.Add(allocAmount)
	nextState, err := TransitionInvoice(InvoiceState(currentState), EventApplyCredit, InvoiceContext{
		TotalAmount:       totalAmount,
		PaidAmount:        newPaid,
		AmountOutstanding: outstanding.Sub(allocAmount),
	})
	if err != nil {
		return nil, fmt.Errorf("allocation rejected: %w", err)
	}

	newOutstanding := outstanding.Sub(allocAmount)

	// 3. Persist the validated transition atomically. Write decimals back as
	// fixed-2dp strings so Postgres casts them to NUMERIC(12,2) exactly.
	_, err = tx.ExecContext(ctx, `
		UPDATE invoices
		   SET amount_paid = $1::numeric,
		       amount_outstanding = $2::numeric,
		       status = $3,
		       paid_at = CASE WHEN $1::numeric >= $4::numeric THEN COALESCE(paid_at, CURRENT_TIMESTAMP) ELSE paid_at END,
		       updated_at = CURRENT_TIMESTAMP
		 WHERE invoice_id = $5 AND tenant_id = $6`,
		newPaid.StringFixed(2), newOutstanding.StringFixed(2), nextState, totalAmount.StringFixed(2), alloc.InvoiceID, tenantID)
	if err != nil {
		return nil, err
	}

	logInvoiceTransition(tx, tenantID, alloc.InvoiceID, string(currentState), string(nextState),
		string(EventApplyCredit), alloc.AllocatedBy, "payment allocation")

	err = tx.QueryRow(
		`INSERT INTO payment_allocations (tenant_id, payment_id, invoice_id, allocated_amount, allocated_by)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING allocation_id, allocated_at`,
		tenantID, alloc.PaymentID, alloc.InvoiceID, allocAmount.StringFixed(2), alloc.AllocatedBy,
	).Scan(&alloc.AllocationID, &alloc.AllocatedAt)
	if err != nil {
		return nil, err
	}

	alloc.TenantID = tenantID
	return &alloc, nil
}

// CancelInvoice cancels an invoice via the FSM. Guard: no active payments.
func (s *Service) CancelInvoice(ctx context.Context, tenantID, invoiceID, cancelledBy string) (*Invoice, error) {
	tx := middleware.TxFromContext(ctx)
	if tx == nil {
		return nil, errors.New("no tenant transaction")
	}

	var inv Invoice
	var totalStr, paidStr string
	err := tx.QueryRowContext(ctx, `
		SELECT invoice_id, tenant_id, status, total_amount::text, amount_paid::text
		  FROM invoices
		 WHERE invoice_id = $1 AND tenant_id = $2
		 FOR UPDATE`,
		invoiceID, tenantID).Scan(&inv.InvoiceID, &inv.TenantID, &inv.Status, &totalStr, &paidStr)
	if err == sql.ErrNoRows {
		return nil, sql.ErrNoRows
	}
	if err != nil {
		return nil, err
	}

	totalAmount := money.New(totalStr)
	paidAmount := money.New(paidStr)

	currentState := InvoiceState(inv.Status)
	nextState, err := TransitionInvoice(currentState, EventCancel, InvoiceContext{
		TotalAmount: totalAmount,
		PaidAmount:  paidAmount,
	})
	if err != nil {
		return nil, fmt.Errorf("cancel rejected: %w", err)
	}

	_, err = tx.ExecContext(ctx, `
		UPDATE invoices
		   SET status = $1,
		       voided_at = CURRENT_TIMESTAMP,
		       void_reason = $2,
		       updated_at = CURRENT_TIMESTAMP
		 WHERE invoice_id = $3 AND tenant_id = $4`,
		nextState, "cancelled:"+cancelledBy, invoiceID, tenantID)
	if err != nil {
		return nil, err
	}

	logInvoiceTransition(tx, tenantID, invoiceID, string(currentState), string(nextState),
		string(EventCancel), cancelledBy, "invoice cancelled")

	inv.Status = string(nextState)
	inv.TotalAmount = totalAmount
	inv.AmountPaid = paidAmount
	return &inv, nil
}

// WaiveInvoice waives an invoice via the FSM. Guard: no active payments.
func (s *Service) WaiveInvoice(ctx context.Context, tenantID, invoiceID, waivedBy string) (*Invoice, error) {
	tx := middleware.TxFromContext(ctx)
	if tx == nil {
		return nil, errors.New("no tenant transaction")
	}

	var inv Invoice
	var totalStr, paidStr string
	err := tx.QueryRowContext(ctx, `
		SELECT invoice_id, tenant_id, status, total_amount::text, amount_paid::text
		  FROM invoices
		 WHERE invoice_id = $1 AND tenant_id = $2
		 FOR UPDATE`,
		invoiceID, tenantID).Scan(&inv.InvoiceID, &inv.TenantID, &inv.Status, &totalStr, &paidStr)
	if err == sql.ErrNoRows {
		return nil, sql.ErrNoRows
	}
	if err != nil {
		return nil, err
	}

	totalAmount := money.New(totalStr)
	paidAmount := money.New(paidStr)

	currentState := InvoiceState(inv.Status)
	nextState, err := TransitionInvoice(currentState, EventWaive, InvoiceContext{
		TotalAmount: totalAmount,
		PaidAmount:  paidAmount,
	})
	if err != nil {
		return nil, fmt.Errorf("waive rejected: %w", err)
	}

	_, err = tx.ExecContext(ctx, `
		UPDATE invoices
		   SET status = $1,
		       voided_at = CURRENT_TIMESTAMP,
		       void_reason = $2,
		       updated_at = CURRENT_TIMESTAMP
		 WHERE invoice_id = $3 AND tenant_id = $4`,
		nextState, "waived:"+waivedBy, invoiceID, tenantID)
	if err != nil {
		return nil, err
	}

	logInvoiceTransition(tx, tenantID, invoiceID, string(currentState), string(nextState),
		string(EventWaive), waivedBy, "invoice waived")

	inv.Status = string(nextState)
	inv.TotalAmount = totalAmount
	inv.AmountPaid = paidAmount
	return &inv, nil
}

// SuspendInvoice suspends an invoice via the FSM.
func (s *Service) SuspendInvoice(ctx context.Context, tenantID, invoiceID, suspendedBy string) (*Invoice, error) {
	tx := middleware.TxFromContext(ctx)
	if tx == nil {
		return nil, errors.New("no tenant transaction")
	}

	var inv Invoice
	var totalStr, paidStr string
	err := tx.QueryRowContext(ctx, `
		SELECT invoice_id, tenant_id, status, total_amount::text, amount_paid::text
		  FROM invoices
		 WHERE invoice_id = $1 AND tenant_id = $2
		 FOR UPDATE`,
		invoiceID, tenantID).Scan(&inv.InvoiceID, &inv.TenantID, &inv.Status, &totalStr, &paidStr)
	if err == sql.ErrNoRows {
		return nil, sql.ErrNoRows
	}
	if err != nil {
		return nil, err
	}

	totalAmount := money.New(totalStr)
	paidAmount := money.New(paidStr)

	currentState := InvoiceState(inv.Status)
	nextState, err := TransitionInvoice(currentState, EventSuspend, InvoiceContext{
		TotalAmount: totalAmount,
		PaidAmount:  paidAmount,
	})
	if err != nil {
		return nil, fmt.Errorf("suspend rejected: %w", err)
	}

	_, err = tx.ExecContext(ctx, `
		UPDATE invoices
		   SET status = $1,
		       void_reason = $2,
		       updated_at = CURRENT_TIMESTAMP
		 WHERE invoice_id = $3 AND tenant_id = $4`,
		nextState, "suspended:"+suspendedBy, invoiceID, tenantID)
	if err != nil {
		return nil, err
	}

	logInvoiceTransition(tx, tenantID, invoiceID, string(currentState), string(nextState),
		string(EventSuspend), suspendedBy, "invoice suspended")

	inv.Status = string(nextState)
	inv.TotalAmount = totalAmount
	inv.AmountPaid = paidAmount
	return &inv, nil
}

// logTransition writes an immutable audit record for an invoice FSM state
// transition inside the caller's open transaction. It never fails the
// transition itself on a logging error (best-effort audit), but the write is
// part of the same transaction so it commits or rolls back atomically.
func logInvoiceTransition(tx *sqlx.Tx, tenantID, invoiceID, fromState, toState, event, actorID, reason string) {
	ctx := context.Background()
	// Best-effort inside a shared transaction needs a savepoint: without one, a
	// failed insert aborts the caller's transaction and the invoice change it was
	// logging fails with an error that points at the wrong statement.
	if _, err := tx.ExecContext(ctx, `SAVEPOINT invoice_transition_log`); err != nil {
		log.Printf("finance: could not open savepoint for invoice transition log: %v", err)
		return
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO state_transition_logs
			(tenant_id, entity_name, entity_id, from_state, to_state, event, actor_id, reason)
		VALUES ($1, 'invoice', $2, $3, $4, $5, $6, $7)`,
		tenantID, invoiceID, fromState, toState, event, actorID, reason,
	); err != nil {
		log.Printf("finance: could not log invoice transition %s->%s: %v", fromState, toState, err)
		if _, rbErr := tx.ExecContext(ctx, `ROLLBACK TO SAVEPOINT invoice_transition_log`); rbErr != nil {
			log.Printf("finance: could not roll back transition-log savepoint: %v", rbErr)
		}
		return
	}
	if _, err := tx.ExecContext(ctx, `RELEASE SAVEPOINT invoice_transition_log`); err != nil {
		log.Printf("finance: could not release transition-log savepoint: %v", err)
	}
}

// ============ Credits (tenant-scoped) ============

type Credit struct {
	CreditID        string  `json:"credit_id"`
	TenantID        string  `json:"tenant_id"`
	LearnerID       string  `json:"learner_id"`
	Amount          float64 `json:"amount"`
	Currency        string  `json:"currency"`
	Reason          string  `json:"reason"`
	SourcePaymentID string  `json:"source_payment_id,omitempty"`
	ExpiresAt       string  `json:"expires_at,omitempty"`
	CreatedBy       string  `json:"created_by,omitempty"`
	CreatedAt       string  `json:"created_at"`
	UpdatedAt       string  `json:"updated_at"`
}

// ListCredits returns the tenant's credit notes, newest first.
func (s *Service) ListCredits(ctx context.Context, tenantID string, limit, offset int) ([]Credit, error) {
	q := middleware.TxFromContext(ctx)
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	rows, err := q.Query(
		`SELECT credit_id, tenant_id, learner_id, amount, currency, reason,
			source_payment_id, expires_at, created_by, created_at, updated_at
		 FROM credits WHERE tenant_id = $1 ORDER BY created_at DESC
		 LIMIT $2 OFFSET $3`,
		tenantID, limit, offset,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var credits []Credit
	for rows.Next() {
		var c Credit
		var sourcePayment, expiresAt, createdBy sql.NullString
		if err := rows.Scan(
			&c.CreditID, &c.TenantID, &c.LearnerID, &c.Amount, &c.Currency,
			&c.Reason, &sourcePayment, &expiresAt, &createdBy, &c.CreatedAt, &c.UpdatedAt,
		); err != nil {
			return nil, err
		}
		c.SourcePaymentID = sourcePayment.String
		c.ExpiresAt = expiresAt.String
		c.CreatedBy = createdBy.String
		credits = append(credits, c)
	}
	return credits, nil
}

func (s *Service) CreateCredit(ctx context.Context, tenantID string, c Credit) (*Credit, error) {
	q := middleware.TxFromContext(ctx)
	err := q.QueryRow(
		`INSERT INTO credits (tenant_id, learner_id, amount, currency, reason,
			source_payment_id, expires_at, created_by)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		 RETURNING credit_id, created_at`,
		tenantID, c.LearnerID, c.Amount, c.Currency, c.Reason,
		c.SourcePaymentID, c.ExpiresAt, c.CreatedBy,
	).Scan(&c.CreditID, &c.CreatedAt)
	if err != nil {
		return nil, err
	}
	c.TenantID = tenantID
	return &c, nil
}

// ============ Adjustments (tenant-scoped) ============

type Adjustment struct {
	AdjustmentID   string  `json:"adjustment_id"`
	TenantID       string  `json:"tenant_id"`
	InvoiceID      string  `json:"invoice_id"`
	AdjustmentType string  `json:"adjustment_type"` // DISCOUNT, SURCHARGE, WAIVER, CORRECTION
	Amount         float64 `json:"amount"`
	Reason         string  `json:"reason"`
	CreatedBy      string  `json:"created_by,omitempty"`
	CreatedAt      string  `json:"created_at"`
	UpdatedAt      string  `json:"updated_at"`
}

// ListAdjustments returns the tenant's invoice adjustments, newest first.
func (s *Service) ListAdjustments(ctx context.Context, tenantID string, limit, offset int) ([]Adjustment, error) {
	q := middleware.TxFromContext(ctx)
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	rows, err := q.Query(
		`SELECT adjustment_id, tenant_id, invoice_id, adjustment_type, amount,
			reason, created_by, created_at, updated_at
		 FROM adjustments WHERE tenant_id = $1 ORDER BY created_at DESC
		 LIMIT $2 OFFSET $3`,
		tenantID, limit, offset,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var adjustments []Adjustment
	for rows.Next() {
		var a Adjustment
		var createdBy sql.NullString
		if err := rows.Scan(
			&a.AdjustmentID, &a.TenantID, &a.InvoiceID, &a.AdjustmentType,
			&a.Amount, &a.Reason, &createdBy, &a.CreatedAt, &a.UpdatedAt,
		); err != nil {
			return nil, err
		}
		a.CreatedBy = createdBy.String
		adjustments = append(adjustments, a)
	}
	return adjustments, nil
}

func (s *Service) CreateAdjustment(ctx context.Context, tenantID string, a Adjustment) (*Adjustment, error) {
	q := middleware.TxFromContext(ctx)
	err := q.QueryRow(
		`INSERT INTO adjustments (tenant_id, invoice_id, adjustment_type, amount, reason, created_by)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING adjustment_id, created_at`,
		tenantID, a.InvoiceID, a.AdjustmentType, a.Amount, a.Reason, a.CreatedBy,
	).Scan(&a.AdjustmentID, &a.CreatedAt)
	if err != nil {
		return nil, err
	}
	a.TenantID = tenantID
	return &a, nil
}

// ============ Refunds (tenant-scoped) ============

type Refund struct {
	RefundID          string  `json:"refund_id"`
	TenantID          string  `json:"tenant_id"`
	PaymentID         string  `json:"payment_id"`
	Amount            float64 `json:"amount"`
	Currency          string  `json:"currency"`
	Reason            string  `json:"reason"`
	Status            string  `json:"status"`
	MPESAB2CRequestID string  `json:"mpesa_b2c_request_id,omitempty"`
	ProcessedAt       string  `json:"processed_at,omitempty"`
	ProcessedBy       string  `json:"processed_by,omitempty"`
	CreatedBy         string  `json:"created_by,omitempty"`
	CreatedAt         string  `json:"created_at"`
	UpdatedAt         string  `json:"updated_at"`
}

// ListRefunds returns the tenant's refunds, newest first.
func (s *Service) ListRefunds(ctx context.Context, tenantID string, limit, offset int) ([]Refund, error) {
	q := middleware.TxFromContext(ctx)
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	rows, err := q.Query(
		`SELECT refund_id, tenant_id, payment_id, amount, currency, reason, status,
			mpesa_b2c_request_id, processed_at, processed_by, created_by, created_at, updated_at
		 FROM refunds WHERE tenant_id = $1 ORDER BY created_at DESC
		 LIMIT $2 OFFSET $3`,
		tenantID, limit, offset,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var refunds []Refund
	for rows.Next() {
		var r Refund
		var b2c, processedAt, processedBy, createdBy sql.NullString
		if err := rows.Scan(
			&r.RefundID, &r.TenantID, &r.PaymentID, &r.Amount, &r.Currency,
			&r.Reason, &r.Status, &b2c, &processedAt, &processedBy, &createdBy,
			&r.CreatedAt, &r.UpdatedAt,
		); err != nil {
			return nil, err
		}
		r.MPESAB2CRequestID = b2c.String
		r.ProcessedAt = processedAt.String
		r.ProcessedBy = processedBy.String
		r.CreatedBy = createdBy.String
		refunds = append(refunds, r)
	}
	return refunds, nil
}

func (s *Service) CreateRefund(ctx context.Context, tenantID string, r Refund) (*Refund, error) {
	q := middleware.TxFromContext(ctx)
	err := q.QueryRow(
		`INSERT INTO refunds (tenant_id, payment_id, amount, currency, reason, status, created_by)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 RETURNING refund_id, created_at`,
		tenantID, r.PaymentID, r.Amount, r.Currency, r.Reason, r.Status, r.CreatedBy,
	).Scan(&r.RefundID, &r.CreatedAt)
	if err != nil {
		return nil, err
	}
	r.TenantID = tenantID
	return &r, nil
}

// ============ M-Pesa Transactions (tenant-scoped) ============

type MPESATransaction struct {
	TransID         string  `json:"trans_id"`
	TenantID        string  `json:"tenant_id"`
	ChannelID       string  `json:"channel_id"`
	ExternalTransID string  `json:"external_trans_id"`
	Shortcode       string  `json:"shortcode"`
	ChannelType     string  `json:"channel_type"`
	BillRef         string  `json:"bill_ref,omitempty"`
	MSISDNMasked    string  `json:"msisdn_masked,omitempty"`
	Amount          float64 `json:"amount"`
	Currency        string  `json:"currency"`
	Status          string  `json:"status"`
	TransactionDate string  `json:"transaction_date,omitempty"`
	TenantResolved  bool    `json:"tenant_resolved"`
	CreatedAt       string  `json:"created_at"`
	UpdatedAt       string  `json:"updated_at"`
}

func (s *Service) ListMPESATransactions(ctx context.Context, tenantID string, limit, offset int) ([]MPESATransaction, error) {
	q := middleware.TxFromContext(ctx)
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	rows, err := q.Query(
		`SELECT trans_id, tenant_id, channel_id, external_trans_id, shortcode,
			channel_type, bill_ref, msisdn_masked, amount, currency, status,
			transaction_date, tenant_resolved, created_at, updated_at
		 FROM mpesa_transactions WHERE tenant_id = $1 ORDER BY created_at DESC
		 LIMIT $2 OFFSET $3`,
		tenantID, limit, offset,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var txns []MPESATransaction
	for rows.Next() {
		var t MPESATransaction
		if err := rows.Scan(
			&t.TransID, &t.TenantID, &t.ChannelID, &t.ExternalTransID, &t.Shortcode,
			&t.ChannelType, &t.BillRef, &t.MSISDNMasked, &t.Amount, &t.Currency,
			&t.Status, &t.TransactionDate, &t.TenantResolved, &t.CreatedAt, &t.UpdatedAt,
		); err != nil {
			return nil, err
		}
		txns = append(txns, t)
	}
	return txns, nil
}

func (s *Service) CreateMPESATransaction(ctx context.Context, tenantID string, t MPESATransaction) (*MPESATransaction, error) {
	q := middleware.TxFromContext(ctx)
	err := q.QueryRow(
		`INSERT INTO mpesa_transactions (tenant_id, channel_id, external_trans_id, shortcode,
			channel_type, bill_ref, msisdn_masked, amount, currency, status,
			transaction_date, tenant_resolved, raw_payload)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
		 RETURNING trans_id, created_at`,
		tenantID, t.ChannelID, t.ExternalTransID, t.Shortcode, t.ChannelType,
		t.BillRef, t.MSISDNMasked, t.Amount, t.Currency, t.Status,
		t.TransactionDate, t.TenantResolved, "{}",
	).Scan(&t.TransID, &t.CreatedAt)
	if err != nil {
		return nil, err
	}
	t.TenantID = tenantID
	return &t, nil
}

// ============ M-Pesa STK Requests (tenant-scoped) ============

type MPESASTKRequest struct {
	STKID              string  `json:"stk_id"`
	TenantID           string  `json:"tenant_id"`
	ChannelID          string  `json:"channel_id"`
	CheckoutRequestID  string  `json:"checkout_request_id"`
	MerchantRequestID  string  `json:"merchant_request_id"`
	PhoneNumber        string  `json:"phone_number"`
	Amount             float64 `json:"amount"`
	Currency           string  `json:"currency"`
	AccountReference   string  `json:"account_reference,omitempty"`
	TransactionDesc    string  `json:"transaction_desc,omitempty"`
	Status             string  `json:"status"`
	CallbackReceivedAt string  `json:"callback_received_at,omitempty"`
	MPESATransID       string  `json:"mpesa_trans_id,omitempty"`
	ExpiresAt          string  `json:"expires_at,omitempty"`
	CreatedAt          string  `json:"created_at"`
	UpdatedAt          string  `json:"updated_at"`
}

func (s *Service) CreateMPESASTKRequest(ctx context.Context, tenantID string, r MPESASTKRequest) (*MPESASTKRequest, error) {
	q := middleware.TxFromContext(ctx)
	err := q.QueryRow(
		`INSERT INTO mpesa_stk_requests (tenant_id, channel_id, checkout_request_id,
			merchant_request_id, phone_number, amount, currency, account_reference,
			transaction_desc, status, expires_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		 RETURNING stk_id, created_at`,
		tenantID, r.ChannelID, r.CheckoutRequestID, r.MerchantRequestID,
		r.PhoneNumber, r.Amount, r.Currency, r.AccountReference, r.TransactionDesc,
		r.Status, r.ExpiresAt,
	).Scan(&r.STKID, &r.CreatedAt)
	if err != nil {
		return nil, err
	}
	r.TenantID = tenantID
	return &r, nil
}

// ============ Receipt Sequences (tenant-scoped) ============

type ReceiptSequence struct {
	SequenceID     string `json:"sequence_id"`
	TenantID       string `json:"tenant_id"`
	Prefix         string `json:"prefix"`
	LastNumber     int    `json:"last_number"`
	ResetFrequency string `json:"reset_frequency"`
	CurrentPeriod  string `json:"current_period"`
	CreatedAt      string `json:"created_at"`
	UpdatedAt      string `json:"updated_at"`
}

func (s *Service) GetReceiptSequence(ctx context.Context, tenantID, period string) (*ReceiptSequence, error) {
	q := middleware.TxFromContext(ctx)
	var seq ReceiptSequence
	err := q.QueryRow(
		`SELECT sequence_id, tenant_id, prefix, last_number, reset_frequency,
			current_period, created_at::text, updated_at::text
		 FROM receipt_sequences WHERE tenant_id = $1 AND current_period = $2`,
		tenantID, period,
	).Scan(
		&seq.SequenceID, &seq.TenantID, &seq.Prefix, &seq.LastNumber,
		&seq.ResetFrequency, &seq.CurrentPeriod, &seq.CreatedAt, &seq.UpdatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			// Create the period's default sequence, unless a concurrent request
			// created it between the read and this write. The unique constraint
			// on (tenant_id, current_period) settles that race, and the follow-up
			// read returns whichever row won.
			if _, insErr := q.Exec(
				`INSERT INTO receipt_sequences (tenant_id, prefix, last_number,
					reset_frequency, current_period)
				 VALUES ($1, $2, 0, $3, $4)
				 ON CONFLICT (tenant_id, current_period) DO NOTHING`,
				tenantID, "RCP", "YEARLY", period,
			); insErr != nil {
				return nil, insErr
			}
			err = q.QueryRow(
				`SELECT sequence_id, tenant_id, prefix, last_number, reset_frequency,
					current_period, created_at::text, updated_at::text
				 FROM receipt_sequences WHERE tenant_id = $1 AND current_period = $2`,
				tenantID, period,
			).Scan(
				&seq.SequenceID, &seq.TenantID, &seq.Prefix, &seq.LastNumber,
				&seq.ResetFrequency, &seq.CurrentPeriod, &seq.CreatedAt, &seq.UpdatedAt,
			)
			if err != nil {
				return nil, err
			}
			return &seq, nil
		}
		return nil, err
	}
	return &seq, nil
}

func (s *Service) IncrementReceiptSequence(ctx context.Context, tenantID, sequenceID string) error {
	q := middleware.TxFromContext(ctx)
	_, err := q.Exec(
		`UPDATE receipt_sequences SET last_number = last_number + 1, updated_at = CURRENT_TIMESTAMP
		 WHERE sequence_id = $1 AND tenant_id = $2`,
		sequenceID, tenantID,
	)
	return err
}

// ListReceiptSequences returns every receipt number sequence the school keeps.
func (s *Service) ListReceiptSequences(ctx context.Context, tenantID string) ([]ReceiptSequence, error) {
	q := middleware.TxFromContext(ctx)
	rows, err := q.Query(
		`SELECT sequence_id, tenant_id, prefix, last_number, reset_frequency,
			current_period, created_at::text, updated_at::text
		 FROM receipt_sequences WHERE tenant_id = $1
		 ORDER BY current_period DESC, prefix`,
		tenantID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	sequences := make([]ReceiptSequence, 0)
	for rows.Next() {
		var seq ReceiptSequence
		if err := rows.Scan(
			&seq.SequenceID, &seq.TenantID, &seq.Prefix, &seq.LastNumber,
			&seq.ResetFrequency, &seq.CurrentPeriod, &seq.CreatedAt, &seq.UpdatedAt,
		); err != nil {
			return nil, err
		}
		sequences = append(sequences, seq)
	}
	return sequences, rows.Err()
}

// ReceiptSequenceInput is the editable shape of a sequence.
type ReceiptSequenceInput struct {
	Prefix         string `json:"prefix"`
	LastNumber     int    `json:"last_number"`
	ResetFrequency string `json:"reset_frequency"`
	CurrentPeriod  string `json:"current_period"`
}

func (s *Service) CreateReceiptSequence(ctx context.Context, tenantID string, in ReceiptSequenceInput) (*ReceiptSequence, error) {
	q := middleware.TxFromContext(ctx)
	var seq ReceiptSequence
	err := q.QueryRow(
		`INSERT INTO receipt_sequences (tenant_id, prefix, last_number, reset_frequency, current_period)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING sequence_id, tenant_id, prefix, last_number, reset_frequency,
			current_period, created_at::text, updated_at::text`,
		tenantID, in.Prefix, in.LastNumber, in.ResetFrequency, in.CurrentPeriod,
	).Scan(
		&seq.SequenceID, &seq.TenantID, &seq.Prefix, &seq.LastNumber,
		&seq.ResetFrequency, &seq.CurrentPeriod, &seq.CreatedAt, &seq.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &seq, nil
}

func (s *Service) UpdateReceiptSequence(ctx context.Context, tenantID, sequenceID string, in ReceiptSequenceInput) (*ReceiptSequence, error) {
	q := middleware.TxFromContext(ctx)
	var seq ReceiptSequence
	err := q.QueryRow(
		`UPDATE receipt_sequences
		 SET prefix = $1, last_number = $2, reset_frequency = $3, current_period = $4, updated_at = CURRENT_TIMESTAMP
		 WHERE sequence_id = $5 AND tenant_id = $6
		 RETURNING sequence_id, tenant_id, prefix, last_number, reset_frequency,
			current_period, created_at::text, updated_at::text`,
		in.Prefix, in.LastNumber, in.ResetFrequency, in.CurrentPeriod, sequenceID, tenantID,
	).Scan(
		&seq.SequenceID, &seq.TenantID, &seq.Prefix, &seq.LastNumber,
		&seq.ResetFrequency, &seq.CurrentPeriod, &seq.CreatedAt, &seq.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &seq, nil
}

func (h *Handler) ListReceiptSequences(c *gin.Context) {
	sequences, err := h.service.ListReceiptSequences(c.Request.Context(), c.GetString("tenant_id"))
	if err != nil {
		validation.DBError(c, err)
		return
	}
	c.JSON(http.StatusOK, validation.List(sequences))
}

func normalizeReceiptSequence(in *ReceiptSequenceInput) bool {
	in.Prefix = strings.ToUpper(strings.TrimSpace(in.Prefix))
	in.CurrentPeriod = strings.TrimSpace(in.CurrentPeriod)
	in.ResetFrequency = strings.ToUpper(strings.TrimSpace(in.ResetFrequency))
	if in.ResetFrequency == "" {
		in.ResetFrequency = "YEARLY"
	}
	switch in.ResetFrequency {
	case "YEARLY", "TERMLY", "MONTHLY", "NEVER":
	default:
		return false
	}
	return in.Prefix != "" && in.CurrentPeriod != "" && in.LastNumber >= 0
}

func (h *Handler) CreateReceiptSequence(c *gin.Context) {
	var in ReceiptSequenceInput
	if errs := validation.BindJSON(c, &in); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	if !normalizeReceiptSequence(&in) {
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "current_period", Code: "INVALID_VALUE", Message: "prefix and current_period are required; last_number must not be negative"},
		})
		return
	}
	created, err := h.service.CreateReceiptSequence(c.Request.Context(), c.GetString("tenant_id"), in)
	if err != nil {
		var pqErr *pq.Error
		if errors.As(err, &pqErr) && pqErr.Code == "23505" {
			validation.Conflict(c, "A sequence already exists for that period")
			return
		}
		validation.DBError(c, err)
		return
	}
	c.JSON(http.StatusCreated, created)
}

func (h *Handler) UpdateReceiptSequence(c *gin.Context) {
	var in ReceiptSequenceInput
	if errs := validation.BindJSON(c, &in); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	if !normalizeReceiptSequence(&in) {
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "current_period", Code: "INVALID_VALUE", Message: "prefix and current_period are required; last_number must not be negative"},
		})
		return
	}
	updated, err := h.service.UpdateReceiptSequence(
		c.Request.Context(), c.GetString("tenant_id"), c.Param("id"), in)
	if errors.Is(err, sql.ErrNoRows) {
		validation.NotFound(c, "Receipt sequence not found")
		return
	}
	if err != nil {
		var pqErr *pq.Error
		if errors.As(err, &pqErr) && pqErr.Code == "23505" {
			validation.Conflict(c, "A sequence already exists for that period")
			return
		}
		validation.DBError(c, err)
		return
	}
	c.JSON(http.StatusOK, updated)
}

// ============ M-Pesa STK requests, read side ============

// ListMPESASTKRequests returns the school's recent STK pushes, newest first.
func (s *Service) ListMPESASTKRequests(ctx context.Context, tenantID string, limit int) ([]MPESASTKRequest, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	q := middleware.TxFromContext(ctx)
	rows, err := q.Query(
		`SELECT stk_id, tenant_id, channel_id, checkout_request_id, merchant_request_id,
			phone_number, amount, currency, COALESCE(account_reference, ''),
			COALESCE(transaction_desc, ''), status, COALESCE(mpesa_trans_id, ''),
			COALESCE(expires_at::text, ''), created_at::text, updated_at::text
		 FROM mpesa_stk_requests WHERE tenant_id = $1
		 ORDER BY created_at DESC LIMIT $2`,
		tenantID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	requests := make([]MPESASTKRequest, 0)
	for rows.Next() {
		var r MPESASTKRequest
		if err := rows.Scan(
			&r.STKID, &r.TenantID, &r.ChannelID, &r.CheckoutRequestID, &r.MerchantRequestID,
			&r.PhoneNumber, &r.Amount, &r.Currency, &r.AccountReference,
			&r.TransactionDesc, &r.Status, &r.MPESATransID, &r.ExpiresAt, &r.CreatedAt, &r.UpdatedAt,
		); err != nil {
			return nil, err
		}
		requests = append(requests, r)
	}
	return requests, rows.Err()
}

func (h *Handler) ListMPESASTKRequests(c *gin.Context) {
	requests, err := h.service.ListMPESASTKRequests(c.Request.Context(), c.GetString("tenant_id"), 100)
	if err != nil {
		validation.DBError(c, err)
		return
	}
	c.JSON(http.StatusOK, validation.List(requests))
}

// PaymentChannel is one M-Pesa paybill/till the school collects through.
type PaymentChannel struct {
	ChannelID          string `json:"channel_id"`
	ChannelType        string `json:"channel_type"`
	Name               string `json:"name"`
	ShortcodeOrAccount string `json:"shortcode_or_account"`
	Environment        string `json:"environment"`
	IsDefault          bool   `json:"is_default"`
	Status             string `json:"status"`
}

func (s *Service) ListPaymentChannels(ctx context.Context, tenantID string) ([]PaymentChannel, error) {
	q := middleware.TxFromContext(ctx)
	rows, err := q.Query(
		`SELECT channel_id, channel_type, label, shortcode_or_account,
			COALESCE(environment, ''), is_default, status
		 FROM school_payment_channels WHERE tenant_id = $1 AND status <> 'DISABLED'
		 ORDER BY is_default DESC, created_at`,
		tenantID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	channels := make([]PaymentChannel, 0)
	for rows.Next() {
		var ch PaymentChannel
		if err := rows.Scan(
			&ch.ChannelID, &ch.ChannelType, &ch.Name, &ch.ShortcodeOrAccount,
			&ch.Environment, &ch.IsDefault, &ch.Status,
		); err != nil {
			return nil, err
		}
		channels = append(channels, ch)
	}
	return channels, rows.Err()
}

func (h *Handler) ListPaymentChannels(c *gin.Context) {
	channels, err := h.service.ListPaymentChannels(c.Request.Context(), c.GetString("tenant_id"))
	if err != nil {
		validation.DBError(c, err)
		return
	}
	c.JSON(http.StatusOK, validation.List(channels))
}

// ============ Capitation Receipts (tenant-scoped) ============

type CapitationReceipt struct {
	ReceiptID        string  `json:"receipt_id"`
	TenantID         string  `json:"tenant_id"`
	ReceiptNumber    string  `json:"receipt_number"`
	CapitationPeriod string  `json:"capitation_period"`
	LearnerCount     int           `json:"learner_count"`
	AmountPerLearner money.Decimal `json:"amount_per_learner"`
	TotalAmount      money.Decimal `json:"total_amount"`
	Currency         string  `json:"currency"`
	ReceivedAt       string  `json:"received_at,omitempty"`
	Reference        string  `json:"reference,omitempty"`
	Status           string  `json:"status"`
	CreatedBy        string  `json:"created_by,omitempty"`
	CreatedAt        string  `json:"created_at"`
	UpdatedAt        string  `json:"updated_at"`
}

func (s *Service) ListCapitationReceipts(ctx context.Context, tenantID string) ([]CapitationReceipt, error) {
	q := middleware.TxFromContext(ctx)
	rows, err := q.Query(
		`SELECT receipt_id, tenant_id, receipt_number, capitation_period, learner_count,
			amount_per_learner, total_amount, currency, received_at, reference,
			status, created_by, created_at, updated_at
		 FROM capitation_receipts WHERE tenant_id = $1 ORDER BY created_at DESC`,
		tenantID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	// Non-nil so an empty school serialises as [] rather than null.
	receipts := make([]CapitationReceipt, 0)
	for rows.Next() {
		var r CapitationReceipt
		if err := rows.Scan(
			&r.ReceiptID, &r.TenantID, &r.ReceiptNumber, &r.CapitationPeriod,
			&r.LearnerCount, &r.AmountPerLearner, &r.TotalAmount, &r.Currency,
			&r.ReceivedAt, &r.Reference, &r.Status, &r.CreatedBy, &r.CreatedAt, &r.UpdatedAt,
		); err != nil {
			return nil, err
		}
		receipts = append(receipts, r)
	}
	return receipts, nil
}

// ============ Reconciliation Runs (tenant-scoped) ============

type ReconciliationRun struct {
	RunID                 string  `json:"run_id"`
	TenantID              string  `json:"tenant_id"`
	RunDate               string  `json:"run_date"`
	PeriodStart           string  `json:"period_start"`
	PeriodEnd             string  `json:"period_end"`
	TotalExpected         float64 `json:"total_expected"`
	TotalReceived         float64 `json:"total_received"`
	TotalOutstanding      float64 `json:"total_outstanding"`
	UnmatchedTransactions int     `json:"unmatched_transactions"`
	Status                string  `json:"status"`
	ExceptionCount        int     `json:"exception_count"`
	CreatedBy             string  `json:"created_by,omitempty"`
	CompletedAt           string  `json:"completed_at,omitempty"`
	CreatedAt             string  `json:"created_at"`
	UpdatedAt             string  `json:"updated_at"`
}

func (s *Service) ListReconciliationRuns(ctx context.Context, tenantID string) ([]ReconciliationRun, error) {
	q := middleware.TxFromContext(ctx)
	rows, err := q.Query(
		`SELECT run_id, tenant_id, run_date, period_start, period_end, total_expected,
			total_received, total_outstanding, unmatched_transactions, status,
			exception_count, created_by, completed_at, created_at, updated_at
		 FROM reconciliation_runs WHERE tenant_id = $1 ORDER BY run_date DESC`,
		tenantID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var runs []ReconciliationRun
	for rows.Next() {
		var r ReconciliationRun
		if err := rows.Scan(
			&r.RunID, &r.TenantID, &r.RunDate, &r.PeriodStart, &r.PeriodEnd,
			&r.TotalExpected, &r.TotalReceived, &r.TotalOutstanding,
			&r.UnmatchedTransactions, &r.Status, &r.ExceptionCount, &r.CreatedBy,
			&r.CompletedAt, &r.CreatedAt, &r.UpdatedAt,
		); err != nil {
			return nil, err
		}
		runs = append(runs, r)
	}
	return runs, nil
}

// ============ Service & Handler ============

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

// Fee Structures handlers
func (h *Handler) ListFeeStructures(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	limit, offset := paginationParams(c)
	structures, err := h.service.ListFeeStructures(c.Request.Context(), tenantID, limit, offset)
	if err != nil {
		validation.DBError(c, err)
		return
	}
	c.JSON(http.StatusOK, validation.List(structures))
}

func (h *Handler) ListFeeCategories(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	includeInactive := c.Query("include_inactive") == "true"

	categories, err := h.service.ListFeeCategories(c.Request.Context(), tenantID, includeInactive)
	if err != nil {
		validation.DBError(c, err)
		return
	}
	c.JSON(http.StatusOK, validation.List(categories))
}

// GetFeeCategoryTemplates returns the standard Kenyan school fee category templates
// that schools can quickly add as custom categories.
func (h *Handler) GetFeeCategoryTemplates(c *gin.Context) {
	templates := []FeeCategoryRequest{
		{Code: "MEALS", Name: "Meals", Description: "School meals / feeding program", IsTuition: false, IsOptional: true, RequiresConsent: true},
		{Code: "TRANSPORT", Name: "Transport", Description: "School transport / bus fees", IsTuition: false, IsOptional: true, RequiresConsent: true},
		{Code: "UNIFORM", Name: "Uniform", Description: "School uniform", IsTuition: false, IsOptional: true, RequiresConsent: false},
		{Code: "EXAM", Name: "Examination", Description: "Internal examination fees", IsTuition: false, IsOptional: false, RequiresConsent: false},
		{Code: "ACTIVITY", Name: "Activity", Description: "Co-curricular activities", IsTuition: false, IsOptional: true, RequiresConsent: true},
		{Code: "BOARDING", Name: "Boarding", Description: "Boarding / accommodation fees", IsTuition: false, IsOptional: true, RequiresConsent: false},
		{Code: "OTHER", Name: "Other", Description: "Miscellaneous fees", IsTuition: false, IsOptional: true, RequiresConsent: true},
		{Code: "PTA", Name: "PTA Levy", Description: "Parent-Teacher Association levy", IsTuition: false, IsOptional: true, RequiresConsent: true},
		{Code: "DEVELOPMENT", Name: "Development Fund", Description: "School infrastructure development fund", IsTuition: false, IsOptional: true, RequiresConsent: true},
		{Code: "ICT", Name: "ICT Levy", Description: "Information & Communication Technology levy", IsTuition: false, IsOptional: true, RequiresConsent: true},
		{Code: "MEDICAL", Name: "Medical", Description: "Medical / health services", IsTuition: false, IsOptional: true, RequiresConsent: true},
		{Code: "INSURANCE", Name: "Insurance", Description: "Student insurance", IsTuition: false, IsOptional: true, RequiresConsent: true},
		{Code: "STATIONERY", Name: "Stationery", Description: "Exercise books, pens, learning materials", IsTuition: false, IsOptional: true, RequiresConsent: false},
		{Code: "TRIP", Name: "School Trips", Description: "Educational trips and excursions", IsTuition: false, IsOptional: true, RequiresConsent: true},
		{Code: "CLUB", Name: "Club Fees", Description: "Club and society membership fees", IsTuition: false, IsOptional: true, RequiresConsent: true},
	}
	c.JSON(http.StatusOK, validation.List(templates))
}

// FeeCategoryRequest is the payload for creating or updating a custom fee
// category.
type FeeCategoryRequest struct {
	Code            string `json:"code" binding:"required,max=30"`
	Name            string `json:"name" binding:"required,max=100"`
	Description     string `json:"description"`
	IsTuition       bool   `json:"is_tuition"`
	IsOptional      bool   `json:"is_optional"`
	RequiresConsent bool   `json:"requires_consent"`
	IsActive        *bool  `json:"is_active"`
}

// normalise validates and canonicalises a custom category payload.
func (r *FeeCategoryRequest) normalise() []validation.FieldError {
	var errs []validation.FieldError

	code := strings.ToUpper(strings.TrimSpace(r.Code))
	if code == "" {
		errs = append(errs, validation.FieldError{
			Field: "code", Code: "REQUIRED", Message: "'code' is required",
		})
	} else if !regexp.MustCompile(`^[A-Z0-9_]{2,30}$`).MatchString(code) {
		errs = append(errs, validation.FieldError{
			Field: "code", Code: "INVALID_VALUE",
			Message: "'code' must be 2-30 characters using letters, digits or underscores",
		})
	}
	r.Code = code

	r.Name = strings.TrimSpace(r.Name)
	if r.Name == "" {
		errs = append(errs, validation.FieldError{
			Field: "name", Code: "REQUIRED", Message: "'name' is required",
		})
	}

	return errs
}

// CreateFeeCategory creates a custom fee category for the calling school.
func (h *Handler) CreateFeeCategory(c *gin.Context) {
	tenantID := c.GetString("tenant_id")

	var req FeeCategoryRequest
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	if errs := req.normalise(); len(errs) > 0 {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}

	categoryID, err := h.service.CreateFeeCategory(c.Request.Context(), tenantID, req)
	if err != nil {
		if isUniqueViolation(err) {
			validation.Conflict(c, "A fee category with this code already exists")
			return
		}
		validation.DBError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"category_id": categoryID})
}

// UpdateFeeCategory updates a custom fee category owned by the calling school.
func (h *Handler) UpdateFeeCategory(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	categoryID := c.Param("id")

	var req FeeCategoryRequest
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	if errs := req.normalise(); len(errs) > 0 {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}

	// is_active defaults to true when the client omits it.
	if req.IsActive == nil {
		active := true
		req.IsActive = &active
	}

	if err := h.service.UpdateFeeCategory(c.Request.Context(), tenantID, categoryID, req); err != nil {
		if err == sql.ErrNoRows {
			validation.NotFound(c, "Fee category not found")
			return
		}
		if isUniqueViolation(err) {
			validation.Conflict(c, "A fee category with this code already exists")
			return
		}
		validation.DBError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"category_id": categoryID})
}

// DeleteFeeCategory deactivates a custom fee category owned by the calling school.
func (h *Handler) DeleteFeeCategory(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	categoryID := c.Param("id")

	if err := h.service.DeleteFeeCategory(c.Request.Context(), tenantID, categoryID); err != nil {
		if err == sql.ErrNoRows {
			validation.NotFound(c, "Fee category not found")
			return
		}
		validation.DBError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"category_id": categoryID, "message": "Fee category deactivated"})
}

// isUniqueViolation reports whether err is a PostgreSQL unique-constraint
// violation.
func isUniqueViolation(err error) bool {
	var pgErr *pq.Error
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23505"
	}
	return false
}

func (h *Handler) CreateFeeStructure(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	var fs FeeStructure
	if errs := validation.BindJSON(c, &fs); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	residence := strings.ToUpper(strings.TrimSpace(fs.ResidenceType))
	if residence == "" {
		residence = "ALL"
	}
	if _, ok := validResidenceTypes[residence]; !ok {
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "residence_type", Code: "INVALID_VALUE", Message: "'residence_type' must be ALL, DAY_SCHOLAR_NO_LUNCH, DAY_SCHOLAR_WITH_LUNCH, BOARDER_FULL or BOARDER_WEEKLY"},
		})
		return
	}
	fs.ResidenceType = residence
	created, err := h.service.CreateFeeStructure(c.Request.Context(), tenantID, fs)
	if err != nil {
		validation.DBError(c, err)
		return
	}
	c.JSON(http.StatusCreated, created)
}

// Learner Fee Options handlers
func (h *Handler) ListLearnerFeeOptions(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	learnerID := c.Param("learner_id")
	options, err := h.service.ListLearnerFeeOptions(c.Request.Context(), tenantID, learnerID)
	if err != nil {
		validation.DBError(c, err)
		return
	}
	c.JSON(http.StatusOK, validation.List(options))
}

func (h *Handler) UpsertLearnerFeeOption(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	learnerID := c.Param("learner_id")
	var o LearnerFeeOption
	if errs := validation.BindJSON(c, &o); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	o.LearnerID = learnerID
	if strings.TrimSpace(o.CategoryID) == "" || strings.TrimSpace(o.StructureID) == "" {
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "category_id", Code: "REQUIRED", Message: "category_id and structure_id are required"},
		})
		return
	}
	o.OptedBy = c.GetString("user_id")
	created, err := h.service.UpsertLearnerFeeOption(c.Request.Context(), tenantID, o)
	if err != nil {
		validation.DBError(c, err)
		return
	}
	c.JSON(http.StatusOK, created)
}

// Invoices handlers
func (h *Handler) ListInvoices(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	limit, offset := paginationParams(c)
	invoices, err := h.service.ListInvoices(c.Request.Context(), tenantID, limit, offset)
	if err != nil {
		validation.DBError(c, err)
		return
	}
	c.JSON(http.StatusOK, validation.List(invoices))
}

func (h *Handler) CreateInvoice(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	var inv Invoice
	if errs := validation.BindJSON(c, &inv); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	created, err := h.service.CreateInvoice(c.Request.Context(), tenantID, inv)
	if err != nil {
		validation.DBError(c, err)
		return
	}
	c.JSON(http.StatusCreated, created)
}

// Invoice Lines handlers
func (h *Handler) ListInvoiceLines(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	invoiceID := c.Param("invoice_id")
	lines, err := h.service.ListInvoiceLines(c.Request.Context(), tenantID, invoiceID)
	if err != nil {
		validation.DBError(c, err)
		return
	}
	c.JSON(http.StatusOK, validation.List(lines))
}

func (h *Handler) CreateInvoiceLine(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	invoiceID := c.Param("invoice_id")
	var l InvoiceLine
	if errs := validation.BindJSON(c, &l); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	l.InvoiceID = invoiceID
	created, err := h.service.CreateInvoiceLine(c.Request.Context(), tenantID, l)
	if err != nil {
		validation.DBError(c, err)
		return
	}
	c.JSON(http.StatusCreated, created)
}

// Payments handlers
func (h *Handler) ListPayments(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	limit, offset := paginationParams(c)
	payments, err := h.service.ListPayments(c.Request.Context(), tenantID, limit, offset)
	if err != nil {
		validation.DBError(c, err)
		return
	}
	c.JSON(http.StatusOK, validation.List(payments))
}

// Parent-scoped reads: the same rows as the staff lists, filtered to the
// learners linked to the signed-in guardian.
func (h *Handler) ListParentInvoices(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")
	limit, offset := paginationParams(c)
	invoices, err := h.service.ParentInvoices(c.Request.Context(), tenantID, userID, limit, offset)
	if err != nil {
		validation.DBError(c, err)
		return
	}
	c.JSON(http.StatusOK, validation.List(invoices))
}

func (h *Handler) ListParentPayments(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")
	limit, offset := paginationParams(c)
	payments, err := h.service.ParentPayments(c.Request.Context(), tenantID, userID, limit, offset)
	if err != nil {
		validation.DBError(c, err)
		return
	}
	c.JSON(http.StatusOK, validation.List(payments))
}

// Payment Allocation handler
func (h *Handler) AllocatePayment(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	var alloc PaymentAllocation
	if errs := validation.BindJSON(c, &alloc); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	created, err := h.service.AllocatePayment(c.Request.Context(), tenantID, alloc)
	if err != nil {
		validation.DBError(c, err)
		return
	}
	c.JSON(http.StatusOK, created)
}

// Credits handler
func (h *Handler) ListCredits(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	limit, offset := paginationParams(c)
	credits, err := h.service.ListCredits(c.Request.Context(), tenantID, limit, offset)
	if err != nil {
		validation.DBError(c, err)
		return
	}
	c.JSON(http.StatusOK, validation.List(credits))
}

func (h *Handler) CreateCredit(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	var credit Credit
	if errs := validation.BindJSON(c, &credit); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	created, err := h.service.CreateCredit(c.Request.Context(), tenantID, credit)
	if err != nil {
		validation.DBError(c, err)
		return
	}
	c.JSON(http.StatusCreated, created)
}

// Adjustments handler
func (h *Handler) ListAdjustments(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	limit, offset := paginationParams(c)
	adjustments, err := h.service.ListAdjustments(c.Request.Context(), tenantID, limit, offset)
	if err != nil {
		validation.DBError(c, err)
		return
	}
	c.JSON(http.StatusOK, validation.List(adjustments))
}

func (h *Handler) CreateAdjustment(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	var a Adjustment
	if errs := validation.BindJSON(c, &a); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	created, err := h.service.CreateAdjustment(c.Request.Context(), tenantID, a)
	if err != nil {
		validation.DBError(c, err)
		return
	}
	c.JSON(http.StatusCreated, created)
}

// Refunds handler
func (h *Handler) ListRefunds(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	limit, offset := paginationParams(c)
	refunds, err := h.service.ListRefunds(c.Request.Context(), tenantID, limit, offset)
	if err != nil {
		validation.DBError(c, err)
		return
	}
	c.JSON(http.StatusOK, validation.List(refunds))
}

func (h *Handler) CreateRefund(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	var r Refund
	if errs := validation.BindJSON(c, &r); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	created, err := h.service.CreateRefund(c.Request.Context(), tenantID, r)
	if err != nil {
		validation.DBError(c, err)
		return
	}
	c.JSON(http.StatusCreated, created)
}

// M-Pesa Transactions handler
func (h *Handler) ListMPESATransactions(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	limit, offset := paginationParams(c)
	txns, err := h.service.ListMPESATransactions(c.Request.Context(), tenantID, limit, offset)
	if err != nil {
		validation.DBError(c, err)
		return
	}
	c.JSON(http.StatusOK, validation.List(txns))
}

func (h *Handler) CreateMPESATransaction(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	var t MPESATransaction
	if errs := validation.BindJSON(c, &t); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	created, err := h.service.CreateMPESATransaction(c.Request.Context(), tenantID, t)
	if err != nil {
		validation.DBError(c, err)
		return
	}
	c.JSON(http.StatusCreated, created)
}

// M-Pesa STK Request handler
func (h *Handler) CreateMPESASTKRequest(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	var r MPESASTKRequest
	if errs := validation.BindJSON(c, &r); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	created, err := h.service.CreateMPESASTKRequest(c.Request.Context(), tenantID, r)
	if err != nil {
		validation.DBError(c, err)
		return
	}
	c.JSON(http.StatusCreated, created)
}

// CreateParentMPESASTKRequest lets a parent/guardian principal initiate an
// M-Pesa STK push for one of THEIR OWN invoices only. The invoice must belong
// to a learner linked to the caller via learner_guardians; the amount may not
// exceed the outstanding balance. The channel is resolved server-side from
// the school's default ACTIVE M-PESA channel, so the request body only needs
// invoice_id, phone_number and amount.
func (h *Handler) CreateParentMPESASTKRequest(c *gin.Context) {
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")

	var req struct {
		InvoiceID   string  `json:"invoice_id" binding:"required"`
		PhoneNumber string  `json:"phone_number" binding:"required"`
		Amount      float64 `json:"amount"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}

	// Normalise the Safaricom number to 2547XXXXXXXX / 2541XXXXXXXX.
	phone := strings.TrimSpace(req.PhoneNumber)
	phone = regexp.MustCompile(`[+\s\-]`).ReplaceAllString(phone, "")
	switch {
	case strings.HasPrefix(phone, "+254"):
		phone = "254" + phone[4:]
	case strings.HasPrefix(phone, "0"):
		phone = "254" + phone[1:]
	case strings.HasPrefix(phone, "7") || strings.HasPrefix(phone, "1"):
		phone = "254" + phone
	}
	if !regexp.MustCompile(`^254[17]\d{8}$`).MatchString(phone) {
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "phone_number", Code: "INVALID_VALUE", Message: "phone must be a Safaricom number like 07XXXXXXXX or 2547XXXXXXXX"},
		})
		return
	}

	// The invoice must belong to a learner linked to this guardian user.
	var outstanding float64
	var admissionNo string
	err := tx.QueryRow(
		`SELECT i.amount_outstanding, l.admission_number
		 FROM invoices i
		 JOIN learners l ON l.learner_id = i.learner_id
		 JOIN learner_guardians lg ON lg.learner_id = l.learner_id
		 JOIN guardians gd ON gd.guardian_id = lg.guardian_id
		 WHERE i.invoice_id = $1 AND i.tenant_id = $2 AND gd.user_id = $3
		 LIMIT 1`,
		req.InvoiceID, tenantID, userID,
	).Scan(&outstanding, &admissionNo)
	if errors.Is(err, sql.ErrNoRows) {
		validation.NotFound(c, "Invoice not found among your linked learners' invoices")
		return
	}
	if err != nil {
		validation.DBError(c, err)
		return
	}

	amount := req.Amount
	if amount <= 0 {
		amount = outstanding
	}
	if amount <= 0 {
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "amount", Code: "INVALID_VALUE", Message: "amount must be greater than zero"},
		})
		return
	}
	if amount > outstanding+0.001 {
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "amount", Code: "INVALID_VALUE", Message: "amount exceeds the outstanding balance"},
		})
		return
	}

	// Resolve the school's default ACTIVE M-PESA channel.
	var channelID string
	err = tx.QueryRow(
		`SELECT channel_id FROM school_payment_channels
		 WHERE tenant_id = $1 AND UPPER(channel_type) = 'MPESA' AND status = 'ACTIVE'
		 ORDER BY is_default DESC, created_at ASC LIMIT 1`,
		tenantID,
	).Scan(&channelID)
	if errors.Is(err, sql.ErrNoRows) || err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    "MPESA_NOT_CONFIGURED",
			"message": "M-Pesa STK is not enabled for this school yet",
		})
		return
	}

	created, err := h.service.CreateMPESASTKRequest(c.Request.Context(), tenantID, MPESASTKRequest{
		ChannelID:         channelID,
		CheckoutRequestID: "PARENT-" + strings.ToUpper(uuid.NewString()[:10]),
		MerchantRequestID: "PARENT-" + strings.ToUpper(uuid.NewString()[:10]),
		PhoneNumber:       phone,
		Amount:            amount,
		Currency:          "KES",
		AccountReference:  admissionNo,
		TransactionDesc:   "School fees invoice " + req.InvoiceID,
		Status:            "PENDING",
	})
	if err != nil {
		validation.DBError(c, err)
		return
	}

	// Record the STK request as PENDING. The actual Daraja STK push is
	// dispatched asynchronously by the background stkPusher worker (see
	// cmd/api/server.go) so no HTTP call is made while this transaction is
	// open (no HTTP-in-tx). The client polls ParentMPESASTKStatus for the
	// checkout_request_id once the push completes.
	c.JSON(http.StatusCreated, gin.H{
		"stk_id":              created.STKID,
		"status":              "PENDING",
		"amount":              amount,
		"account_reference":   admissionNo,
		"daraja_pushed":       false,
		"checkout_request_id": "",
	})
	return
}

// ParentMPESASTKStatus returns the polling-safe status of an STK request
// created from the parent portal. Access is restricted to requests whose
// phone number matches one of the caller's linked guardians, or the caller's
// own portal phone.
func (h *Handler) ParentMPESASTKStatus(c *gin.Context) {
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")
	stkID := c.Param("id")

	var status, phone string
	err := tx.QueryRow(
		`SELECT r.status, r.phone_number
		 FROM mpesa_stk_requests r
		 WHERE r.stk_id = $1 AND r.tenant_id = $2
		 AND EXISTS (
			SELECT 1 FROM guardians gd
			WHERE gd.tenant_id = $2 AND (gd.user_id = $3 OR gd.phone_number = r.phone_number)
		 )`,
		stkID, tenantID, userID,
	).Scan(&status, &phone)
	if errors.Is(err, sql.ErrNoRows) {
		validation.NotFound(c, "STK request not found")
		return
	}
	if err != nil {
		validation.DBError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"stk_id": stkID, "status": status})
}

// Receipt Sequence handler
func (h *Handler) GetReceiptSequence(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	period := c.Param("period")
	seq, err := h.service.GetReceiptSequence(c.Request.Context(), tenantID, period)
	if err != nil {
		validation.DBError(c, err)
		return
	}
	c.JSON(http.StatusOK, seq)
}

func (h *Handler) IncrementReceiptSequence(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	sequenceID := c.Param("sequence_id")
	if err := h.service.IncrementReceiptSequence(c.Request.Context(), tenantID, sequenceID); err != nil {
		validation.DBError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": "INCREMENTED", "message": "Receipt sequence incremented"})
}

// Capitation Receipts handler
func (h *Handler) ListCapitationReceipts(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	receipts, err := h.service.ListCapitationReceipts(c.Request.Context(), tenantID)
	if err != nil {
		validation.DBError(c, err)
		return
	}
	c.JSON(http.StatusOK, validation.List(receipts))
}

// Reconciliation Runs handler
func (h *Handler) ListReconciliationRuns(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	runs, err := h.service.ListReconciliationRuns(c.Request.Context(), tenantID)
	if err != nil {
		validation.DBError(c, err)
		return
	}
	c.JSON(http.StatusOK, validation.List(runs))
}

// ============ Pagination helper ============

func paginationParams(c *gin.Context) (limit, offset int) {
	limit = 50
	if v := c.Query("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 200 {
			limit = n
		}
	}
	offset = 0
	if v := c.Query("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			offset = n
		}
	}
	return limit, offset
}

// darajaConfigured reports whether the live M-Pesa STK path is provisioned
// via environment credentials (see internal/daraja/stk.go).
func darajaConfigured() bool {
	return os.Getenv("MPESA_SHORTCODE") != "" &&
		os.Getenv("MPESA_PASSKEY") != "" &&
		os.Getenv("MPESA_CONSUMER_KEY") != "" &&
		os.Getenv("MPESA_CONSUMER_SECRET") != "" &&
		os.Getenv("MPESA_STK_CALLBACK_URL") != ""
}

// uuidMustParse converts a tenant_id string to a UUID; the middleware has
// already validated it as a UUID, so failure here is terminal.
func uuidMustParse(s string) uuid.UUID {
	id, err := uuid.Parse(s)
	if err != nil {
		panic("invalid tenant uuid: " + s)
	}
	return id
}

var _ = http.StatusOK

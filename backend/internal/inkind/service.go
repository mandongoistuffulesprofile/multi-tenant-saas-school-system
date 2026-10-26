package inkind

import (
	"context"
	"database/sql"
	"errors"

	"github.com/lib/pq"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
)

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

// ============ Types ============

type InKindRate struct {
	ID           string  `json:"id"`
	TenantID     string  `json:"tenant_id"`
	CommodityName string `json:"commodity_name"`
	Unit         string  `json:"unit"`
	RatePerUnit  float64 `json:"rate_per_unit"`
	IsActive     bool    `json:"is_active"`
	EffectiveFrom string `json:"effective_from"`
	EffectiveTo   *string `json:"effective_to,omitempty"`
	CreatedBy     *string `json:"created_by,omitempty"`
	CreatedAt     string  `json:"created_at"`
	UpdatedAt     string  `json:"updated_at"`
}

type InventoryItem struct {
	ID            string  `json:"id"`
	TenantID      string  `json:"tenant_id"`
	ItemName      string  `json:"item_name"`
	ItemType      string  `json:"item_type"`
	Unit          string  `json:"unit"`
	UnitWeightKg  *float64 `json:"unit_weight_kg,omitempty"`
	Description   *string `json:"description,omitempty"`
	IsActive      bool    `json:"is_active"`
	CreatedBy     *string `json:"created_by,omitempty"`
	CreatedAt     string  `json:"created_at"`
	UpdatedAt     string  `json:"updated_at"`
}

type InKindIntakeLog struct {
	ID           string  `json:"id"`
	TenantID     string  `json:"tenant_id"`
	StudentID    string  `json:"student_id"`
	IntakeDate   string  `json:"intake_date"`
	ReceivedBy   *string `json:"received_by,omitempty"`
	RecordedBy   *string `json:"recorded_by,omitempty"`
	IntakeNumber string  `json:"intake_number"`
	Status       string  `json:"status"`
	Notes        *string `json:"notes,omitempty"`
	CreatedAt    string  `json:"created_at"`
	UpdatedAt    string  `json:"updated_at"`
}

type InKindIntakeItem struct {
	ID               string   `json:"id"`
	TenantID         string   `json:"tenant_id"`
	IntakeLogID      string   `json:"intake_log_id"`
	InventoryItemID  string   `json:"inventory_item_id"`
	Quantity         float64  `json:"quantity"`
	Unit             string   `json:"unit"`
	RatePerUnit      float64  `json:"rate_per_unit"`
	CashEquivalent   float64  `json:"cash_equivalent"`
	QualityGrade     *string  `json:"quality_grade,omitempty"`
	VerifiedQuantity *float64 `json:"verified_quantity,omitempty"`
	VerifiedBy       *string  `json:"verified_by,omitempty"`
	VerifiedAt       *string  `json:"verified_at,omitempty"`
	Notes            *string  `json:"notes,omitempty"`
	CreatedAt        string   `json:"created_at"`
}

type FeePaymentAllocation struct {
	ID                  string  `json:"id"`
	TenantID            string  `json:"tenant_id"`
	StudentID           string  `json:"student_id"`
	PaymentType         string  `json:"payment_type"`
	SourceReference     *string `json:"source_reference,omitempty"`
	Amount              float64 `json:"amount"`
	AllocatedToInvoiceID *string `json:"allocated_to_invoice_id,omitempty"`
	AllocationDate      string  `json:"allocation_date"`
	AllocatedBy         *string `json:"allocated_by,omitempty"`
	Notes               *string `json:"notes,omitempty"`
	CreatedAt           string  `json:"created_at"`
}

type CreateInKindRateRequest struct {
	CommodityName string  `json:"commodity_name" binding:"required"`
	Unit          string  `json:"unit" binding:"required"`
	RatePerUnit   float64 `json:"rate_per_unit" binding:"required,gt=0"`
	EffectiveFrom string  `json:"effective_from"`
}

type CreateInventoryItemRequest struct {
	ItemName     string  `json:"item_name" binding:"required"`
	ItemType     string  `json:"item_type" binding:"required"`
	Unit         string  `json:"unit" binding:"required"`
	UnitWeightKg *float64 `json:"unit_weight_kg"`
	Description  *string `json:"description"`
}

type CreateIntakeLogRequest struct {
	StudentID    string                    `json:"student_id" binding:"required"`
	IntakeDate   string                    `json:"intake_date"`
	IntakeNumber string                    `json:"intake_number" binding:"required"`
	Notes        *string                   `json:"notes"`
	Items        []CreateIntakeItemRequest `json:"items" binding:"required,min=1"`
}

type CreateIntakeItemRequest struct {
	InventoryItemID string  `json:"inventory_item_id" binding:"required"`
	Quantity        float64 `json:"quantity" binding:"required,gt=0"`
	QualityGrade    *string `json:"quality_grade"`
	Notes           *string `json:"notes"`
}

type VerifyIntakeRequest struct {
	Items []VerifyIntakeItemRequest `json:"items" binding:"required"`
	Notes *string                    `json:"notes"`
}

type VerifyIntakeItemRequest struct {
	IntakeItemID     string   `json:"intake_item_id" binding:"required"`
	VerifiedQuantity float64  `json:"verified_quantity" binding:"required,gte=0"`
	QualityGrade     *string  `json:"quality_grade"`
	Notes            *string  `json:"notes"`
}

type CreateAllocationRequest struct {
	StudentID       string  `json:"student_id" binding:"required"`
	PaymentType     string  `json:"payment_type" binding:"required"`
	SourceReference *string `json:"source_reference"`
	Amount          float64 `json:"amount" binding:"required,gte=0"`
	AllocatedToInvoiceID *string `json:"allocated_to_invoice_id"`
	Notes           *string `json:"notes"`
}

// ============ Methods ============

func (s *Service) q(ctx context.Context) queryer {
	if q := middleware.TxFromContext(ctx); q != nil {
		return q
	}
	return s.database
}

func (s *Service) ListRates(ctx context.Context, tenantID string, includeInactive bool) ([]InKindRate, error) {
	q := s.q(ctx)
	query := `SELECT id, tenant_id, commodity_name, unit, rate_per_unit, is_active, effective_from, effective_to, created_by, created_at, updated_at
			  FROM in_kind_rates WHERE tenant_id = $1`
	args := []interface{}{tenantID}
	if !includeInactive {
		query += ` AND is_active = true`
	}
	query += ` ORDER BY commodity_name, effective_from DESC`

	rows, err := q.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rates []InKindRate
	for rows.Next() {
		var r InKindRate
		if err := rows.Scan(&r.ID, &r.TenantID, &r.CommodityName, &r.Unit, &r.RatePerUnit, &r.IsActive,
			&r.EffectiveFrom, &r.EffectiveTo, &r.CreatedBy, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, err
		}
		rates = append(rates, r)
	}
	return rates, rows.Err()
}

func (s *Service) CreateRate(ctx context.Context, tenantID, userID string, req CreateInKindRateRequest) (*InKindRate, error) {
	q := s.q(ctx)
	effectiveFrom := req.EffectiveFrom
	if effectiveFrom == "" {
		effectiveFrom = "CURRENT_DATE"
	}

	var r InKindRate
	err := q.QueryRow(
		`INSERT INTO in_kind_rates (tenant_id, commodity_name, unit, rate_per_unit, effective_from, created_by)
		 VALUES ($1, $2, $3, $4, COALESCE($5::date, CURRENT_DATE), $6)
		 RETURNING id, tenant_id, commodity_name, unit, rate_per_unit, is_active, effective_from, effective_to, created_by, created_at, updated_at`,
		tenantID, req.CommodityName, req.Unit, req.RatePerUnit, effectiveFrom, nullIfEmpty(userID),
	).Scan(&r.ID, &r.TenantID, &r.CommodityName, &r.Unit, &r.RatePerUnit, &r.IsActive,
		&r.EffectiveFrom, &r.EffectiveTo, &r.CreatedBy, &r.CreatedAt, &r.UpdatedAt)
	if err != nil {
		var pqErr *pq.Error
		if errors.As(err, &pqErr) && pqErr.Code == "23505" {
			return nil, errors.New("rate already exists for this commodity/unit/effective date")
		}
		return nil, err
	}
	return &r, nil
}

func (s *Service) ListItems(ctx context.Context, tenantID string, itemType string) ([]InventoryItem, error) {
	q := s.q(ctx)
	query := `SELECT id, tenant_id, item_name, item_type, unit, unit_weight_kg, description, is_active, created_by, created_at, updated_at
			  FROM inventory_items WHERE tenant_id = $1 AND is_active = true`
	args := []interface{}{tenantID}
	if itemType != "" {
		query += ` AND item_type = $2`
		args = append(args, itemType)
	}
	query += ` ORDER BY item_name`

	rows, err := q.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []InventoryItem
	for rows.Next() {
		var i InventoryItem
		if err := rows.Scan(&i.ID, &i.TenantID, &i.ItemName, &i.ItemType, &i.Unit, &i.UnitWeightKg,
			&i.Description, &i.IsActive, &i.CreatedBy, &i.CreatedAt, &i.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, i)
	}
	return items, rows.Err()
}

func (s *Service) CreateItem(ctx context.Context, tenantID, userID string, req CreateInventoryItemRequest) (*InventoryItem, error) {
	q := s.q(ctx)
	var i InventoryItem
	err := q.QueryRow(
		`INSERT INTO inventory_items (tenant_id, item_name, item_type, unit, unit_weight_kg, description, created_by)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 RETURNING id, tenant_id, item_name, item_type, unit, unit_weight_kg, description, is_active, created_by, created_at, updated_at`,
		tenantID, req.ItemName, req.ItemType, req.Unit, req.UnitWeightKg, req.Description, nullIfEmpty(userID),
	).Scan(&i.ID, &i.TenantID, &i.ItemName, &i.ItemType, &i.Unit, &i.UnitWeightKg,
		&i.Description, &i.IsActive, &i.CreatedBy, &i.CreatedAt, &i.UpdatedAt)
	if err != nil {
		var pqErr *pq.Error
		if errors.As(err, &pqErr) && pqErr.Code == "23505" {
			return nil, errors.New("item already exists")
		}
		return nil, err
	}
	return &i, nil
}

func (s *Service) ListIntakes(ctx context.Context, tenantID, studentID, status string, limit, offset int) ([]InKindIntakeLog, error) {
	q := s.q(ctx)
	query := `SELECT id, tenant_id, student_id, intake_date, received_by, recorded_by, intake_number, status, notes, created_at, updated_at
			  FROM in_kind_intake_logs WHERE tenant_id = $1`
	args := []interface{}{tenantID}
	argIdx := 2
	if studentID != "" {
		query += ` AND student_id = $` + string(rune(argIdx+'0'))
		args = append(args, studentID)
		argIdx++
	}
	if status != "" {
		query += ` AND status = $` + string(rune(argIdx+'0'))
		args = append(args, status)
		argIdx++
	}
	query += ` ORDER BY intake_date DESC LIMIT $` + string(rune(argIdx+'0')) + ` OFFSET $` + string(rune(argIdx+1))
	args = append(args, limit, offset)

	rows, err := q.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var logs []InKindIntakeLog
	for rows.Next() {
		var l InKindIntakeLog
		if err := rows.Scan(&l.ID, &l.TenantID, &l.StudentID, &l.IntakeDate, &l.ReceivedBy, &l.RecordedBy,
			&l.IntakeNumber, &l.Status, &l.Notes, &l.CreatedAt, &l.UpdatedAt); err != nil {
			return nil, err
		}
		logs = append(logs, l)
	}
	return logs, rows.Err()
}

func (s *Service) GetIntake(ctx context.Context, tenantID, logID string) (*InKindIntakeLog, error) {
	q := s.q(ctx)
	var l InKindIntakeLog
	err := q.QueryRow(
		`SELECT id, tenant_id, student_id, intake_date, received_by, recorded_by, intake_number, status, notes, created_at, updated_at
		 FROM in_kind_intake_logs WHERE tenant_id = $1 AND id = $2`,
		tenantID, logID,
	).Scan(&l.ID, &l.TenantID, &l.StudentID, &l.IntakeDate, &l.ReceivedBy, &l.RecordedBy,
		&l.IntakeNumber, &l.Status, &l.Notes, &l.CreatedAt, &l.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &l, nil
}

func (s *Service) CreateIntake(ctx context.Context, tenantID, userID string, req CreateIntakeLogRequest) (*InKindIntakeLog, error) {
	q := s.q(ctx)
	tx, ok := q.(*sql.Tx)
	if !ok {
		return nil, errors.New("transaction required")
	}

	intakeDate := req.IntakeDate
	if intakeDate == "" {
		intakeDate = "CURRENT_DATE"
	}

	var l InKindIntakeLog
	err := tx.QueryRow(
		`INSERT INTO in_kind_intake_logs (tenant_id, student_id, intake_date, received_by, recorded_by, intake_number, notes)
		 VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE), $4, $5, $6, $7)
		 RETURNING id, tenant_id, student_id, intake_date, received_by, recorded_by, intake_number, status, notes, created_at, updated_at`,
		tenantID, req.StudentID, intakeDate, nullIfEmpty(userID), nullIfEmpty(userID), req.IntakeNumber, req.Notes,
	).Scan(&l.ID, &l.TenantID, &l.StudentID, &l.IntakeDate, &l.ReceivedBy, &l.RecordedBy,
		&l.IntakeNumber, &l.Status, &l.Notes, &l.CreatedAt, &l.UpdatedAt)
	if err != nil {
		var pqErr *pq.Error
		if errors.As(err, &pqErr) && pqErr.Code == "23505" {
			return nil, errors.New("intake number already exists")
		}
		return nil, err
	}

	for _, item := range req.Items {
		var ratePerUnit float64
		var unit string
		err := tx.QueryRow(
			`SELECT rate_per_unit, unit FROM in_kind_rates WHERE tenant_id = $1 AND commodity_name = 
			 (SELECT item_name FROM inventory_items WHERE id = $2) AND is_active = true 
			 AND effective_from <= CURRENT_DATE AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
			 ORDER BY effective_from DESC LIMIT 1`,
			tenantID, item.InventoryItemID,
		).Scan(&ratePerUnit, &unit)
		if err != nil {
			return nil, err
		}

		_, err = tx.Exec(
			`INSERT INTO in_kind_intake_items (tenant_id, intake_log_id, inventory_item_id, quantity, unit, rate_per_unit, quality_grade, notes)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			tenantID, l.ID, item.InventoryItemID, item.Quantity, unit, ratePerUnit, item.QualityGrade, item.Notes,
		)
		if err != nil {
			return nil, err
		}
	}
	return &l, nil
}

func (s *Service) VerifyIntake(ctx context.Context, tenantID, userID, logID string, req VerifyIntakeRequest) (*InKindIntakeLog, error) {
	q := s.q(ctx)
	tx, ok := q.(*sql.Tx)
	if !ok {
		return nil, errors.New("transaction required")
	}

	var l InKindIntakeLog
	err := tx.QueryRow(
		`SELECT id, tenant_id, student_id, intake_date, received_by, recorded_by, intake_number, status, notes, created_at, updated_at
		 FROM in_kind_intake_logs WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
		tenantID, logID,
	).Scan(&l.ID, &l.TenantID, &l.StudentID, &l.IntakeDate, &l.ReceivedBy, &l.RecordedBy,
		&l.IntakeNumber, &l.Status, &l.Notes, &l.CreatedAt, &l.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	for _, item := range req.Items {
		_, err := tx.Exec(
			`UPDATE in_kind_intake_items SET verified_quantity = $1, quality_grade = $2, verified_by = $3, verified_at = NOW(), notes = $4
			 WHERE id = $5 AND intake_log_id = $6`,
			item.VerifiedQuantity, item.QualityGrade, userID, item.Notes, item.IntakeItemID, logID,
		)
		if err != nil {
			return nil, err
		}
	}

	_, err = tx.Exec(`UPDATE in_kind_intake_logs SET status = 'VERIFIED', updated_at = NOW() WHERE id = $1`, logID)
	if err != nil {
		return nil, err
	}

	l.Status = "VERIFIED"
	return &l, nil
}

func (s *Service) ListAllocations(ctx context.Context, tenantID, studentID string, limit, offset int) ([]FeePaymentAllocation, error) {
	q := s.q(ctx)
	query := `SELECT id, tenant_id, student_id, payment_type, source_reference, amount, allocated_to_invoice_id, allocation_date, allocated_by, notes, created_at
			  FROM fee_payment_allocations WHERE tenant_id = $1`
	args := []interface{}{tenantID}
	argIdx := 2
	if studentID != "" {
		query += ` AND student_id = $` + string(rune('0'+argIdx))
		args = append(args, studentID)
		argIdx++
	}
	query += ` ORDER BY allocation_date DESC LIMIT $` + string(rune('0'+argIdx)) + ` OFFSET $` + string(rune('0'+argIdx+1))
	args = append(args, limit, offset)

	rows, err := q.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var allocs []FeePaymentAllocation
	for rows.Next() {
		var a FeePaymentAllocation
		if err := rows.Scan(&a.ID, &a.TenantID, &a.StudentID, &a.PaymentType, &a.SourceReference,
			&a.Amount, &a.AllocatedToInvoiceID, &a.AllocationDate, &a.AllocatedBy, &a.Notes, &a.CreatedAt); err != nil {
			return nil, err
		}
		allocs = append(allocs, a)
	}
	return allocs, rows.Err()
}

func (s *Service) CreateAllocation(ctx context.Context, tenantID, userID string, req CreateAllocationRequest) (*FeePaymentAllocation, error) {
	q := s.q(ctx)
	var a FeePaymentAllocation
	err := q.QueryRow(
		`INSERT INTO fee_payment_allocations (tenant_id, student_id, payment_type, source_reference, amount, allocated_to_invoice_id, allocated_by, notes)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		 RETURNING id, tenant_id, student_id, payment_type, source_reference, amount, allocated_to_invoice_id, allocation_date, allocated_by, notes, created_at`,
		tenantID, req.StudentID, req.PaymentType, req.SourceReference, req.Amount, req.AllocatedToInvoiceID, nullIfEmpty(userID), req.Notes,
	).Scan(&a.ID, &a.TenantID, &a.StudentID, &a.PaymentType, &a.SourceReference,
		&a.Amount, &a.AllocatedToInvoiceID, &a.AllocationDate, &a.AllocatedBy, &a.Notes, &a.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &a, nil
}

func nullIfEmpty(s string) interface{} {
	if len(s) == 0 {
		return nil
	}
	return s
}

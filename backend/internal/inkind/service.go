package inkind

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

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
	ID              string  `json:"id"`
	TenantID        string  `json:"tenant_id"`
	InventoryItemID string  `json:"inventory_item_id"`
	CommodityName   string  `json:"commodity_name"`
	Unit            string  `json:"unit"`
	RatePerUnit     float64 `json:"rate_per_unit"`
	IsActive        bool    `json:"is_active"`
	TermID          string  `json:"term_id"`
	CreatedBy       *string `json:"created_by,omitempty"`
	CreatedAt       string  `json:"created_at"`
}

type InventoryItem struct {
	ID             string   `json:"id"`
	TenantID       string   `json:"tenant_id"`
	Code           string   `json:"code"`
	Name           string   `json:"name"`
	Unit           string   `json:"unit"`
	StandardWeight *float64 `json:"standard_unit_weight_kg,omitempty"`
	IsActive       bool     `json:"is_active"`
	CreatedBy      *string  `json:"created_by,omitempty"`
	CreatedAt      string   `json:"created_at"`
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
	InventoryItemID string  `json:"inventory_item_id" binding:"required"`
	RatePerUnit     float64 `json:"rate_per_unit" binding:"required,gt=0"`
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
	query := `SELECT r.id, r.tenant_id, r.inventory_item_id, i.name, i.unit, r.rate_per_unit, r.is_current, r.term_id, r.created_by, r.created_at
			  FROM in_kind_rates r JOIN inventory_items i ON i.tenant_id = r.tenant_id AND i.id = r.inventory_item_id
			  WHERE r.tenant_id = $1`
	args := []interface{}{tenantID}
	if !includeInactive {
		query += ` AND r.is_current = true`
	}
	query += ` ORDER BY i.name, r.created_at DESC`

	rows, err := q.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rates []InKindRate
	for rows.Next() {
		var r InKindRate
		var createdBy sql.NullString
		if err := rows.Scan(&r.ID, &r.TenantID, &r.InventoryItemID, &r.CommodityName, &r.Unit, &r.RatePerUnit, &r.IsActive,
			&r.TermID, &createdBy, &r.CreatedAt); err != nil {
			return nil, err
		}
		if createdBy.Valid {
			s := createdBy.String
			r.CreatedBy = &s
		}
		rates = append(rates, r)
	}
	return rates, rows.Err()
}

func (s *Service) CreateRate(ctx context.Context, tenantID, userID string, req CreateInKindRateRequest) (*InKindRate, error) {
	q := s.q(ctx)
	// Look up current term
	var termID string
	err := q.QueryRow(`SELECT term_id FROM terms WHERE tenant_id = $1 AND is_current = true LIMIT 1`, tenantID).Scan(&termID)
	if err != nil {
		return nil, errors.New("no current term configured")
	}

	var r InKindRate
	err = q.QueryRow(
		`INSERT INTO in_kind_rates (tenant_id, inventory_item_id, term_id, rate_per_unit, is_current, created_by)
		 VALUES ($1, $2, $3, $4, true, $5)
		 RETURNING id, tenant_id, inventory_item_id, rate_per_unit, is_current, term_id, created_by, created_at`,
		tenantID, req.InventoryItemID, termID, req.RatePerUnit, nullIfEmpty(userID),
	).Scan(&r.ID, &r.TenantID, &r.InventoryItemID, &r.RatePerUnit, &r.IsActive,
		&r.TermID, &r.CreatedBy, &r.CreatedAt)
	if err != nil {
		var pqErr *pq.Error
		if errors.As(err, &pqErr) && pqErr.Code == "23505" {
			return nil, errors.New("rate already exists for this item/term")
		}
		return nil, err
	}
	// Look up item name
	q.QueryRow(`SELECT name, unit FROM inventory_items WHERE tenant_id = $1 AND id = $2`, tenantID, req.InventoryItemID).Scan(&r.CommodityName, &r.Unit)
	return &r, nil
}

func (s *Service) ListItems(ctx context.Context, tenantID string, itemType string) ([]InventoryItem, error) {
	q := s.q(ctx)
	query := `SELECT id, tenant_id, code, name, unit, standard_unit_weight_kg, is_active, created_by, created_at
			  FROM inventory_items WHERE tenant_id = $1 AND is_active = true`
	args := []interface{}{tenantID}
	query += ` ORDER BY name`

	rows, err := q.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []InventoryItem
	for rows.Next() {
		var i InventoryItem
		var createdBy sql.NullString
		var weight sql.NullFloat64
		if err := rows.Scan(&i.ID, &i.TenantID, &i.Code, &i.Name, &i.Unit, &weight,
			&i.IsActive, &createdBy, &i.CreatedAt); err != nil {
			return nil, err
		}
		if weight.Valid {
			w := weight.Float64
			i.StandardWeight = &w
		}
		if createdBy.Valid {
			c := createdBy.String
			i.CreatedBy = &c
		}
		items = append(items, i)
	}
	return items, rows.Err()
}

func (s *Service) CreateItem(ctx context.Context, tenantID, userID string, req CreateInventoryItemRequest) (*InventoryItem, error) {
	q := s.q(ctx)
	var i InventoryItem
	err := q.QueryRow(
		`INSERT INTO inventory_items (tenant_id, code, name, unit, standard_unit_weight_kg, created_by)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING id, tenant_id, code, name, unit, standard_unit_weight_kg, is_active, created_by, created_at`,
		tenantID, req.ItemName, req.ItemName, req.Unit, req.UnitWeightKg, nullIfEmpty(userID),
	).Scan(&i.ID, &i.TenantID, &i.Code, &i.Name, &i.Unit, &i.StandardWeight,
		&i.IsActive, &i.CreatedBy, &i.CreatedAt)
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

	// Look up current term
	var termID string
	err := tx.QueryRow(`SELECT term_id FROM terms WHERE tenant_id = $1 AND is_current = true LIMIT 1`, tenantID).Scan(&termID)
	if err != nil {
		return nil, errors.New("no current term configured")
	}

	intakeDate := req.IntakeDate
	if intakeDate == "" {
		intakeDate = "CURRENT_DATE"
	}

	var l InKindIntakeLog
	err = tx.QueryRow(
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

	var totalValue float64
	for _, item := range req.Items {
		// Look up active rate per item per term
		var ratePerUnit float64
		var unit string
		err := tx.QueryRow(
			`SELECT rate_per_unit, (SELECT unit FROM inventory_items WHERE tenant_id = $1 AND id = $2)
			 FROM in_kind_rates WHERE tenant_id = $1 AND inventory_item_id = $2 AND term_id = $3 AND is_current = true
			 LIMIT 1`,
			tenantID, item.InventoryItemID, termID,
		).Scan(&ratePerUnit, &unit)
		if err != nil {
			return nil, errors.New("no active rate for item " + item.InventoryItemID)
		}

		cashEquivalent := item.Quantity * ratePerUnit
		totalValue += cashEquivalent

		// Insert intake item with rate snapshot
		_, err = tx.Exec(
			`INSERT INTO in_kind_intake_items (tenant_id, intake_log_id, inventory_item_id, quantity, unit, rate_per_unit, cash_equivalent, quality_grade, notes)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
			tenantID, l.ID, item.InventoryItemID, item.Quantity, unit, ratePerUnit, cashEquivalent, item.QualityGrade, item.Notes,
		)
		if err != nil {
			return nil, err
		}

		// Create inventory lot (FIFO) with unit cost = rate applied
		_, err = tx.Exec(
			`INSERT INTO inventory_lots (tenant_id, source_type, source_id, inventory_item_id, qty_received, qty_remaining, unit_cost)
			 VALUES ($1, 'IN_KIND', $2, $3, $4, $4, $5)`,
			tenantID, l.ID, item.InventoryItemID, item.Quantity, ratePerUnit,
		)
		if err != nil {
			return nil, err
		}
	}

	// Create journal entry (double-entry): debit inventory asset, credit student fee receivable
	var entryID string
	err = tx.QueryRow(
		`INSERT INTO journal_entries (tenant_id, entry_date, source_type, source_id, memo, created_by)
		 VALUES ($1, CURRENT_TIMESTAMP, 'IN_KIND_INTAKE', $2, $3, $4)
		 RETURNING id`,
		tenantID, l.ID, "In-kind intake "+req.IntakeNumber, nullIfEmpty(userID),
	).Scan(&entryID)
	if err != nil {
		return nil, err
	}

	// Debit: Central Food Inventory asset account
	// Credit: student fee receivable (Boarding votehead)
	// For simplicity, we create two lines. In production, look up account IDs.
	// Line 1: Debit inventory (asset +)
	_, err = tx.Exec(
		`INSERT INTO journal_lines (tenant_id, entry_id, account_id, student_id, debit, credit)
		 SELECT $1, $2, la.id, $3::uuid, $4, 0
		 FROM ledger_accounts la WHERE la.tenant_id = $1 AND la.code = 'INV_FOOD' LIMIT 1`,
		tenantID, entryID, req.StudentID, totalValue,
	)
	if err != nil {
		return nil, err
	}

	// Line 2: Credit student fee receivable (liability -)
	_, err = tx.Exec(
		`INSERT INTO journal_lines (tenant_id, entry_id, account_id, student_id, debit, credit)
		 SELECT $1, $2, la.id, $3::uuid, 0, $4
		 FROM ledger_accounts la WHERE la.tenant_id = $1 AND la.code = 'FEE_RECEIVABLE' LIMIT 1`,
		tenantID, entryID, req.StudentID, totalValue,
	)
	if err != nil {
		return nil, err
	}

	// Create notification_outbox (SMS receipt)
	_, err = tx.Exec(
		`INSERT INTO notification_outbox (tenant_id, channel, recipient, template_key, payload, status)
		 VALUES ($1, 'SMS', (SELECT phone_number FROM users WHERE user_id = (SELECT user_id FROM learners WHERE learner_id = $2)), 'IN_KIND_RECEIPT', $3, 'PENDING')`,
		tenantID, req.StudentID, `{"intake_number": "`+req.IntakeNumber+`", "total_value": `+fmt.Sprintf("%.2f", totalValue)+`}`,
	)
	if err != nil {
		// Non-fatal: log but don't fail the transaction
		_ = err
	}

	return &l, nil
}

// VoidIntake creates a reversing journal entry and removes the lot quantity.
// Blocked if the lot quantity was already consumed (escalated to adjustment).
func (s *Service) VoidIntake(ctx context.Context, tenantID, userID, logID, reason string) (*InKindIntakeLog, error) {
	q := s.q(ctx)
	tx, ok := q.(*sql.Tx)
	if !ok {
		return nil, errors.New("transaction required")
	}

	// Load intake log
	var l InKindIntakeLog
	err := tx.QueryRow(
		`SELECT id, tenant_id, student_id, intake_number, status FROM in_kind_intake_logs WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
		tenantID, logID,
	).Scan(&l.ID, &l.TenantID, &l.StudentID, &l.IntakeNumber, &l.Status)
	if err != nil {
		return nil, err
	}
	if l.Status == "VOIDED" {
		return &l, nil // already voided, idempotent
	}

	// Load intake items with their lots
	rows, err := tx.Query(
		`SELECT ii.inventory_item_id, ii.quantity, ii.rate_per_unit, ii.cash_equivalent
		 FROM in_kind_intake_items ii WHERE ii.tenant_id = $1 AND ii.intake_log_id = $2`,
		tenantID, logID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type intakeItem struct {
		InventoryItemID string
		Quantity        float64
		RatePerUnit     float64
		CashEquivalent  float64
	}
	var items []intakeItem
	for rows.Next() {
		var it intakeItem
		if err := rows.Scan(&it.InventoryItemID, &it.Quantity, &it.RatePerUnit, &it.CashEquivalent); err != nil {
			return nil, err
		}
		items = append(items, it)
	}

	// Check if any lot quantity was already consumed
	for _, it := range items {
		var remaining float64
		err := tx.QueryRow(
			`SELECT COALESCE(SUM(qty_remaining), 0) FROM inventory_lots WHERE tenant_id = $1 AND source_id = $2 AND inventory_item_id = $3`,
			tenantID, logID, it.InventoryItemID,
		).Scan(&remaining)
		if err != nil {
			return nil, err
		}
		if remaining < it.Quantity {
			return nil, errors.New("cannot void: lot quantity already consumed, escalate to adjustment")
		}
	}

	// Remove lot quantity (set to 0)
	for _, it := range items {
		_, err = tx.Exec(
			`UPDATE inventory_lots SET qty_remaining = 0 WHERE tenant_id = $1 AND source_id = $2 AND inventory_item_id = $3`,
			tenantID, logID, it.InventoryItemID,
		)
		if err != nil {
			return nil, err
		}
		// Create reversing movement
		_, err = tx.Exec(
			`INSERT INTO inventory_movements (tenant_id, inventory_item_id, qty, unit_cost, ref_type, ref_id)
			 VALUES ($1, $2, $3, $4, 'VOID', $5)`,
			tenantID, it.InventoryItemID, -it.Quantity, it.RatePerUnit, logID,
		)
		if err != nil {
			return nil, err
		}
	}

	// Create reversing journal entry
	var originalEntryID string
	_ = tx.QueryRow(
		`SELECT id FROM journal_entries WHERE tenant_id = $1 AND source_type = 'IN_KIND_INTAKE' AND source_id = $2 LIMIT 1`,
		tenantID, logID,
	).Scan(&originalEntryID)

	var reversalEntryID string
	err = tx.QueryRow(
		`INSERT INTO journal_entries (tenant_id, entry_date, source_type, source_id, memo, reverses_entry_id, created_by)
		 VALUES ($1, CURRENT_TIMESTAMP, 'IN_KIND_VOID', $2, $3, $4, $5)
		 RETURNING id`,
		tenantID, logID, "Void of intake "+l.IntakeNumber, nullIfEmpty(originalEntryID), nullIfEmpty(userID),
	).Scan(&reversalEntryID)
	if err != nil {
		return nil, err
	}

	// Reverse lines: swap debit/credit
	_, err = tx.Exec(
		`INSERT INTO journal_lines (tenant_id, entry_id, account_id, student_id, debit, credit)
		 SELECT tenant_id, $1, account_id, student_id, credit, debit
		 FROM journal_lines WHERE tenant_id = $2 AND entry_id = $3`,
		reversalEntryID, tenantID, originalEntryID,
	)
	if err != nil {
		return nil, err
	}

	// Mark intake as voided
	_, err = tx.Exec(
		`UPDATE in_kind_intake_logs SET status = 'VOIDED', updated_at = CURRENT_TIMESTAMP WHERE tenant_id = $1 AND id = $2`,
		tenantID, logID,
	)
	if err != nil {
		return nil, err
	}

	// Audit event
	_, _ = tx.Exec(
		`INSERT INTO audit_events (tenant_id, user_id, action, table_name, record_id, reason)
		 VALUES ($1, $2, 'VOID', 'in_kind_intake_logs', $3, $4)`,
		tenantID, nullIfEmpty(userID), logID, reason,
	)

	l.Status = "VOIDED"
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

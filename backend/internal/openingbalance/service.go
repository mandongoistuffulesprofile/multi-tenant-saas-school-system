package openingbalance

import (
	"context"
	"database/sql"
	"time"

	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
)

type Service struct {
	db *db.DB
}

func NewService(db *db.DB) *Service { return &Service{db: db} }

func (s *Service) q(ctx context.Context) interface {
	QueryRowContext(context.Context, string, ...interface{}) *sql.Row
	QueryContext(context.Context, string, ...interface{}) (*sql.Rows, error)
	ExecContext(context.Context, string, ...interface{}) (sql.Result, error)
} {
	if tx, ok := ctx.Value("tx").(*sql.Tx); ok {
		return tx
	}
	return s.db.DB
}

type OpeningBalanceRequest struct {
	StudentID  string  `json:"student_id" binding:"required"`
	VoteheadID string  `json:"votehead_id" binding:"required"`
	Amount     float64 `json:"amount" binding:"required"`
	AsOfDate   string  `json:"as_of_date" binding:"required"`
}

func (s *Service) PostStudentArrears(ctx context.Context, tenantID, userID string, req OpeningBalanceRequest) (string, error) {
	q := s.q(ctx)
	asOf, err := time.Parse("2006-01-02", req.AsOfDate)
	if err != nil {
		return "", err
	}
	// Create journal entry
	var entryID string
	err = q.QueryRowContext(ctx,
		`INSERT INTO journal_entries (tenant_id, entry_date, source_type, source_id, memo, created_by)
		 VALUES ($1,$2,'OPENING_BALANCE',$3,$4,$5) RETURNING id`,
		tenantID, asOf, req.StudentID, "Opening arrears", userID).Scan(&entryID)
	if err != nil {
		return "", err
	}
	// Debit receivable, credit opening balance equity
	_, err = q.ExecContext(ctx,
		`INSERT INTO journal_lines (tenant_id, entry_id, account_id, student_id, debit, credit)
		 VALUES ($1,$2,(SELECT id FROM chart_of_accounts WHERE tenant_id=$1 AND code='1100' LIMIT 1),$3,$4,0)`,
		tenantID, entryID, req.StudentID, req.Amount)
	if err != nil {
		return "", err
	}
	_, err = q.ExecContext(ctx,
		`INSERT INTO journal_lines (tenant_id, entry_id, account_id, student_id, debit, credit)
		 VALUES ($1,$2,(SELECT id FROM chart_of_accounts WHERE tenant_id=$1 AND code='3900' LIMIT 1),$3,0,$4)`,
		tenantID, entryID, req.StudentID, req.Amount)
	if err != nil {
		return "", err
	}
	return entryID, nil
}

type OpeningStockRequest struct {
	InventoryItemID string  `json:"inventory_item_id" binding:"required"`
	Quantity        float64 `json:"quantity" binding:"required"`
	UnitCost        float64 `json:"unit_cost" binding:"required"`
	AsOfDate        string  `json:"as_of_date" binding:"required"`
}

func (s *Service) PostOpeningStock(ctx context.Context, tenantID, userID string, req OpeningStockRequest) (string, error) {
	q := s.q(ctx)
	asOf, err := time.Parse("2006-01-02", req.AsOfDate)
	if err != nil {
		return "", err
	}
	var entryID string
	err = q.QueryRowContext(ctx,
		`INSERT INTO journal_entries (tenant_id, entry_date, source_type, source_id, memo, created_by)
		 VALUES ($1,$2,'OPENING_STOCK',$3,$4,$5) RETURNING id`,
		tenantID, asOf, req.InventoryItemID, "Opening stock", userID).Scan(&entryID)
	if err != nil {
		return "", err
	}
	total := req.Quantity * req.UnitCost
	_, err = q.ExecContext(ctx,
		`INSERT INTO journal_lines (tenant_id, entry_id, account_id, debit, credit)
		 VALUES ($1,$2,(SELECT id FROM chart_of_accounts WHERE tenant_id=$1 AND code='1200' LIMIT 1),$3,0)`,
		tenantID, entryID, total)
	if err != nil {
		return "", err
	}
	_, err = q.ExecContext(ctx,
		`INSERT INTO journal_lines (tenant_id, entry_id, account_id, debit, credit)
		 VALUES ($1,$2,(SELECT id FROM chart_of_accounts WHERE tenant_id=$1 AND code='3900' LIMIT 1),0,$3)`,
		tenantID, entryID, total)
	if err != nil {
		return "", err
	}
	// Create inventory lot
	_, err = q.ExecContext(ctx,
		`INSERT INTO inventory_lots (tenant_id, inventory_item_id, qty_remaining, unit_cost, source_type, source_id)
		 VALUES ($1,$2,$3,$4,'OPENING',$5)`,
		tenantID, req.InventoryItemID, req.Quantity, req.UnitCost, entryID)
	if err != nil {
		return "", err
	}
	return entryID, nil
}

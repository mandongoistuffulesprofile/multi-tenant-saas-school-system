package valueledger

import (
	"context"
	"database/sql"

	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
)

type Service struct {
	db *db.DB
}

func NewService(db *db.DB) *Service { return &Service{db: db} }

func (s *Service) q(ctx context.Context) interface {
	QueryRowContext(context.Context, string, ...interface{}) *sql.Row
} {
	if tx, ok := ctx.Value("tx").(*sql.Tx); ok {
		return tx
	}
	return s.db.DB
}

type ValueMetrics struct {
	TotalRevenue      float64 `json:"total_revenue"`
	TotalExpenses     float64 `json:"total_expenses"`
	NetPosition       float64 `json:"net_position"`
	OutstandingFees   float64 `json:"outstanding_fees"`
	InventoryValue    float64 `json:"inventory_value"`
	StudentCount      int     `json:"student_count"`
}

func (s *Service) Compute(ctx context.Context, tenantID string) (*ValueMetrics, error) {
	q := s.q(ctx)
	m := &ValueMetrics{}
	_ = q.QueryRowContext(ctx, `SELECT COALESCE(SUM(credit),0) FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id WHERE jl.tenant_id=$1 AND je.entry_date <= CURRENT_DATE`, tenantID).Scan(&m.TotalRevenue)
	_ = q.QueryRowContext(ctx, `SELECT COALESCE(SUM(debit),0) FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id WHERE jl.tenant_id=$1 AND je.entry_date <= CURRENT_DATE`, tenantID).Scan(&m.TotalExpenses)
	m.NetPosition = m.TotalRevenue - m.TotalExpenses
	_ = q.QueryRowContext(ctx, `SELECT COALESCE(SUM(amount),0) FROM fee_invoices WHERE tenant_id=$1 AND status IN ('UNPAID','PARTIAL')`, tenantID).Scan(&m.OutstandingFees)
	_ = q.QueryRowContext(ctx, `SELECT COALESCE(SUM(qty_remaining*unit_cost),0) FROM inventory_lots WHERE tenant_id=$1`, tenantID).Scan(&m.InventoryValue)
	_ = q.QueryRowContext(ctx, `SELECT COUNT(*) FROM students WHERE tenant_id=$1`, tenantID).Scan(&m.StudentCount)
	return m, nil
}

package valueledger

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
)

type Service struct {
	db *db.DB
}

func NewService(db *db.DB) *Service { return &Service{db: db} }

// queryer is satisfied by both *sqlx.Tx (inside the tenant transaction) and
// *sql.DB. Compute is always handed the tenant transaction: looking the
// transaction up on the request context never found it, because middleware
// stores it on the gin context, so every query fell through to a connection
// with no tenant set and row-level security returned nothing.
type queryer interface {
	QueryRowContext(context.Context, string, ...interface{}) *sql.Row
}

type ValueMetrics struct {
	TotalRevenue    float64 `json:"total_revenue"`
	TotalExpenses   float64 `json:"total_expenses"`
	NetPosition     float64 `json:"net_position"`
	OutstandingFees float64 `json:"outstanding_fees"`
	InventoryValue  float64 `json:"inventory_value"`
	StudentCount    int     `json:"student_count"`
}

func (s *Service) Compute(ctx context.Context, q queryer, tenantID string) (*ValueMetrics, error) {
	m := &ValueMetrics{}
	// Errors are returned, not discarded: a subscription screen that silently
	// reports zeros is worse than one that reports a failure.
	if err := q.QueryRowContext(ctx, `SELECT COALESCE(SUM(credit),0) FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id WHERE jl.tenant_id=$1 AND je.entry_date <= CURRENT_DATE`, tenantID).Scan(&m.TotalRevenue); err != nil {
		return nil, fmt.Errorf("value ledger revenue: %w", err)
	}
	if err := q.QueryRowContext(ctx, `SELECT COALESCE(SUM(debit),0) FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id WHERE jl.tenant_id=$1 AND je.entry_date <= CURRENT_DATE`, tenantID).Scan(&m.TotalExpenses); err != nil {
		return nil, fmt.Errorf("value ledger expenses: %w", err)
	}
	m.NetPosition = m.TotalRevenue - m.TotalExpenses
	// fee_invoices and students never existed; the live tables are invoices and
	// learners, and open money is amount_outstanding on unpaid lifecycle states.
	if err := q.QueryRowContext(ctx, `SELECT COALESCE(SUM(amount_outstanding),0) FROM invoices WHERE tenant_id=$1 AND status IN ('ISSUED','PARTIALLY_PAID','OVERDUE')`, tenantID).Scan(&m.OutstandingFees); err != nil {
		return nil, fmt.Errorf("value ledger outstanding fees: %w", err)
	}
	if err := q.QueryRowContext(ctx, `SELECT COALESCE(SUM(qty_remaining*unit_cost),0) FROM inventory_lots WHERE tenant_id=$1`, tenantID).Scan(&m.InventoryValue); err != nil {
		return nil, fmt.Errorf("value ledger inventory: %w", err)
	}
	if err := q.QueryRowContext(ctx, `SELECT COUNT(*) FROM learners WHERE tenant_id=$1 AND status = 'ACTIVE'`, tenantID).Scan(&m.StudentCount); err != nil {
		return nil, fmt.Errorf("value ledger learners: %w", err)
	}
	return m, nil
}

package valueledger

import (
	"context"
	"database/sql"

	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
)

type Service struct {
	db *db.DB
}

func NewService(database *db.DB) *Service { return &Service{db: database} }

type queryer interface {
	QueryRowContext(ctx context.Context, query string, args ...interface{}) *sql.Row
}

// q returns the request transaction when there is one. It used to look for a
// *sql.Tx under a plain string context key that nothing ever set, so every
// figure was computed on a pool connection with no tenant context: RLS hid every
// row and the dashboard reported zero for a school full of activity.
func (s *Service) q(ctx context.Context) queryer {
	if tx := middleware.TxFromContext(ctx); tx != nil {
		return tx
	}
	return s.db.DB
}

type ValueMetrics struct {
	TotalRevenue    float64 `json:"total_revenue"`
	TotalExpenses   float64 `json:"total_expenses"`
	NetPosition     float64 `json:"net_position"`
	OutstandingFees float64 `json:"outstanding_fees"`
	InventoryValue  float64 `json:"inventory_value"`
	StudentCount    int     `json:"student_count"`
}

// Compute reads the school's value position from the ledger and the fee desk.
//
// Revenue and expenses come from the account type, not from the whole journal:
// every double-entry transaction has equal debits and credits, so summing them
// as "revenue" and "expenses" made the net position always zero. Errors are
// returned rather than discarded — a query against a table that does not exist
// used to look exactly like a school with no money.
func (s *Service) Compute(ctx context.Context, tenantID string) (*ValueMetrics, error) {
	q := s.q(ctx)
	m := &ValueMetrics{}

	if err := q.QueryRowContext(ctx,
		`SELECT COALESCE(SUM(jl.credit - jl.debit), 0)::float8
		   FROM journal_lines jl
		   JOIN journal_entries je ON je.id = jl.entry_id AND je.tenant_id = jl.tenant_id
		   JOIN ledger_accounts la ON la.id = jl.account_id AND la.tenant_id = jl.tenant_id
		  WHERE jl.tenant_id = $1 AND la.type = 'INCOME' AND je.entry_date <= CURRENT_DATE`,
		tenantID).Scan(&m.TotalRevenue); err != nil {
		return nil, err
	}
	if err := q.QueryRowContext(ctx,
		`SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::float8
		   FROM journal_lines jl
		   JOIN journal_entries je ON je.id = jl.entry_id AND je.tenant_id = jl.tenant_id
		   JOIN ledger_accounts la ON la.id = jl.account_id AND la.tenant_id = jl.tenant_id
		  WHERE jl.tenant_id = $1 AND la.type = 'EXPENSE' AND je.entry_date <= CURRENT_DATE`,
		tenantID).Scan(&m.TotalExpenses); err != nil {
		return nil, err
	}
	m.NetPosition = m.TotalRevenue - m.TotalExpenses

	if err := q.QueryRowContext(ctx,
		`SELECT COALESCE(SUM(amount_outstanding), 0)::float8
		   FROM invoices WHERE tenant_id = $1 AND amount_outstanding > 0`,
		tenantID).Scan(&m.OutstandingFees); err != nil {
		return nil, err
	}
	if err := q.QueryRowContext(ctx,
		`SELECT COALESCE(SUM(qty_remaining * unit_cost), 0)::float8
		   FROM inventory_lots WHERE tenant_id = $1`,
		tenantID).Scan(&m.InventoryValue); err != nil {
		return nil, err
	}
	if err := q.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM learners WHERE tenant_id = $1`,
		tenantID).Scan(&m.StudentCount); err != nil {
		return nil, err
	}
	return m, nil
}

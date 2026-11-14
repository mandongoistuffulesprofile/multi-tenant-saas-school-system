package valueledger

import (
	"context"
	"database/sql"
	"fmt"
	"time"

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
	QueryContext(context.Context, string, ...interface{}) (*sql.Rows, error)
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

// TrendPoint is one calendar month of posted ledger activity. Months with no
// entries are returned as zeroes so the chart has an unbroken timeline.
type TrendPoint struct {
	Period   string  `json:"period"` // YYYY-MM
	Revenue  float64 `json:"revenue"`
	Expenses float64 `json:"expenses"`
	Net      float64 `json:"net"`
}

// Trend returns revenue, expenses and surplus per month for the last `months`
// months, oldest first. It is the same definition of revenue and expenses as
// Compute, just grouped by month.
func (s *Service) Trend(ctx context.Context, q queryer, tenantID string, months int) ([]TrendPoint, error) {
	if months <= 0 {
		months = 12
	}
	if months > 36 {
		months = 36
	}

	rows, err := q.QueryContext(ctx, `
		SELECT to_char(date_trunc('month', je.entry_date), 'YYYY-MM') AS period,
		       COALESCE(SUM(jl.credit), 0) AS revenue,
		       COALESCE(SUM(jl.debit), 0) AS expenses
		FROM journal_lines jl
		JOIN journal_entries je ON je.id = jl.entry_id
		WHERE jl.tenant_id = $1
		  AND je.entry_date <= CURRENT_DATE
		  AND je.entry_date >= date_trunc('month', CURRENT_DATE) - make_interval(months => $2::int - 1)
		GROUP BY 1
		ORDER BY 1`, tenantID, months)
	if err != nil {
		return nil, fmt.Errorf("value ledger trend: %w", err)
	}
	defer rows.Close()

	byPeriod := map[string]TrendPoint{}
	for rows.Next() {
		var p TrendPoint
		if err := rows.Scan(&p.Period, &p.Revenue, &p.Expenses); err != nil {
			return nil, fmt.Errorf("value ledger trend scan: %w", err)
		}
		p.Net = p.Revenue - p.Expenses
		byPeriod[p.Period] = p
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("value ledger trend rows: %w", err)
	}

	// Fill the months with no activity: a chart that skips empty months lies
	// about the shape of the year.
	now := time.Now().UTC()
	points := make([]TrendPoint, 0, months)
	for i := months - 1; i >= 0; i-- {
		key := now.AddDate(0, -i, 0).Format("2006-01")
		if p, ok := byPeriod[key]; ok {
			points = append(points, p)
		} else {
			points = append(points, TrendPoint{Period: key})
		}
	}
	return points, nil
}

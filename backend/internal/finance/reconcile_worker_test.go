package finance_test

import (
	"context"
	"log/slog"
	"testing"

	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/finance"
)

// TestReconcileWorkerReachesEveryTenant is the check the nightly job lives or
// dies by: it must find tenants on its own. A worker that enumerates zero
// tenants reports "no discrepancies" forever and is worse than no worker at
// all, because it looks like proof.
func TestReconcileWorkerReachesEveryTenant(t *testing.T) {
	database := connectTestDB(t)
	s := seedTenant(t, database)
	ctx := context.Background()

	// Make this tenant's data genuinely wrong: the invoice claims 100 less than
	// its lines do, which is exactly the LINE_MISMATCH the view classifies.
	if err := database.WithTenant(ctx, s.tenantID, "", func(tx *db.Tx) error {
		_, err := tx.Exec(`UPDATE invoices SET amount_outstanding = amount_outstanding - 100 WHERE invoice_id = $1::uuid`, s.invoiceID)
		return err
	}); err != nil {
		t.Fatalf("corrupt invoice: %v", err)
	}

	worker := finance.NewReconcileWorker(database.DB.DB, slog.Default())
	count, err := worker.RunOnce(ctx)
	if err != nil {
		t.Fatalf("reconcile run: %v", err)
	}
	if count == 0 {
		t.Fatal("the worker reconciled no tenants: it cannot enumerate schools, so it reports success while checking nothing")
	}

	var findings int
	var detail string
	if err := database.WithTenant(ctx, s.tenantID, "", func(tx *db.Tx) error {
		if err := tx.QueryRow(`SELECT count(*) FROM allocation_reconciliation_findings
			WHERE tenant_id = $1 AND kind = 'LINE_MISMATCH' AND subject_id = $2::uuid`,
			s.tenantID, s.invoiceID).Scan(&findings); err != nil {
			return err
		}
		return tx.QueryRow(`SELECT detail FROM allocation_reconciliation_findings
			WHERE tenant_id = $1 AND kind = 'LINE_MISMATCH' AND subject_id = $2::uuid
			ORDER BY detected_at DESC LIMIT 1`, s.tenantID, s.invoiceID).Scan(&detail)
	}); err != nil {
		t.Fatalf("read findings: %v", err)
	}
	if findings == 0 {
		t.Fatal("the worker ran but recorded no finding for the corrupted invoice")
	}
	if detail == "" {
		t.Fatal("finding has no detail for the bursar to read")
	}
}

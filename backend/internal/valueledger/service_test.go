package valueledger_test

import (
	"context"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/valueledger"
)

// TestComputeReadsTheLiveTables guards the two ways this endpoint used to lie:
// it queried tables that never existed (fee_invoices, students) and it looked
// for the tenant transaction on the request context, which middleware never
// puts there. Either fault alone made every figure zero for every school.
func TestComputeReadsTheLiveTables(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	database, err := db.Connect(url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer database.Close()

	ctx := context.Background()
	suffix := strconv.FormatInt(time.Now().UnixNano(), 10)
	tenantID := "vl-" + suffix

	err = database.WithTenant(ctx, tenantID, "", func(tx *db.Tx) error {
		if _, err := tx.Exec(`INSERT INTO schools (tenant_id, school_name, subdomain) VALUES ($1,$2,$3)`,
			tenantID, "Value Ledger School", tenantID); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO learners (tenant_id, admission_number, first_name, last_name, status)
			VALUES ($1,$2,'Active','Learner','ACTIVE'), ($1,$3,'Left','Learner','INACTIVE')`,
			tenantID, "A-"+suffix, "I-"+suffix); err != nil {
			return err
		}
		var yearID string
		if err := tx.QueryRow(`INSERT INTO academic_years (tenant_id, year_label, start_date, end_date, is_current)
			VALUES ($1,'2026','2026-01-01','2026-12-31',true) RETURNING year_id`, tenantID).Scan(&yearID); err != nil {
			return err
		}
		// One open invoice and one fully settled invoice: only the open 5000
		// counts as outstanding money.
		_, err := tx.Exec(`INSERT INTO invoices (tenant_id, invoice_number, learner_id, academic_year_id, status, total_amount, amount_paid, amount_outstanding, issue_date)
			SELECT $1, 'VL-1-'||$2, learner_id, $3::uuid, 'ISSUED', 5000, 0, 5000, CURRENT_DATE FROM learners WHERE tenant_id=$1 AND status='ACTIVE'
			UNION ALL
			SELECT $1, 'VL-2-'||$2, learner_id, $3::uuid, 'PAID', 700, 700, 0, CURRENT_DATE FROM learners WHERE tenant_id=$1 AND status='ACTIVE'`,
			tenantID, suffix, yearID)
		return err
	})
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	var metrics *valueledger.ValueMetrics
	err = database.WithTenant(ctx, tenantID, "", func(tx *db.Tx) error {
		var err error
		metrics, err = valueledger.NewService(database).Compute(ctx, tx, tenantID)
		return err
	})
	if err != nil {
		t.Fatalf("compute: %v", err)
	}
	if metrics.OutstandingFees != 5000 {
		t.Fatalf("outstanding fees = %v, want 5000 (paid invoice must not count)", metrics.OutstandingFees)
	}
	if metrics.StudentCount != 1 {
		t.Fatalf("learners = %d, want 1 (inactive learner must not count)", metrics.StudentCount)
	}
}

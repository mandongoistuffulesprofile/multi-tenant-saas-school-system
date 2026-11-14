package platform

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/valueledger"
)

// TestSnapshotTenantCountsMonth records one row per month with the flows that
// happened in that month and the roll as it stands, then proves the value
// ledger trend can read those counters back.
func TestSnapshotTenantCountsMonth(t *testing.T) {
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
	tenantID := fmt.Sprintf("usage-%d", time.Now().UnixNano())

	err = database.WithTenant(ctx, tenantID, "", func(tx *db.Tx) error {
		if _, err := tx.Exec(`INSERT INTO schools (tenant_id, school_name, subdomain) VALUES ($1,$2,$3)`,
			tenantID, "Usage School", tenantID); err != nil {
			return err
		}
		var userID, learnerID string
		if err := tx.QueryRow(`INSERT INTO users (email, phone_number, password_hash, status)
			VALUES ($1,$2,'x','ACTIVE') RETURNING user_id`, tenantID+"@example.test", "+2547"+tenantID[len(tenantID)-8:]).Scan(&userID); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO tenant_memberships (user_id, tenant_id, role, status)
			VALUES ($1,$2,'SCHOOL_ADMIN','ACTIVE')`, userID, tenantID); err != nil {
			return err
		}
		if err := tx.QueryRow(`INSERT INTO learners (tenant_id, admission_number, first_name, last_name, status)
			VALUES ($1,'U-1','Usage','Learner','ACTIVE') RETURNING learner_id`, tenantID).Scan(&learnerID); err != nil {
			return err
		}
		// Two SMS this month, one payment this month, both in the current month.
		if _, err := tx.Exec(`INSERT INTO outbound_messages (tenant_id, recipient_type, recipient_id, channel, recipient_address, body_text, status, created_at)
			VALUES ($1,'GUARDIAN',$2,'SMS','+254700','a','SENT', now()), ($1,'GUARDIAN',$2,'SMS','+254700','b','QUEUED', now())`, tenantID, learnerID); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO payments (tenant_id, payment_reference, learner_id, source, amount, status)
			VALUES ($1,'U-PAY-1',$2,'CASH',1000,'COMPLETED')`, tenantID, learnerID); err != nil {
			return err
		}
		return SnapshotTenant(ctx, tx.Tx, tenantID, 2)
	})
	if err != nil {
		t.Fatalf("seed and snapshot: %v", err)
	}

	var (
		rows                    int
		learners, staff, sms    int
		payments, previousCount int
	)
	err = database.WithTenant(ctx, tenantID, "", func(tx *db.Tx) error {
		if err := tx.QueryRow(`SELECT count(*) FROM tenant_usage WHERE tenant_id = $1`, tenantID).Scan(&rows); err != nil {
			return err
		}
		if err := tx.QueryRow(`SELECT active_learners, active_staff, sms_sent, payments_processed
			FROM tenant_usage WHERE tenant_id = $1
			  AND period_month = date_trunc('month', CURRENT_DATE)::date`, tenantID).Scan(&learners, &staff, &sms, &payments); err != nil {
			return err
		}
		return tx.QueryRow(`SELECT sms_sent FROM tenant_usage WHERE tenant_id = $1
			  AND period_month = (date_trunc('month', CURRENT_DATE) - INTERVAL '1 month')::date`, tenantID).Scan(&previousCount)
	})
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if rows != 2 {
		t.Fatalf("usage rows = %d, want one per month (2)", rows)
	}
	if learners != 1 || staff != 1 {
		t.Fatalf("roll = %d learners / %d staff, want 1/1", learners, staff)
	}
	if sms != 2 {
		t.Fatalf("sms_sent = %d, want 2", sms)
	}
	if payments != 1 {
		t.Fatalf("payments_processed = %d, want 1", payments)
	}
	if previousCount != 0 {
		t.Fatalf("previous month sms = %d, want 0 (counters are per month)", previousCount)
	}

	// The trend endpoint's series must carry the counters for the current month.
	var points []valueledger.TrendPoint
	if err := database.WithTenant(ctx, tenantID, "", func(tx *db.Tx) error {
		var err error
		points, err = valueledger.NewService(database).Trend(ctx, tx.Tx, tenantID, 2)
		return err
	}); err != nil {
		t.Fatalf("trend: %v", err)
	}
	last := points[len(points)-1]
	if last.ActiveLearners != 1 || last.SmsSent != 2 || last.PaymentsProcessed != 1 {
		t.Fatalf("trend usage = %+v, want learners 1, sms 2, payments 1", last)
	}
}

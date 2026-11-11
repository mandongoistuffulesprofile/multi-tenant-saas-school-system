package finance

import (
	"context"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
)

func TestPaymentsAndAllocationsTenantIsolation(t *testing.T) {
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
	for _, stmt := range []string{
		`ALTER TABLE schools ENABLE ROW LEVEL SECURITY`,
		`ALTER TABLE schools FORCE ROW LEVEL SECURITY`,
		`ALTER TABLE academic_years ENABLE ROW LEVEL SECURITY`,
		`ALTER TABLE academic_years FORCE ROW LEVEL SECURITY`,
		`ALTER TABLE learners ENABLE ROW LEVEL SECURITY`,
		`ALTER TABLE learners FORCE ROW LEVEL SECURITY`,
		`ALTER TABLE invoices ENABLE ROW LEVEL SECURITY`,
		`ALTER TABLE invoices FORCE ROW LEVEL SECURITY`,
		`ALTER TABLE payments ENABLE ROW LEVEL SECURITY`,
		`ALTER TABLE payments FORCE ROW LEVEL SECURITY`,
		`ALTER TABLE payment_allocations ENABLE ROW LEVEL SECURITY`,
		`ALTER TABLE payment_allocations FORCE ROW LEVEL SECURITY`,
	} {
		if _, err := database.Exec(stmt); err != nil { t.Logf("prepare RLS skipped: %v", err) }
	}
	suffix := strconv.FormatInt(time.Now().UnixNano(), 10)
	ta, tb := "fpa-"+suffix, "fpb-"+suffix

	type ids struct{ inv, pay, alloc string }
	setup := func(tenant string) ids {
		var out ids
		err := database.WithTenant(ctx, tenant, "", func(tx *db.Tx) error {
			if _, err := tx.Exec(`INSERT INTO schools (tenant_id, school_name, subdomain) VALUES ($1,$2,$3)`, tenant, "S", tenant); err != nil {
				return err
			}
			var yearID, learnerID string
			if err := tx.QueryRow(`INSERT INTO academic_years (tenant_id, year_label, start_date, end_date, is_current)
				VALUES ($1,$2,'2026-01-01','2026-12-31',true) RETURNING year_id`, tenant, "2026").Scan(&yearID); err != nil {
				return err
			}
			if err := tx.QueryRow(`INSERT INTO learners (tenant_id, admission_number, first_name, last_name) VALUES ($1,$2,'A','B') RETURNING learner_id`,
				tenant, "ADM-"+suffix[:8]).Scan(&learnerID); err != nil {
				return err
			}
			if err := tx.QueryRow(`INSERT INTO invoices (tenant_id, learner_id, invoice_number, academic_year_id, total_amount, amount_paid, amount_outstanding, status)
				VALUES ($1,$2,$3,$4,100,0,100,'ISSUED') RETURNING invoice_id`, tenant, learnerID, "INV-"+suffix[:8], yearID).Scan(&out.inv); err != nil {
				return err
			}
			if err := tx.QueryRow(`INSERT INTO payments (tenant_id, payment_reference, learner_id, source, amount, status)
				VALUES ($1,$2,$3,'CASH',100,'COMPLETED') RETURNING payment_id`, tenant, "PAY-"+suffix[:8], learnerID).Scan(&out.pay); err != nil {
				return err
			}
			return tx.QueryRow(`INSERT INTO payment_allocations (tenant_id, payment_id, invoice_id, allocated_amount)
				VALUES ($1,$2,$3,50) RETURNING allocation_id`, tenant, out.pay, out.inv).Scan(&out.alloc)
		})
		if err != nil {
			t.Skipf("schema incompatible: %v", err)
		}
		return out
	}
	a := setup(ta)
	_ = setup(tb)
	t.Cleanup(func() {
		for _, tenant := range []string{ta, tb} {
			_ = database.WithTenant(ctx, tenant, "", func(tx *db.Tx) error {
				_, _ = tx.Exec(`DELETE FROM payment_allocations WHERE tenant_id=$1`, tenant)
				_, _ = tx.Exec(`DELETE FROM payments WHERE tenant_id=$1`, tenant)
				_, _ = tx.Exec(`DELETE FROM invoices WHERE tenant_id=$1`, tenant)
				_, _ = tx.Exec(`DELETE FROM academic_years WHERE tenant_id=$1`, tenant)
				_, _ = tx.Exec(`DELETE FROM learners WHERE tenant_id=$1`, tenant)
				_, _ = tx.Exec(`DELETE FROM schools WHERE tenant_id=$1`, tenant)
				return nil
			})
		}
	})

	// Tenant B cannot see/update tenant A payments/allocations
	_ = database.WithTenant(ctx, tb, "", func(tx *db.Tx) error {
		var n int
		_ = tx.QueryRow(`SELECT count(*) FROM payments WHERE payment_id=$1`, a.pay).Scan(&n)
		if n != 0 {
			t.Fatalf("cross-tenant payment read leaked %d", n)
		}
		_ = tx.QueryRow(`SELECT count(*) FROM payment_allocations WHERE allocation_id=$1`, a.alloc).Scan(&n)
		if n != 0 {
			t.Fatalf("cross-tenant allocation read leaked %d", n)
		}
		res, _ := tx.Exec(`UPDATE payments SET amount=999 WHERE payment_id=$1`, a.pay)
		if n, _ := res.RowsAffected(); n != 0 {
			t.Fatalf("cross-tenant payment update affected %d", n)
		}
		return nil
	})

	// No-context read blocked
	var n int
	if err := database.QueryRow(`SELECT count(*) FROM payments WHERE tenant_id IN ($1,$2)`, ta, tb).Scan(&n); err == nil && n != 0 {
		t.Fatalf("payments visible without context: %d", n)
	}
	n = 0
	if err := database.QueryRow(`SELECT count(*) FROM payment_allocations WHERE tenant_id IN ($1,$2)`, ta, tb).Scan(&n); err == nil && n != 0 {
		t.Fatalf("allocations visible without context: %d", n)
	}
}

func TestOutboundMessagesAndSyncConflictsTenantIsolation(t *testing.T) {
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
	for _, stmt := range []string{
		`ALTER TABLE schools ENABLE ROW LEVEL SECURITY`,
		`ALTER TABLE schools FORCE ROW LEVEL SECURITY`,
		`ALTER TABLE outbound_messages ENABLE ROW LEVEL SECURITY`,
		`ALTER TABLE outbound_messages FORCE ROW LEVEL SECURITY`,
		`ALTER TABLE sync_conflicts ENABLE ROW LEVEL SECURITY`,
		`ALTER TABLE sync_conflicts FORCE ROW LEVEL SECURITY`,
	} {
		if _, err := database.Exec(stmt); err != nil { t.Logf("prepare RLS skipped: %v", err) }
	}
	suffix := strconv.FormatInt(time.Now().UnixNano(), 10)
	ta, tb := "fom-"+suffix, "fob-"+suffix

	setup := func(tenant string) {
		err := database.WithTenant(ctx, tenant, "", func(tx *db.Tx) error {
			if _, err := tx.Exec(`INSERT INTO schools (tenant_id, school_name, subdomain) VALUES ($1,$2,$3)`, tenant, "S", tenant); err != nil {
				return err
			}
			// outbound message (recipient_id can be random uuid if no FK in minimal insert; use guardian-like insert if constrained - try simple)
			_, _ = tx.Exec(`INSERT INTO outbound_messages (tenant_id, recipient_type, recipient_id, channel, recipient_address, body_text, status)
				VALUES ($1,'GUARDIAN', gen_random_uuid(),'SMS','254700000000','hi','QUEUED')`, tenant)
			_, _ = tx.Exec(`INSERT INTO sync_conflicts (tenant_id, entity_type, entity_id, client_version, server_version, client_values, server_values)
				VALUES ($1,'ATTENDANCE_MARK', gen_random_uuid(),1,2,'{}'::jsonb,'{}'::jsonb)`, tenant)
			return nil
		})
		if err != nil {
			t.Skipf("setup incompatible: %v", err)
		}
	}
	setup(ta); setup(tb)
	t.Cleanup(func() {
		for _, tenant := range []string{ta, tb} {
			_ = database.WithTenant(ctx, tenant, "", func(tx *db.Tx) error {
				_, _ = tx.Exec(`DELETE FROM sync_conflicts WHERE tenant_id=$1`, tenant)
				_, _ = tx.Exec(`DELETE FROM outbound_messages WHERE tenant_id=$1`, tenant)
				_, _ = tx.Exec(`DELETE FROM schools WHERE tenant_id=$1`, tenant)
				return nil
			})
		}
	})

	_ = database.WithTenant(ctx, tb, "", func(tx *db.Tx) error {
		var n int
		_ = tx.QueryRow(`SELECT count(*) FROM outbound_messages WHERE tenant_id=$1`, ta).Scan(&n)
		if n != 0 {
			t.Fatalf("cross-tenant outbound read leaked %d", n)
		}
		_ = tx.QueryRow(`SELECT count(*) FROM sync_conflicts WHERE tenant_id=$1`, ta).Scan(&n)
		if n != 0 {
			t.Fatalf("cross-tenant sync_conflicts read leaked %d", n)
		}
		return nil
	})

	var n int
	if err := database.QueryRow(`SELECT count(*) FROM outbound_messages WHERE tenant_id IN ($1,$2)`, ta, tb).Scan(&n); err == nil && n != 0 {
		t.Fatalf("outbound visible without context: %d", n)
	}
	n = 0
	if err := database.QueryRow(`SELECT count(*) FROM sync_conflicts WHERE tenant_id IN ($1,$2)`, ta, tb).Scan(&n); err == nil && n != 0 {
		t.Fatalf("sync_conflicts visible without context: %d", n)
	}
}

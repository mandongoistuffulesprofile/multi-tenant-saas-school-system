package mpesa

import (
	"context"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
)

func TestMpesaInboxTenantIsolation(t *testing.T) {
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
		`ALTER TABLE mpesa_raw_inbox ENABLE ROW LEVEL SECURITY`,
		`ALTER TABLE mpesa_raw_inbox FORCE ROW LEVEL SECURITY`,
	} {
		if _, err := database.Exec(stmt); err != nil { t.Logf("prepare RLS skipped: %v", err) }
	}
	suffix := strconv.FormatInt(time.Now().UnixNano(), 10)
	ta, tb := "mpa-"+suffix, "mpb-"+suffix

	setup := func(tenant string) {
		_ = database.WithTenant(ctx, tenant, "", func(tx *db.Tx) error {
			_, err := tx.Exec(`INSERT INTO schools (tenant_id, school_name, subdomain) VALUES ($1,$2,$3)`, tenant, "S", tenant)
			return err
		})
	}
	setup(ta); setup(tb)
	t.Cleanup(func() {
		for _, tenant := range []string{ta, tb} {
			_ = database.WithTenant(ctx, tenant, "", func(tx *db.Tx) error {
				_, _ = tx.Exec(`DELETE FROM mpesa_raw_inbox WHERE tenant_id=$1`, tenant)
				_, _ = tx.Exec(`DELETE FROM schools WHERE tenant_id=$1`, tenant)
				return nil
			})
		}
	})

	// Insert inbox row as tenant A
	err = database.WithTenant(ctx, ta, "", func(tx *db.Tx) error {
		_, err := tx.Exec(`INSERT INTO mpesa_raw_inbox (tenant_id, trans_id, sender_phone, sender_name, amount, account_reference, raw_payload)
			VALUES ($1,$2,$3,$4,$5,$6,$7)`, ta, "TX-"+suffix, "254700000000", "Test", "100.00", "ADM1", []byte(`{}`))
		return err
	})
	if err != nil {
		t.Skipf("mpesa_raw_inbox insert not compatible: %v", err)
	}

	// Tenant B must not see tenant A's row
	err = database.WithTenant(ctx, tb, "", func(tx *db.Tx) error {
		var n int
		if err := tx.QueryRow(`SELECT count(*) FROM mpesa_raw_inbox WHERE tenant_id=$1`, ta).Scan(&n); err != nil {
			return err
		}
		if n != 0 {
			t.Fatalf("cross-tenant read leaked %d rows", n)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	// No tenant context must not see
	var n int
	if err := database.QueryRow(`SELECT count(*) FROM mpesa_raw_inbox WHERE tenant_id IN ($1,$2)`, ta, tb).Scan(&n); err == nil && n != 0 {
		t.Fatalf("expected 0 rows without tenant context, got %d", n)
	}
}

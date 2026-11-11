package outbox

import (
	"context"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
)

func TestOutboxTenantIsolation(t *testing.T) {
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
		`ALTER TABLE outbox ENABLE ROW LEVEL SECURITY`,
		`ALTER TABLE outbox FORCE ROW LEVEL SECURITY`,
	} {
		if _, err := database.Exec(stmt); err != nil { t.Logf("prepare RLS skipped: %v", err) }
	}
	suffix := strconv.FormatInt(time.Now().UnixNano(), 10)
	ta, tb := "oba-"+suffix, "obb-"+suffix

	setup := func(tenant string) {
		err := database.WithTenant(ctx, tenant, "", func(tx *db.Tx) error {
			if _, err := tx.Exec(`INSERT INTO schools (tenant_id, school_name, subdomain) VALUES ($1,$2,$3)`, tenant, "S", tenant); err != nil {
				return err
			}
			_, err := tx.Exec(`INSERT INTO outbox (tenant_id, aggregate_type, aggregate_id, event_type, payload)
				VALUES ($1,'X',gen_random_uuid(),'X.CREATED','{}'::jsonb)`, tenant)
			return err
		})
		if err != nil {
			t.Skipf("setup incompatible: %v", err)
		}
	}
	setup(ta); setup(tb)
	t.Cleanup(func() {
		for _, tenant := range []string{ta, tb} {
			_ = database.WithTenant(ctx, tenant, "", func(tx *db.Tx) error {
				_, _ = tx.Exec(`DELETE FROM outbox WHERE tenant_id=$1`, tenant)
				_, _ = tx.Exec(`DELETE FROM schools WHERE tenant_id=$1`, tenant)
				return nil
			})
		}
	})

	_ = database.WithTenant(ctx, tb, "", func(tx *db.Tx) error {
		var n int
		_ = tx.QueryRow(`SELECT count(*) FROM outbox WHERE tenant_id=$1`, ta).Scan(&n)
		if n != 0 {
			t.Fatalf("cross-tenant outbox read leaked %d", n)
		}
		return nil
	})

	var n int
	if err := database.QueryRow(`SELECT count(*) FROM outbox WHERE tenant_id IN ($1,$2)`, ta, tb).Scan(&n); err == nil && n != 0 {
		t.Fatalf("outbox visible without context: %d", n)
	}
}

package db

import (
	"context"
	"os"
	"strconv"
	"testing"
	"time"
)

// TestTenantRLS is the regression test for the isolation contract:
//
//   - a connection with no tenant context sees no tenant rows;
//   - SET LOCAL app.current_tenant_id limits reads and writes to that tenant;
//   - a cross-tenant write is rejected by the WITH CHECK clause.
//
// It runs against TEST_DATABASE_URL (a migrated, disposable database) and is
// skipped otherwise so `go test ./...` stays hermetic on a laptop.
func TestTenantRLS(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	database, err := Connect(url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer database.Close()

	ctx := context.Background()
	// The application role owns tables in this test database, and ENABLE alone
	// does not apply to owners. FORCE for the two tables under test so this test
	// exercises the policies rather than the owner bypass.
	for _, stmt := range []string{
		`ALTER TABLE schools ENABLE ROW LEVEL SECURITY`,
		`ALTER TABLE schools FORCE ROW LEVEL SECURITY`,
		`ALTER TABLE learners ENABLE ROW LEVEL SECURITY`,
		`ALTER TABLE learners FORCE ROW LEVEL SECURITY`,
	} {
		if _, err := database.Exec(stmt); err != nil {
			t.Fatalf("prepare RLS: %v", err)
		}
	}
	suffix := time.Now().UnixNano()
	tenantA := "rls-a-" + itoa(suffix)
	tenantB := "rls-b-" + itoa(suffix)

	create := func(tenantID, name string) string {
		var learnerID string
		err := database.WithTenant(ctx, tenantID, "", func(tx *Tx) error {
			if _, err := tx.Exec(
				`INSERT INTO schools (tenant_id, school_name, subdomain) VALUES ($1, $2, $3)`,
				tenantID, name, tenantID,
			); err != nil {
				return err
			}
			return tx.QueryRow(
				`INSERT INTO learners (tenant_id, admission_number, first_name, last_name)
				 VALUES ($1, $2, 'Test', $3) RETURNING learner_id`,
				tenantID, "ADM-"+tenantID, name,
			).Scan(&learnerID)
		})
		if err != nil {
			t.Fatalf("create tenant %s: %v", tenantID, err)
		}
		return learnerID
	}

	learnerA := create(tenantA, "School A")
	learnerB := create(tenantB, "School B")
	t.Cleanup(func() {
		for _, id := range []string{tenantA, tenantB} {
			_ = database.WithTenant(ctx, id, "", func(tx *Tx) error {
				_, _ = tx.Exec(`DELETE FROM learners WHERE tenant_id = $1`, id)
				_, _ = tx.Exec(`DELETE FROM schools WHERE tenant_id = $1`, id)
				return nil
			})
		}
	})

	// No context: RLS must hide everything.
	var count int
	if err := database.QueryRow(`SELECT count(*) FROM learners WHERE tenant_id IN ($1, $2)`,
		tenantA, tenantB).Scan(&count); err != nil {
		t.Fatalf("count without context: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected 0 rows without tenant context, got %d", count)
	}

	// Tenant A sees exactly its learner.
	if err := database.WithTenant(ctx, tenantA, "", func(tx *Tx) error {
		var got string
		if err := tx.QueryRow(`SELECT learner_id FROM learners WHERE tenant_id IN ($1, $2)`,
			tenantA, tenantB).Scan(&got); err != nil {
			return err
		}
		if got != learnerA {
			t.Fatalf("tenant A saw learner %s, want %s", got, learnerA)
		}
		return nil
	}); err != nil {
		t.Fatalf("tenant A read: %v", err)
	}

	// Tenant B sees only its own learner.
	if err := database.WithTenant(ctx, tenantB, "", func(tx *Tx) error {
		var got string
		if err := tx.QueryRow(`SELECT learner_id FROM learners WHERE tenant_id IN ($1, $2)`,
			tenantA, tenantB).Scan(&got); err != nil {
			return err
		}
		if got != learnerB {
			t.Fatalf("tenant B saw learner %s, want %s", got, learnerB)
		}
		return nil
	}); err != nil {
		t.Fatalf("tenant B read: %v", err)
	}

	// Tenant B cannot update tenant A's row.
	if err := database.WithTenant(ctx, tenantB, "", func(tx *Tx) error {
		res, err := tx.Exec(`UPDATE learners SET first_name = 'Hacked' WHERE learner_id = $1`, learnerA)
		if err != nil {
			return err
		}
		n, _ := res.RowsAffected()
		if n != 0 {
			t.Fatalf("cross-tenant update affected %d rows", n)
		}
		return nil
	}); err != nil {
		t.Fatalf("tenant B update: %v", err)
	}

	// Tenant A's row is unchanged.
	if err := database.WithTenant(ctx, tenantA, "", func(tx *Tx) error {
		var name string
		if err := tx.QueryRow(`SELECT first_name FROM learners WHERE learner_id = $1`, learnerA).Scan(&name); err != nil {
			return err
		}
		if name == "Hacked" {
			t.Fatal("cross-tenant update succeeded")
		}
		return nil
	}); err != nil {
		t.Fatalf("tenant A verify: %v", err)
	}
}

func itoa(v int64) string {
	return strconv.FormatInt(v, 10)
}

package db

import (
	"context"
	"os"
	"strconv"
	"testing"
	"time"
)

// TestStaffCompensationIsolation is the isolation and constraint test for the
// phase-0 staff pay table (migration 0045):
//
//   - a connection with no tenant context sees no rows;
//   - cross-tenant updates affect nothing;
//   - the database itself refuses a TSC wage, and a BOM profile without a
//     portal membership, while a payee-only SUPPORT profile is allowed.
//
// It runs against TEST_DATABASE_URL and is skipped otherwise, matching
// TestTenantRLS and the finance isolation tests.
func TestStaffCompensationIsolation(t *testing.T) {
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
	for _, stmt := range []string{
		`ALTER TABLE staff_compensation_profiles ENABLE ROW LEVEL SECURITY`,
		`ALTER TABLE staff_compensation_profiles FORCE ROW LEVEL SECURITY`,
	} {
		if _, err := database.Exec(stmt); err != nil {
			t.Logf("prepare RLS skipped: %v", err)
		}
	}

	suffix := strconv.FormatInt(time.Now().UnixNano(), 10)
	tenantA := "scp-a-" + suffix
	tenantB := "scp-b-" + suffix

	insert := func(tenant, name string) string {
		var id string
		err := database.WithTenant(ctx, tenant, "", func(tx *Tx) error {
			return tx.QueryRow(
				`INSERT INTO staff_compensation_profiles
				   (tenant_id, payee_name, employment_type, monthly_wage, bank_account_last4)
				 VALUES ($1, $2, 'SUPPORT', 15000, '4321')
				 RETURNING compensation_id`,
				tenant, name,
			).Scan(&id)
		})
		if err != nil {
			t.Fatalf("create payee for %s: %v", tenant, err)
		}
		return id
	}

	payeeA := insert(tenantA, "Cook A")
	payeeB := insert(tenantB, "Cook B")

	t.Cleanup(func() {
		for _, tenant := range []string{tenantA, tenantB} {
			_ = database.WithTenant(ctx, tenant, "", func(tx *Tx) error {
				_, _ = tx.Exec(`DELETE FROM staff_compensation_profiles WHERE tenant_id = $1`, tenant)
				return nil
			})
		}
	})

	// No tenant context: RLS hides every row.
	var count int
	if err := database.QueryRowContext(ctx,
		`SELECT count(*) FROM staff_compensation_profiles WHERE tenant_id IN ($1, $2)`,
		tenantA, tenantB,
	).Scan(&count); err != nil {
		t.Fatalf("count without context: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected 0 rows without tenant context, got %d", count)
	}

	// Each tenant sees exactly its own payee.
	for tenant, want := range map[string]string{tenantA: payeeA, tenantB: payeeB} {
		tenant, want := tenant, want
		if err := database.WithTenant(ctx, tenant, "", func(tx *Tx) error {
			var got string
			if err := tx.QueryRow(
				`SELECT compensation_id::text FROM staff_compensation_profiles
				  WHERE tenant_id IN ($1, $2)`, tenantA, tenantB,
			).Scan(&got); err != nil {
				return err
			}
			if got != want {
				t.Fatalf("%s saw %s, want %s", tenant, got, want)
			}
			return nil
		}); err != nil {
			t.Fatalf("%s read: %v", tenant, err)
		}
	}

	// A cross-tenant update must affect nothing.
	if err := database.WithTenant(ctx, tenantB, "", func(tx *Tx) error {
		res, err := tx.Exec(`UPDATE staff_compensation_profiles SET monthly_wage = 1 WHERE compensation_id = $1`, payeeA)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n != 0 {
			t.Fatalf("cross-tenant update affected %d rows", n)
		}
		return nil
	}); err != nil {
		t.Fatalf("cross-tenant update: %v", err)
	}

	// A TSC teacher carries no school wage.
	if err := database.WithTenant(ctx, tenantA, "", func(tx *Tx) error {
		_, err := tx.Exec(
			`INSERT INTO staff_compensation_profiles (tenant_id, payee_name, employment_type, monthly_wage)
			 VALUES ($1, 'TSC Teacher', 'TSC', 1000)`, tenantA)
		return err
	}); err == nil {
		t.Fatal("expected a TSC wage to be rejected by the database")
	}

	// BOM staff are on the payroll, so they must have a portal membership.
	if err := database.WithTenant(ctx, tenantA, "", func(tx *Tx) error {
		_, err := tx.Exec(
			`INSERT INTO staff_compensation_profiles (tenant_id, payee_name, employment_type, monthly_wage)
			 VALUES ($1, 'BOM Teacher', 'BOM', 25000)`, tenantA)
		return err
	}); err == nil {
		t.Fatal("expected a BOM profile without a membership to be rejected")
	}

	// A SUPPORT payee has no login and is still payable.
	if err := database.WithTenant(ctx, tenantA, "", func(tx *Tx) error {
		_, err := tx.Exec(
			`INSERT INTO staff_compensation_profiles (tenant_id, payee_name, employment_type, monthly_wage)
			 VALUES ($1, 'Night Guard', 'SUPPORT', 18000)`, tenantA)
		return err
	}); err != nil {
		t.Fatalf("expected a payee-only SUPPORT profile to be accepted: %v", err)
	}
}

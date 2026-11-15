// Command rlscheck verifies tenant isolation against the schema that is actually
// deployed. It replaces scripts/audit/verify_rls.sh, which inserted into
// `tenants` and `students` — tables the current schema does not have — so it
// could never run, and which covered none of the tables added since.
//
// Three layers:
//
//	static  every table carrying a tenant_id column must have RLS enabled, RLS
//	        forced (without FORCE the owning role bypasses its own policies), a
//	        policy scoping rows by tenant_id, and a platform-admin bypass policy.
//	parent  a table with no tenant_id that is reachable only through a parent
//	        table with one is tenant data too, and none of the tenant_id checks
//	        can see it. It must scope itself (RLS enabled, forced, with a
//	        policy); staff_profiles before 0062 was exactly this gap.
//	live    for the tables that can be seeded from tenant_id alone, two probe
//	        tenants are created and every cross-tenant path is exercised:
//	        reading, updating, deleting and inserting another tenant's rows.
//
// The live layer refuses to run as a role that bypasses RLS (superuser or
// BYPASSRLS), because every assertion would then pass without proving anything.
//
//	go run ./cmd/rlscheck          # DATABASE_URL must point at a migrated DB
package main

import (
	"database/sql"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"

	_ "github.com/lib/pq"
)

type table struct {
	name        string
	rls, forced bool
	tenantScope bool
	bypass      bool
}

func main() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("TEST_DATABASE_URL")
	}
	if dsn == "" {
		fmt.Fprintln(os.Stderr, "rlscheck: DATABASE_URL is required")
		os.Exit(2)
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		fmt.Fprintf(os.Stderr, "rlscheck: connect: %v\n", err)
		os.Exit(2)
	}
	defer db.Close()

	var super, bypass bool
	var role string
	if err := db.QueryRow(`SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`).
		Scan(&role, &super, &bypass); err != nil {
		fmt.Fprintf(os.Stderr, "rlscheck: identify role: %v\n", err)
		os.Exit(2)
	}
	if super || bypass {
		fmt.Fprintf(os.Stderr,
			"rlscheck: connected as %q, which bypasses row-level security (superuser=%t, bypassrls=%t).\n"+
				"Point DATABASE_URL at a non-superuser role, otherwise this check proves nothing.\n",
			role, super, bypass)
		os.Exit(2)
	}

	tables, err := tenantTables(db)
	if err != nil {
		fmt.Fprintf(os.Stderr, "rlscheck: enumerate tables: %v\n", err)
		os.Exit(2)
	}
	if len(tables) == 0 {
		fmt.Fprintln(os.Stderr, "rlscheck: no tables carry a tenant_id column; is the database migrated?")
		os.Exit(2)
	}

	scoped := make(map[string]bool, len(tables))
	for _, t := range tables {
		scoped[t.name] = true
	}

	failures := staticCheck(tables)
	parentFailures, err := parentOnlyCheck(db, scoped)
	if err != nil {
		fmt.Fprintf(os.Stderr, "rlscheck: check parent-scoped tables: %v\n", err)
		os.Exit(2)
	}
	liveFailures := liveCheck(db)

	fmt.Printf("rlscheck: %d tables with a tenant_id column, %d static, %d parent-only and %d live failures\n",
		len(tables), failures, parentFailures, liveFailures)
	if failures+parentFailures+liveFailures > 0 {
		os.Exit(1)
	}
}

// tenantTables returns every ordinary table with a tenant_id column, plus its
// security and policy state.
func tenantTables(db *sql.DB) ([]table, error) {
	rows, err := db.Query(`
		SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = 'public' AND c.relkind = 'r'
		  AND EXISTS (SELECT 1 FROM pg_attribute a
		              WHERE a.attrelid = c.oid AND a.attname = 'tenant_id'
		                AND a.attnum > 0 AND NOT a.attisdropped)
		ORDER BY c.relname`)
	if err != nil {
		return nil, err
	}
	var out []table
	for rows.Next() {
		var t table
		if err := rows.Scan(&t.name, &t.rls, &t.forced); err != nil {
			rows.Close()
			return nil, err
		}
		out = append(out, t)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	for i := range out {
		pol, err := policies(db, out[i].name)
		if err != nil {
			return nil, err
		}
		for _, p := range pol {
			if strings.Contains(p, "tenant_id") && !strings.Contains(p, "current_user_role") {
				out[i].tenantScope = true
			}
			if strings.Contains(p, "current_user_role") {
				out[i].bypass = true
			}
		}
	}
	return out, nil
}

func policies(db *sql.DB, tableName string) ([]string, error) {
	rows, err := db.Query(`
		SELECT COALESCE(pg_get_expr(polqual, polrelid), '') || ' ' ||
		       COALESCE(pg_get_expr(polwithcheck, polrelid), '')
		FROM pg_policy WHERE polrelid = $1::regclass`, tableName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func staticCheck(tables []table) int {
	failures := 0
	for _, t := range tables {
		var problems []string
		if !t.rls {
			problems = append(problems, "row-level security is not enabled")
		}
		if t.rls && !t.forced {
			problems = append(problems, "row-level security is not forced, so the owning role bypasses it")
		}
		if !t.tenantScope {
			problems = append(problems, "no policy scopes rows by tenant_id")
		}
		if !t.bypass {
			problems = append(problems, "no platform_admin_bypass policy")
		}
		if len(problems) > 0 {
			failures++
			fmt.Printf("FAIL %s: %s\n", t.name, strings.Join(problems, "; "))
		}
	}
	return failures
}

// parentOnlyCheck flags tables that are tenant data but carry no tenant_id of
// their own, so the tenant_id checks cannot see them at all.
//
// staff_profiles before 0062 was exactly this: its only tenant link was
// membership_id -> tenant_memberships, it had no policies, and TSC numbers and
// national IDs were readable by every tenant connection. Because such a table
// never appears in the tenant_id list, the static and live checks are silent
// about it; this closes that blind spot.
//
// A table is reported when it has a foreign key into a tenant-scoped table, has
// no tenant_id column, and is not protected itself: RLS off, or RLS on with no
// policy (which would make it useless rather than safe). A table that scopes
// itself through its parent with its own policy is accepted.
func parentOnlyCheck(db *sql.DB, tenantScoped map[string]bool) (int, error) {
	rows, err := db.Query(`
		SELECT c.relname AS child, p.relname AS parent
		FROM pg_constraint con
		JOIN pg_class c ON c.oid = con.conrelid
		JOIN pg_class p ON p.oid = con.confrelid
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE con.contype = 'f'
		  AND n.nspname = 'public'
		  AND p.relnamespace = n.oid
		ORDER BY c.relname, p.relname`)
	if err != nil {
		return 0, err
	}
	type link struct {
		child  string
		parent string
	}
	var links []link
	for rows.Next() {
		var l link
		if err := rows.Scan(&l.child, &l.parent); err != nil {
			rows.Close()
			return 0, err
		}
		links = append(links, l)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, err
	}
	rows.Close()

	checked := map[string]bool{}
	failures := 0
	for _, l := range links {
		if tenantScoped[l.child] || checked[l.child] {
			continue
		}
		if !tenantScoped[l.parent] {
			continue
		}
		checked[l.child] = true

		var rls, forced bool
		if err := db.QueryRow(`
			SELECT c.relrowsecurity, c.relforcerowsecurity
			FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE n.nspname = 'public' AND c.relname = $1`, l.child).Scan(&rls, &forced); err != nil {
			return 0, fmt.Errorf("inspect %s: %w", l.child, err)
		}
		var policyCount int
		if err := db.QueryRow(`SELECT count(*) FROM pg_policy WHERE polrelid = $1::regclass`, l.child).
			Scan(&policyCount); err != nil {
			return 0, fmt.Errorf("policies for %s: %w", l.child, err)
		}

		var problems []string
		if !rls {
			problems = append(problems, "row-level security is not enabled")
		} else if policyCount == 0 {
			problems = append(problems, "row-level security is enabled but no policy scopes it")
		} else if !forced {
			problems = append(problems, "row-level security is not forced, so the owning role bypasses it")
		}
		if len(problems) == 0 {
			continue
		}

		failures++
		fmt.Printf("FAIL %s: reachable only through %s with no tenant_id of its own (%s); "+
			"give it a tenant_id and policies, or scope it through the parent\n",
			l.child, l.parent, strings.Join(problems, "; "))
	}
	return failures, nil
}

// probe is a table the live check can seed from tenant_id alone.
//
// crossStmt/crossArgs exist for tables whose row needs parent rows: the parents
// must be looked up in the *session* tenant while the row claims another one,
// otherwise the lookup returns nothing and the insert silently becomes a no-op
// that proves nothing.
type probe struct {
	table     string
	stmt      string
	args      func(tenant string) []any
	crossStmt string
	crossArgs func(ctx, row string) []any
}

func probes() []probe {
	return []probe{
		{table: "schools", stmt: `INSERT INTO schools (tenant_id, school_name, subdomain) VALUES ($1, $2, $1)`,
			args: func(t string) []any { return []any{t, "Probe " + t} }},
		{table: "academic_years", stmt: `INSERT INTO academic_years (tenant_id, year_label, start_date, end_date) VALUES ($1, '2026', '2026-01-01', '2026-12-31')`,
			args: func(t string) []any { return []any{t} }},
		{table: "learners", stmt: `INSERT INTO learners (tenant_id, admission_number, first_name, last_name) VALUES ($1, $2, 'Probe', 'Learner')`,
			args: func(t string) []any { return []any{t, "PROBE-" + t} }},
		{table: "guardians", stmt: `INSERT INTO guardians (tenant_id, first_name, last_name, phone_number) VALUES ($1, 'Probe', 'Guardian', '254700000000')`,
			args: func(t string) []any { return []any{t} }},
		// tenant_memberships is where the devuser login bug lived: the user row was
		// written but the membership silently filtered by forced RLS. The user is
		// created in the same statement and removed by cleanup.
		{table: "tenant_memberships", stmt: `WITH u AS (
				INSERT INTO users (email, email_norm, status)
				VALUES ('rlsprobe-' || $1 || '@example.test', 'rlsprobe-' || $1 || '@example.test', 'ACTIVE')
				RETURNING user_id)
			INSERT INTO tenant_memberships (user_id, tenant_id, role)
			SELECT user_id, $1, 'TEACHER' FROM u`,
			args: func(t string) []any { return []any{t} }},
		// staff_profiles hangs off the membership, not the tenant: the row is only
		// reachable through its parent, and the parent supplies the tenant. Before
		// 0062 the table had no tenant_id at all, so it could not be probed — or
		// scoped — at all.
		{table: "staff_profiles", stmt: `INSERT INTO staff_profiles (tenant_id, membership_id, tsc_number)
			SELECT $1::varchar, membership_id, 'TSC-' || $1::varchar
			  FROM tenant_memberships WHERE tenant_id = $1::varchar LIMIT 1`,
			args: func(t string) []any { return []any{t} }},
		// The money tables need their parents first: an invoice needs a learner and
		// a year, a payment needs a learner.
		{table: "invoices", stmt: `INSERT INTO invoices (tenant_id, invoice_number, learner_id, academic_year_id,
				status, total_amount, amount_paid, amount_outstanding)
			SELECT $1::varchar, 'PROBE-' || $1::varchar, l.learner_id, y.year_id, 'ISSUED', 100, 0, 100
			  FROM learners l, academic_years y
			 WHERE l.tenant_id = $1::varchar AND y.tenant_id = $1::varchar
			 LIMIT 1`,
			args: func(t string) []any { return []any{t} },
			crossStmt: `INSERT INTO invoices (tenant_id, invoice_number, learner_id, academic_year_id,
				status, total_amount, amount_paid, amount_outstanding)
			SELECT $2::varchar, 'CROSS-' || $2::varchar, l.learner_id, y.year_id, 'ISSUED', 100, 0, 100
			  FROM learners l, academic_years y
			 WHERE l.tenant_id = $1::varchar AND y.tenant_id = $1::varchar
			 LIMIT 1`,
			crossArgs: func(ctx, row string) []any { return []any{ctx, row} }},
		{table: "payments", stmt: `INSERT INTO payments (tenant_id, payment_reference, learner_id, source, amount, status)
			SELECT $1::varchar, 'PROBE-' || $1::varchar, l.learner_id, 'CASH', 10, 'COMPLETED'
			  FROM learners l WHERE l.tenant_id = $1::varchar LIMIT 1`,
			args: func(t string) []any { return []any{t} },
			crossStmt: `INSERT INTO payments (tenant_id, payment_reference, learner_id, source, amount, status)
			SELECT $2::varchar, 'CROSS-' || $2::varchar, l.learner_id, 'CASH', 10, 'COMPLETED'
			  FROM learners l WHERE l.tenant_id = $1::varchar LIMIT 1`,
			crossArgs: func(ctx, row string) []any { return []any{ctx, row} }},
		{table: "school_settings", stmt: `INSERT INTO school_settings (tenant_id, setting_key) VALUES ($1, 'rlscheck.probe')`,
			args: func(t string) []any { return []any{t} }},
		{table: "retention_policies", stmt: `INSERT INTO retention_policies (tenant_id, resource_type, retention_days, action_after_retention) VALUES ($1, 'probe', 1, 'DELETE')`,
			args: func(t string) []any { return []any{t} }},
		{table: "sync_conflicts", stmt: `INSERT INTO sync_conflicts (tenant_id, entity_type, entity_id, client_version, server_version) VALUES ($1, 'probe', gen_random_uuid(), 1, 2)`,
			args: func(t string) []any { return []any{t} }},
		{table: "tenant_usage", stmt: `INSERT INTO tenant_usage (tenant_id, period_month) VALUES ($1, '2026-11')`,
			args: func(t string) []any { return []any{t} }},
		{table: "receipt_sequences", stmt: `INSERT INTO receipt_sequences (tenant_id, current_period) VALUES ($1, '2026-11')`,
			args: func(t string) []any { return []any{t} }},
		{table: "mpesa_holding_tank", stmt: `INSERT INTO mpesa_holding_tank (tenant_id, transaction_code, amount, sender_phone, raw_webhook_payload) VALUES ($1, $2, 10.00, '254700000000', '{}'::jsonb)`,
			args: func(t string) []any { return []any{t, "PROBE-" + t} }},
		{table: "audit_events", stmt: `INSERT INTO audit_events (tenant_id, action, table_name) VALUES ($1, 'RLS_PROBE', 'rlscheck')`,
			args: func(t string) []any { return []any{t} }},
	}
}

var probeTenants []string

func liveCheck(db *sql.DB) int {
	suffix := fmt.Sprintf("%d", time.Now().UnixNano()%1_000_000_000)
	probeTenants = []string{"probe-a-" + suffix, "probe-b-" + suffix}
	a, b := probeTenants[0], probeTenants[1]

	failures := 0
	var seeded []probe
	for _, p := range probes() {
		ok := true
		for _, tenant := range probeTenants {
			if err := withTenant(db, tenant, func(tx *sql.Tx) error {
				_, err := tx.Exec(p.stmt, p.args(tenant)...)
				return err
			}); err != nil {
				fmt.Printf("SKIP %s: cannot seed a probe row (%v)\n", p.table, err)
				ok = false
				break
			}
		}
		if ok {
			seeded = append(seeded, p)
		}
	}

	fail := func(p probe, format string, args ...any) {
		failures++
		fmt.Printf("FAIL %s: %s\n", p.table, fmt.Sprintf(format, args...))
	}

	for _, p := range seeded {
		var others, own, updated, deleted int
		var err error

		// Everything below runs as tenant A, exactly as the API reads: the tenant
		// is set for the transaction, then the query is issued.
		err = withTenant(db, a, func(tx *sql.Tx) error {
			return tx.QueryRow(`SELECT count(*) FROM `+p.table+` WHERE tenant_id = $1`, b).Scan(&others)
		})
		if err != nil {
			fail(p, "reading another tenant's rows: %v", err)
		} else if others > 0 {
			fail(p, "tenant A can read %d row(s) owned by tenant B", others)
		}

		err = withTenant(db, a, func(tx *sql.Tx) error {
			return tx.QueryRow(`SELECT count(*) FROM `+p.table+` WHERE tenant_id = $1`, a).Scan(&own)
		})
		if err != nil {
			fail(p, "reading its own rows: %v", err)
		} else if own < 1 {
			fail(p, "tenant A cannot read its own probe row (policy is too tight)")
		}

		err = withTenant(db, a, func(tx *sql.Tx) error {
			res, err := tx.Exec(`UPDATE `+p.table+` SET tenant_id = tenant_id WHERE tenant_id = $1`, b)
			if err != nil {
				return nil // refused outright; also not a leak
			}
			n, err := res.RowsAffected()
			updated = int(n)
			return err
		})
		if err != nil {
			fail(p, "updating another tenant's rows: %v", err)
		} else if updated > 0 {
			fail(p, "tenant A can update %d row(s) owned by tenant B", updated)
		}

		err = withTenant(db, a, func(tx *sql.Tx) error {
			res, err := tx.Exec(`DELETE FROM `+p.table+` WHERE tenant_id = $1`, b)
			if err != nil {
				return nil
			}
			n, err := res.RowsAffected()
			deleted = int(n)
			return err
		})
		if err != nil {
			fail(p, "deleting another tenant's rows: %v", err)
		} else if deleted > 0 {
			fail(p, "tenant A can delete %d row(s) owned by tenant B", deleted)
		}

		// An error here is the expected outcome: WITH CHECK refuses the row for the
		// other tenant. A successful insert of any row is a leak; a no-op insert is
		// inconclusive, so the cross statement must produce a row when permitted.
		stmt, args := p.stmt, p.args(b)
		if p.crossStmt != "" {
			stmt, args = p.crossStmt, p.crossArgs(a, b)
		}
		var inserted int64
		if err := withTenant(db, a, func(tx *sql.Tx) error {
			res, err := tx.Exec(stmt, args...)
			if err != nil {
				return err
			}
			inserted, err = res.RowsAffected()
			return err
		}); err == nil && inserted > 0 {
			fail(p, "tenant A can insert %d row(s) owned by tenant B", inserted)
		}
	}

	cleanup(db, seeded)

	names := make([]string, 0, len(seeded))
	for _, p := range seeded {
		names = append(names, p.table)
	}
	sort.Strings(names)
	fmt.Printf("rlscheck: live isolation exercised on %d tables (%s)\n", len(seeded), strings.Join(names, ", "))
	return failures
}

func cleanup(db *sql.DB, seeded []probe) {
	// users carry no tenant_id, so the memberships probe must remove theirs
	// explicitly; otherwise every run leaves two probe accounts behind.
	for _, tenant := range probeTenants {
		t := tenant
		_ = withTenant(db, t, func(tx *sql.Tx) error {
			_, err := tx.Exec(`DELETE FROM users WHERE email_norm = 'rlsprobe-' || $1 || '@example.test'`, t)
			return err
		})
	}
	for _, tenant := range probeTenants {
		for _, p := range seeded {
			t := tenant
			if p.table == "schools" {
				continue
			}
			_ = withTenant(db, t, func(tx *sql.Tx) error {
				_, err := tx.Exec(`DELETE FROM `+p.table+` WHERE tenant_id = $1`, t)
				return err
			})
		}
		t := tenant
		_ = withTenant(db, t, func(tx *sql.Tx) error {
			_, err := tx.Exec(`DELETE FROM schools WHERE tenant_id = $1`, t)
			return err
		})
	}
}

func withTenant(db *sql.DB, tenant string, fn func(*sql.Tx) error) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	if _, err := tx.Exec(`SELECT set_config('app.current_tenant_id', $1, true)`, tenant); err != nil {
		tx.Rollback()
		return err
	}
	if err := fn(tx); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}

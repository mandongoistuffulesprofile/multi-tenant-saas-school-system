// Command bootstrapadmin creates the first login for a fresh installation.
//
// On a new database nobody can sign in: every administrative action needs an
// authenticated user, and users only exist after someone creates them. This
// command is the single supported bootstrap path for a production install.
//
// Usage (from the production compose file, after migrations have run):
//
//	docker compose -f docker-compose.prod.yml --env-file .env.prod \
//	  run --rm bootstrap
//
// Environment:
//
//	BOOTSTRAP_EMAIL       required — login email for the new account
//	BOOTSTRAP_PHONE       optional — defaults to a generated placeholder
//	BOOTSTRAP_PASSWORD    optional — generated and printed once when unset
//	BOOTSTRAP_ROLE        optional — SAAS_ADMIN (default) or a school role
//	BOOTSTRAP_TENANT      optional — tenant id, default platform-ops
//	BOOTSTRAP_SCHOOL_NAME optional — display name for that tenant
//
// The command is idempotent: re-running with the same email resets that user's
// password (use cmd/setpassword for routine changes) and leaves the tenant
// intact.
package main

import (
	"crypto/rand"
	"database/sql"
	"fmt"
	"math/big"
	"os"
	"strings"

	_ "github.com/lib/pq"

	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/auth"
)

func main() {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		fail("DATABASE_URL is required")
	}

	email := strings.ToLower(strings.TrimSpace(os.Getenv("BOOTSTRAP_EMAIL")))
	if email == "" {
		fail("BOOTSTRAP_EMAIL is required")
	}
	phone := strings.TrimSpace(os.Getenv("BOOTSTRAP_PHONE"))
	if phone == "" {
		phone = placeholderPhone()
	}
	role := env("BOOTSTRAP_ROLE", "SAAS_ADMIN")
	tenantID := env("BOOTSTRAP_TENANT", "platform-ops")
	schoolName := env("BOOTSTRAP_SCHOOL_NAME", "Platform Operations")

	password := os.Getenv("BOOTSTRAP_PASSWORD")
	generated := ""
	if password == "" {
		pw, err := auth.GeneratePassword(24)
		if err != nil {
			fail("generate password: %v", err)
		}
		password = pw
		generated = pw
	}
	if msg := auth.ValidatePasswordPolicy(password); msg != "" {
		fail("password: %s", msg)
	}

	hash, err := auth.HashPassword(password)
	if err != nil {
		fail("hash password: %v", err)
	}

	db, err := sql.Open("postgres", url)
	if err != nil {
		fail("connect: %v", err)
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		fail("connect: %v", err)
	}

	tx, err := db.Begin()
	if err != nil {
		fail("begin: %v", err)
	}
	defer tx.Rollback()

	// Tenant tables are FORCE-RLS protected, including on their owner. Scope
	// this bootstrap transaction to the tenant it is creating.
	if _, err := tx.Exec(`SELECT set_config('app.current_tenant_id', $1, true)`, tenantID); err != nil {
		fail("set tenant context: %v", err)
	}

	if _, err := tx.Exec(
		`INSERT INTO schools (tenant_id, school_name, subdomain)
		 VALUES ($1, $2, $1)
		 ON CONFLICT (tenant_id) DO NOTHING`,
		tenantID, schoolName,
	); err != nil {
		fail("upsert school: %v", err)
	}

	var userID string
	err = tx.QueryRow(
		`SELECT user_id FROM users WHERE email_norm = $1 OR phone_number = $2 LIMIT 1`,
		email, phone,
	).Scan(&userID)
	switch {
	case err == sql.ErrNoRows:
		if err := tx.QueryRow(
			`INSERT INTO users (email, phone_number, password_hash, status, email_norm)
			 VALUES ($1, $2, $3, 'ACTIVE', $4) RETURNING user_id`,
			email, phone, hash, email,
		).Scan(&userID); err != nil {
			fail("create user: %v", err)
		}
	case err != nil:
		fail("look up user: %v", err)
	default:
		if _, err := tx.Exec(
			`UPDATE users SET password_hash = $1, status = 'ACTIVE', email_norm = LOWER(email)
			 WHERE user_id = $2`,
			hash, userID,
		); err != nil {
			fail("update user: %v", err)
		}
	}

	if _, err := tx.Exec(
		`INSERT INTO tenant_memberships (user_id, tenant_id, role, status)
		 VALUES ($1, $2, $3, 'ACTIVE')
		 ON CONFLICT (user_id, tenant_id) DO UPDATE
		 SET role = EXCLUDED.role, status = 'ACTIVE'`,
		userID, tenantID, role,
	); err != nil {
		fail("upsert membership: %v", err)
	}

	if err := tx.Commit(); err != nil {
		fail("commit: %v", err)
	}

	fmt.Printf("Bootstrap account ready\n  email:  %s\n  role:   %s\n  tenant: %s (%s)\n", email, role, tenantID, schoolName)
	if phone != "" {
		fmt.Printf("  phone:  %s\n", phone)
	}
	if generated != "" {
		fmt.Printf("  password (shown once): %s\n", generated)
	} else {
		fmt.Println("  password: unchanged (BOOTSTRAP_PASSWORD was supplied)")
	}
}

func placeholderPhone() string {
	max := big.NewInt(900000)
	n, err := rand.Int(rand.Reader, max)
	if err != nil {
		return ""
	}
	return fmt.Sprintf("2547%08d", n.Int64()+10000000)
}

func env(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func fail(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}

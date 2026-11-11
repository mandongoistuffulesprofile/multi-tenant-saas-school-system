package main

import (
	"database/sql"
	"fmt"
	"os"
	"strings"

	_ "github.com/lib/pq"

	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/auth"
)

// Creates (or updates) a development school and user so role-based access can
// be exercised locally.
//
// Usage:
//
//	DATABASE_URL=postgres://... DEV_EMAIL=teacher@skulapp.test \
//	  DEV_PHONE=254700000002 DEV_ROLE=TEACHER DEV_TENANT=dev-school-001 \
//	  go run ./cmd/devuser
//
// A random password is generated and printed once unless DEV_PASSWORD is set.
func main() {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		fmt.Fprintln(os.Stderr, "DATABASE_URL is required")
		os.Exit(1)
	}

	email := env("DEV_EMAIL", "teacher@skulapp.test")
	phone := env("DEV_PHONE", "254700000002")
	role := env("DEV_ROLE", "TEACHER")
	tenantID := env("DEV_TENANT", "dev-school-001")

	password := os.Getenv("DEV_PASSWORD")
	generatedPassword := ""
	if password == "" {
		pw, err := auth.GeneratePassword(24)
		if err != nil {
			fmt.Fprintf(os.Stderr, "generate password: %v\n", err)
			os.Exit(1)
		}
		password = pw
		generatedPassword = pw
	}
	if msg := auth.ValidatePasswordPolicy(password); msg != "" {
		fmt.Fprintf(os.Stderr, "password: %s\n", msg)
		os.Exit(1)
	}

	hash, err := auth.HashPassword(password)
	if err != nil {
		fmt.Fprintf(os.Stderr, "hash: %v\n", err)
		os.Exit(1)
	}

	db, err := sql.Open("postgres", url)
	if err != nil {
		fmt.Fprintf(os.Stderr, "connect: %v\n", err)
		os.Exit(1)
	}
	defer db.Close()

	tx, err := db.Begin()
	if err != nil {
		fmt.Fprintf(os.Stderr, "begin: %v\n", err)
		os.Exit(1)
	}
	defer tx.Rollback()

	// Tenant tables are FORCE-RLS protected. Scope this bootstrap transaction to
	// the tenant it is creating; otherwise the school insert is rejected.
	if _, err := tx.Exec(
		`SELECT set_config('app.current_tenant_id', $1, true)`, tenantID,
	); err != nil {
		fmt.Fprintf(os.Stderr, "set tenant context: %v\n", err)
		os.Exit(1)
	}

	// The school is the tenant root; memberships and every domain row point at
	// schools.tenant_id.
	if _, err := tx.Exec(
		`INSERT INTO schools (tenant_id, school_name, subdomain)
		 VALUES ($1, $2, $1)
		 ON CONFLICT (tenant_id) DO NOTHING`,
		tenantID, "Development School",
	); err != nil {
		fmt.Fprintf(os.Stderr, "upsert school: %v\n", err)
		os.Exit(1)
	}

	var userID string
	err = tx.QueryRow(
		`SELECT user_id FROM users WHERE phone_number = $1 OR email = $2 LIMIT 1`,
		phone, email,
	).Scan(&userID)
	if err == sql.ErrNoRows {
		err = tx.QueryRow(
			`INSERT INTO users (email, phone_number, password_hash, status, email_norm)
			 VALUES ($1, $2, $3, 'ACTIVE', $4) RETURNING user_id`,
			email, phone, hash, strings.ToLower(email),
		).Scan(&userID)
	} else if err == nil {
		_, err = tx.Exec(
			`UPDATE users SET password_hash = $1, status = 'ACTIVE', email_norm = LOWER(email)
			 WHERE user_id = $2`,
			hash, userID,
		)
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "upsert user: %v\n", err)
		os.Exit(1)
	}

	if _, err := tx.Exec(
		`INSERT INTO tenant_memberships (user_id, tenant_id, role, status)
		 VALUES ($1, $2, $3, 'ACTIVE')
		 ON CONFLICT (user_id, tenant_id) DO UPDATE
		 SET role = EXCLUDED.role, status = 'ACTIVE'`,
		userID, tenantID, role,
	); err != nil {
		fmt.Fprintf(os.Stderr, "upsert membership: %v\n", err)
		os.Exit(1)
	}

	if err := tx.Commit(); err != nil {
		fmt.Fprintf(os.Stderr, "commit: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Dev user ready: %s (%s) role=%s tenant=%s\n", email, phone, role, tenantID)
	if generatedPassword != "" {
		fmt.Printf("Generated password (shown once): %s\n", generatedPassword)
	}
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

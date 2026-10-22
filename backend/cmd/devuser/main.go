package main

import (
	"database/sql"
	"fmt"
	"os"

	"github.com/lib/pq"

	"kenyan-primary-saas/backend/internal/auth"
)

// Creates (or updates) a development user with the given role so that
// role-based access control can be exercised locally.
//
// Usage:
//   DEV_EMAIL=teacher@skulapp.test DEV_PHONE=254700000002 DEV_ROLE=TEACHER \
//     DEV_PASSWORD='Teacher1234!' go run ./cmd/devuser
func main() {
	email := env("DEV_EMAIL", "teacher@skulapp.test")
	phone := env("DEV_PHONE", "254700000002")
	role := env("DEV_ROLE", "TEACHER")
	tenantID := env("DEV_TENANT", "dev-school-001")
	password := env("DEV_PASSWORD", "Teacher1234!")

	hash, err := auth.HashPassword(password)
	if err != nil {
		fmt.Fprintf(os.Stderr, "hash: %v\n", err)
		os.Exit(1)
	}

	db, err := sql.Open("postgres",
		"postgres://skulapp_app:skulapp_app_change_in_prod@localhost:5432/skulapp?sslmode=disable")
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

	// users.email / users.phone_number carry plain indexes rather than unique
	// constraints, so resolve the row explicitly instead of relying on
	// ON CONFLICT.
	var userID string
	err = tx.QueryRow(
		`SELECT user_id FROM users WHERE phone_number = $1 OR email = $2 LIMIT 1`,
		phone, email,
	).Scan(&userID)
	if err == sql.ErrNoRows {
		err = tx.QueryRow(
			`INSERT INTO users (email, phone_number, password_hash, status)
			 VALUES ($1, $2, $3, 'ACTIVE') RETURNING user_id`,
			email, phone, hash,
		).Scan(&userID)
	} else {
		_, err = tx.Exec(
			`UPDATE users SET password_hash = $1, status = 'ACTIVE' WHERE user_id = $2`,
			hash, userID,
		)
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "upsert user: %v\n", err)
		os.Exit(1)
	}

	_, err = tx.Exec(
		`UPDATE tenant_memberships SET role = $1, status = 'ACTIVE'
		 WHERE user_id = $2 AND tenant_id = $3`,
		role, userID, tenantID,
	)
	if err != nil {
		fmt.Fprintf(os.Stderr, "update membership: %v\n", err)
		os.Exit(1)
	}

	// Insert the membership only when it does not exist yet.
	var membershipCount int
	_ = tx.QueryRow(
		`SELECT COUNT(*) FROM tenant_memberships WHERE user_id = $1 AND tenant_id = $2`,
		userID, tenantID,
	).Scan(&membershipCount)
	if membershipCount == 0 {
		_, err = tx.Exec(
			`INSERT INTO tenant_memberships (user_id, tenant_id, role, status)
			 VALUES ($1, $2, $3, 'ACTIVE')`,
			userID, tenantID, role,
		)
		if err != nil {
			fmt.Fprintf(os.Stderr, "insert membership: %v\n", err)
			os.Exit(1)
		}
	}

	if err := tx.Commit(); err != nil {
		fmt.Fprintf(os.Stderr, "commit: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Dev user ready: %s (%s) role=%s tenant=%s\n", email, phone, role, tenantID)
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

var _ = pq.Error{}

// Command setpassword rotates an existing user's password without ever
// storing the value in the repository or shell history.
//
// Usage:
//
//	DATABASE_URL=postgres://... go run ./cmd/setpassword -email admin@example.com
//
// The password is read from NEW_PASSWORD (or DEV_PASSWORD for the local dev
// flow). When neither is set a cryptographically random password is generated
// and printed once.
package main

import (
	"database/sql"
	"flag"
	"fmt"
	"os"

	_ "github.com/lib/pq"

	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/auth"
)

func main() {
	email := flag.String("email", "", "user email to update")
	userID := flag.String("user-id", "", "user id to update (alternative to -email)")
	passwordFlag := flag.String("password", "", "password (prefer NEW_PASSWORD; generated when empty)")
	flag.Parse()

	url := os.Getenv("DATABASE_URL")
	if url == "" {
		fatal("DATABASE_URL is required")
	}
	if *email == "" && *userID == "" {
		fatal("one of -email or -user-id is required")
	}

	password := *passwordFlag
	if password == "" {
		password = os.Getenv("NEW_PASSWORD")
	}
	if password == "" {
		password = os.Getenv("DEV_PASSWORD")
	}
	generated := false
	if password == "" {
		pw, err := auth.GeneratePassword(24)
		if err != nil {
			fatal("generate password: %v", err)
		}
		password = pw
		generated = true
	}
	if msg := auth.ValidatePasswordPolicy(password); msg != "" {
		fatal("password: %s", msg)
	}

	hash, err := auth.HashPassword(password)
	if err != nil {
		fatal("hash: %v", err)
	}

	db, err := sql.Open("postgres", url)
	if err != nil {
		fatal("open database: %v", err)
	}
	defer db.Close()

	var result sql.Result
	if *userID != "" {
		result, err = db.Exec(
			`UPDATE users
			 SET password_hash = $1, status = 'ACTIVE',
			     failed_login_count = 0, locked_until = NULL, updated_at = NOW()
			 WHERE user_id = $2`,
			hash, *userID,
		)
	} else {
		result, err = db.Exec(
			`UPDATE users
			 SET password_hash = $1, status = 'ACTIVE',
			     failed_login_count = 0, locked_until = NULL, updated_at = NOW()
			 WHERE email_norm = LOWER($2) OR email = $2`,
			hash, *email,
		)
	}
	if err != nil {
		fatal("update password: %v", err)
	}
	updated, _ := result.RowsAffected()
	if updated == 0 {
		fatal("user not found; create it first (cmd/devuser or the platform onboarding flow)")
	}

	target := *email
	if target == "" {
		target = *userID
	}
	fmt.Printf("Password updated for %s\n", target)
	if generated {
		fmt.Printf("Generated password (shown once): %s\n", password)
	}
}

func fatal(format string, args ...interface{}) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}

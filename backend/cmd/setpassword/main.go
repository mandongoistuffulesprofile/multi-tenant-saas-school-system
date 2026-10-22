package main

import (
	"database/sql"
	"fmt"
	"os"

	"kenyan-primary-saas/backend/internal/auth"
)

func main() {
	password := os.Getenv("DEV_PASSWORD")
	if password == "" {
		password = "Admin1234!"
	}

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

	_, err = db.Exec(
		`UPDATE users SET password_hash = $1 WHERE user_id = $2`,
		hash, "121519ba-27b6-484c-8820-522dabbe5f8f")
	if err != nil {
		fmt.Fprintf(os.Stderr, "update: %v\n", err)
		os.Exit(1)
	}

	fmt.Println("Password set for dev.admin@skulapp.test")
}
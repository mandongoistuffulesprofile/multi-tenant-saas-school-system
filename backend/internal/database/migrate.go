package database

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// RunMigrations discovers and applies all .sql files in the migrations directory in alphabetical order
func RunMigrations(ctx context.Context, pool *pgxpool.Pool, migrationsDir string) error {
	// 1. Create migrations tracking table
	_, err := pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			filename VARCHAR(255) PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`)
	if err != nil {
		return fmt.Errorf("failed to initialize schema_migrations table: %w", err)
	}

	// 2. Discover all SQL files recursively
	var files []string
	err = filepath.Walk(migrationsDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() && strings.HasSuffix(info.Name(), ".sql") {
			files = append(files, path)
		}
		return nil
	})
	if err != nil {
		log.Printf("⚠️ Notice: Could not read migrations directory (%s): %v. Skipping auto-migrations.", migrationsDir, err)
		return nil
	}

	sort.Strings(files)

	// 3. Apply pending migrations
	for _, file := range files {
		relName, _ := filepath.Rel(migrationsDir, file)

		var exists bool
		err := pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE filename = $1)", relName).Scan(&exists)
		if err != nil {
			return fmt.Errorf("failed checking migration state for %s: %w", relName, err)
		}

		if exists {
			continue // Already applied
		}

		content, err := os.ReadFile(file)
		if err != nil {
			return fmt.Errorf("failed reading migration file %s: %w", file, err)
		}

		log.Printf("⚡ Applying database migration: %s", relName)
		_, err = pool.Exec(ctx, string(content))
		if err != nil {
			return fmt.Errorf("migration failed in %s: %w", relName, err)
		}

		_, err = pool.Exec(ctx, "INSERT INTO schema_migrations (filename) VALUES ($1)", relName)
		if err != nil {
			return fmt.Errorf("failed recording migration %s: %w", relName, err)
		}
		log.Printf("✅ Migration successfully applied: %s", relName)
	}

	return nil
}

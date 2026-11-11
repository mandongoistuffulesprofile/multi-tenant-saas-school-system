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

// RunMigrations discovers and applies ONLY root-level .sql files in migrations/ (non-recursive)
// matching the pattern 00XX_*.sql, sorted naturally.
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

	// 2. Discover ONLY root-level migration files (non-recursive)
	entries, err := os.ReadDir(migrationsDir)
	if err != nil {
		log.Printf("⚠️ Notice: Could not read migrations directory (%s): %v. Skipping auto-migrations.", migrationsDir, err)
		return nil
	}

	var files []string
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".sql") {
			// Only apply files matching 0001_*.sql ... 0099_*.sql (root migrations)
			// Skip any that don't match the pattern
			name := entry.Name()
			if len(name) >= 5 && name[0] >= '0' && name[0] <= '9' &&
			   name[1] >= '0' && name[1] <= '9' &&
			   name[2] >= '0' && name[2] <= '9' &&
			   name[3] >= '0' && name[3] <= '9' &&
			   name[4] == '_' {
				files = append(files, filepath.Join(migrationsDir, name))
			}
		}
	}

	sort.Strings(files)

	if len(files) == 0 {
		log.Printf("⚠️ No root-level migration files (00XX_*.sql) found in %s", migrationsDir)
		return nil
	}

	// 3. Apply pending migrations
	for _, file := range files {
		relName := filepath.Base(file)

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
			return fmt.Errorf("failed reading migration file %s: %w", relName, err)
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

// Command migrate applies SQL migrations in lexical order.
//
// It is deliberately separate from the API process: multiple API replicas
// starting at once must never race DDL. The advisory lock is the second line of
// defence (deploy scripts should still run this as a single job).
//
//	schema_migrations(filename, checksum, applied_at)
//
// A changed file that has already been applied aborts the run. Add a new file
// instead of editing history. The only exception is repairedChecksums below:
// migrations whose historical content was syntactically invalid or missing a
// required index and had to be corrected in place. Those exact old checksums
// are adopted; the accompanying new migration applies the schema delta, so the
// corrected file is never re-executed against a live database.
package main

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"sort"

	_ "github.com/lib/pq"
)

// repairedChecksums maps a migration that had to be corrected in place to the
// checksums of its historical content. A database that recorded any of those
// exact versions is adopted (checksum updated) instead of aborting deployment.
// 0001 never executed anywhere (its statements ended in '.'), so adoption can
// only come from -baseline. 0029 was executable; 0039 applies its index delta.
//
// 0001 has two historical versions in the wild: the compact 2026-11-12 rewrite
// and the pg_dump-style baseline that preceded it. The dump version is a
// superset of the rewrite (the extra tables now live in 0000 and the extra
// indexes are not required), so adopting either is safe.
var repairedChecksums = map[string][]string{
	"0001_baseline.sql": {
		"65be7a029b50ac61a95e9bcd09c0e237bc414ae86a25139786bf904a0e9e5e6c",
		"fc5d534942291a0e39bc8921d53d276ae7f69c21dfba61ab1cc38572a4a8b7b4",
	},
	"0029_seed_plans.sql": {
		"08e09becd1db397b858cf39126a28346116e4cf1faf0ca3d52114adfd2f97462",
	},
}

func main() {
	dir := flag.String("dir", "migrations", "directory containing *.sql migrations")
	seed := flag.Bool("seed", false, "also apply migrations/seed/*.sql")
	dryRun := flag.Bool("dry-run", false, "print pending migrations without applying")
	baseline := flag.String("baseline", "", "record this migration as already applied (adopt an existing database)")
	flag.Parse()

	url := os.Getenv("DATABASE_URL")
	if url == "" {
		fatal("DATABASE_URL is required")
	}

	// Refuse to apply seed/demo data in production.
	if *seed && os.Getenv("APP_ENV") == "production" {
		fatal("seed flag is disabled when APP_ENV=production; remove demo data from production deployments")
	}

	db, err := sql.Open("postgres", url)
	if err != nil {
		fatal("open database: %v", err)
	}
	defer db.Close()

	if err := run(db, *dir, *seed, *dryRun, *baseline); err != nil {
		fatal("%v", err)
	}
}

func run(db *sql.DB, dir string, seed, dryRun bool, baseline string) error {
	if _, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			filename   text PRIMARY KEY,
			checksum   text NOT NULL,
			applied_at timestamptz NOT NULL DEFAULT now()
		)`); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}

	// Serialize concurrent migrators. The lock is released on disconnect.
	if _, err := db.Exec(`SELECT pg_advisory_lock(hashtext('skulapp_schema_migrations'))`); err != nil {
		return fmt.Errorf("acquire migration lock: %w", err)
	}

	// The baseline was dumped from a provisioned database and references
	// extensions.uuid_generate_v4(). Bootstrap the schema/extension so a fresh
	// production database can be migrated without a manual pre-step. Both
	// statements are idempotent and the official postgres images ship contrib.
	if _, err := db.Exec(`
		CREATE SCHEMA IF NOT EXISTS extensions;
		CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
	`); err != nil {
		return fmt.Errorf("bootstrap extensions schema: %w", err)
	}

	if baseline != "" {
		if dryRun {
			return fmt.Errorf("-baseline cannot be combined with -dry-run")
		}
		var count int
		if err := db.QueryRow(`SELECT count(*) FROM schema_migrations`).Scan(&count); err != nil {
			return err
		}
		if count > 0 {
			return fmt.Errorf("-baseline only applies to an empty schema_migrations table")
		}
		path := filepath.Join(dir, baseline)
		body, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("read baseline %s: %w", baseline, err)
		}
		sum := sha256.Sum256(body)
		if _, err := db.Exec(
			`INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)`,
			baseline, hex.EncodeToString(sum[:]),
		); err != nil {
			return fmt.Errorf("record baseline: %w", err)
		}
		fmt.Printf("baselined: %s\n", baseline)
	}

	files, err := filepath.Glob(filepath.Join(dir, "*.sql"))
	if err != nil {
		return err
	}
	if seed {
		seedFiles, err := filepath.Glob(filepath.Join(dir, "seed", "*.sql"))
		if err != nil {
			return err
		}
		files = append(files, seedFiles...)
	}
	sort.Strings(files)

	applied := 0
	for _, file := range files {
		name, err := filepath.Rel(dir, file)
		if err != nil {
			name = file
		}
		body, err := os.ReadFile(file)
		if err != nil {
			return fmt.Errorf("read %s: %w", name, err)
		}
		sum := sha256.Sum256(body)
		checksum := hex.EncodeToString(sum[:])

		var existing string
		err = db.QueryRow(`SELECT checksum FROM schema_migrations WHERE filename = $1`, name).Scan(&existing)
		switch {
		case err == nil && existing == checksum:
			continue
		case err == nil && existing != checksum:
			if repaired, ok := repairedChecksums[name]; ok && slices.Contains(repaired, existing) {
				if _, uerr := db.Exec(`UPDATE schema_migrations SET checksum = $1 WHERE filename = $2`, checksum, name); uerr != nil {
					return fmt.Errorf("adopt repaired checksum for %s: %w", name, uerr)
				}
				fmt.Printf("adopted repaired checksum: %s\n", name)
				continue
			}
			return fmt.Errorf("%s was already applied with a different checksum; create a new migration instead", name)
		case !errors.Is(err, sql.ErrNoRows):
			return fmt.Errorf("check %s: %w", name, err)
		}

		if dryRun {
			fmt.Printf("pending: %s\n", name)
			continue
		}

		tx, err := db.Begin()
		if err != nil {
			return err
		}
		if _, err := tx.Exec(string(body)); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("apply %s: %w", name, err)
		}
		if _, err := tx.Exec(
			`INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)`, name, checksum,
		); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("record %s: %w", name, err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit %s: %w", name, err)
		}
		fmt.Printf("applied: %s\n", name)
		applied++
	}

	if dryRun {
		fmt.Println("dry run: no changes applied")
	} else {
		fmt.Printf("%d migration(s) applied\n", applied)
	}
	return nil
}

func fatal(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "migrate: "+format+"\n", args...)
	os.Exit(1)
}

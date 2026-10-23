// Command migrate applies SQL migrations in lexical order.
//
// It is deliberately separate from the API process: multiple API replicas
// starting at once must never race DDL. The advisory lock is the second line of
// defence (deploy scripts should still run this as a single job).
//
//	schema_migrations(filename, checksum, applied_at)
//
// A changed file that has already been applied aborts the run. Add a new file
// instead of editing history.
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
	"sort"

	_ "github.com/lib/pq"
)

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

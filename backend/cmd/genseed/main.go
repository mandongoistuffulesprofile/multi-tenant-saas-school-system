// Command genseed regenerates the seed SQL that is derived from Go definitions,
// so the runtime seed and the SQL seed cannot drift apart.
//
//	cd backend && go run ./cmd/genseed
package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/ledger"
)

func main() {
	out := flag.String("out", filepath.Join("..", "migrations", "seed", "0002_ledger_accounts.sql"),
		"seed file to write, relative to the backend directory")
	flag.Parse()

	if err := os.WriteFile(*out, []byte(ledger.SeedSQL()), 0o644); err != nil {
		fmt.Fprintf(os.Stderr, "genseed: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("genseed: wrote %s (%d accounts)\n", *out, len(ledger.BaselineChart))
}

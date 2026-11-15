package main

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// A freshly migrated-and-seeded database must be able to post an in-kind
// intake. That posting debits INV_FOOD and credits FEE_RECEIVABLE, and without
// those rows the service refuses with "chart of accounts has no INV_FOOD
// account" — which is exactly what a seed-only database did before the
// baseline chart of accounts was added.
//
// The check is static so it runs without a database: it reads the seed files
// the migrate command applies, and it derives the required codes from the
// backend itself rather than a hand-kept list, so adding a lookup for a new
// code fails here until the seed seeds it.
func TestSeedSeedsEveryLedgerAccountTheBackendLooksUp(t *testing.T) {
	seeded := seededLedgerCodes(t)

	required := map[string]bool{
		"INV_FOOD":       true,
		"FEE_RECEIVABLE": true,
	}
	for code := range lookedUpLedgerCodes(t) {
		required[code] = true
	}

	var missing []string
	for code := range required {
		if !seeded[code] {
			missing = append(missing, code)
		}
	}
	if len(missing) > 0 {
		sort.Strings(missing)
		t.Fatalf("migrations/seed does not seed ledger account(s) %s; a freshly "+
			"seeded database cannot post against them (seeded: %s)",
			strings.Join(missing, ", "), strings.Join(sortedKeys(seeded), ", "))
	}
}

// seededLedgerCodes returns every code inserted into ledger_accounts by the
// seed files.
func seededLedgerCodes(t *testing.T) map[string]bool {
	t.Helper()
	files, err := filepath.Glob(filepath.Join("..", "..", "..", "migrations", "seed", "*.sql"))
	if err != nil || len(files) == 0 {
		t.Fatalf("no seed files found: %v", err)
	}
	codes := map[string]bool{}
	for _, path := range files {
		body, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		for _, stmt := range ledgerAccountStatements(string(body)) {
			for _, m := range ledgerCodeValue.FindAllStringSubmatch(stmt, -1) {
				codes[m[1]] = true
			}
		}
	}
	return codes
}

// lookedUpLedgerCodes finds the codes the backend resolves by name, e.g.
// `AND la.code = 'INV_FOOD'`.
func lookedUpLedgerCodes(t *testing.T) map[string]bool {
	t.Helper()
	codes := map[string]bool{}
	root := filepath.Join("..", "..")
	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() || !strings.HasSuffix(path, ".go") ||
			strings.HasSuffix(path, "_test.go") {
			return err
		}
		body, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		// Only files that touch the ledger: `code` columns exist on fee
		// categories too (TUITION, TRANSPORT), which are not accounts.
		if !strings.Contains(string(body), "ledger_accounts") {
			return nil
		}
		for _, m := range ledgerLookup.FindAllStringSubmatch(string(body), -1) {
			codes[m[1]] = true
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk backend: %v", err)
	}
	return codes
}

var (
	// One INSERT statement, up to its terminating semicolon.
	ledgerInsert    = regexp.MustCompile(`(?is)INSERT\s+INTO\s+(?:public\.)?ledger_accounts\b.*?;`)
	ledgerCodeValue = regexp.MustCompile(`'([A-Z][A-Z0-9_]{2,})'`)
	ledgerLookup    = regexp.MustCompile(`\bcode\s*=\s*'([A-Z][A-Z0-9_]{2,})'`)
)

func ledgerAccountStatements(sqlBody string) []string {
	return ledgerInsert.FindAllString(sqlBody, -1)
}

func sortedKeys(set map[string]bool) []string {
	out := make([]string, 0, len(set))
	for k := range set {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

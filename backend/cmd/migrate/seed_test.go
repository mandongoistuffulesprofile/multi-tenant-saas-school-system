package main

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/ledger"
)

const seedDir = "../../../migrations/seed"

// The demo seed's chart of accounts is generated SQL, not hand-written: the
// definition lives in internal/ledger, where the onboarding wizard also reads
// it. This fails when the committed file is stale, so adding an account in Go
// cannot leave the seed behind.
func TestSeedLedgerAccountsAreGeneratedFromTheChart(t *testing.T) {
	path := filepath.Join(seedDir, "0002_ledger_accounts.sql")
	committed, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	if string(committed) != ledger.SeedSQL() {
		t.Fatalf("%s is out of date with internal/ledger.BaselineChart;\n"+
			"regenerate it with: cd backend && go run ./cmd/genseed", path)
	}
}

// A freshly migrated-and-seeded database must be able to post an in-kind
// intake. That posting debits INV_FOOD and credits FEE_RECEIVABLE, and without
// those rows the service refuses with "chart of accounts has no INV_FOOD
// account". The required codes are derived from the backend and the chart, not
// from a third hand-kept list here.
func TestSeedSeedsEveryLedgerAccountTheBackendLooksUp(t *testing.T) {
	seeded := seededLedgerCodes(t)

	required := map[string]bool{}
	for _, account := range ledger.BaselineChart {
		required[account.Code] = true
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
	files, err := filepath.Glob(filepath.Join(seedDir, "*.sql"))
	if err != nil || len(files) == 0 {
		t.Fatalf("no seed files found: %v", err)
	}
	codes := map[string]bool{}
	for _, path := range files {
		body, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		for _, stmt := range ledgerInsert.FindAllString(string(body), -1) {
			for _, m := range ledgerCodeValue.FindAllStringSubmatch(stmt, -1) {
				codes[m[1]] = true
			}
		}
	}
	return codes
}

// lookedUpLedgerCodes finds the codes the backend resolves by name, e.g.
// `AND la.code = 'INV_FOOD'`, in queries issued against ledger_accounts.
func lookedUpLedgerCodes(t *testing.T) map[string]bool {
	t.Helper()
	codes := map[string]bool{}
	err := filepath.Walk(filepath.Join("..", ".."), func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() || !strings.HasSuffix(path, ".go") ||
			strings.HasSuffix(path, "_test.go") {
			return err
		}
		body, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		// Only lookups issued against ledger_accounts: `code` columns exist on
		// fee categories too (TUITION, TRANSPORT), which are not accounts.
		for _, query := range goStringLiterals(string(body)) {
			if !strings.Contains(query, "ledger_accounts") {
				continue
			}
			for _, m := range ledgerLookup.FindAllStringSubmatch(query, -1) {
				codes[m[1]] = true
			}
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
	goStringLiteral = regexp.MustCompile("(?s)`[^`]*`")
)

// goStringLiterals returns the raw strings in a Go file, which is where the SQL
// lives.
func goStringLiterals(body string) []string {
	return goStringLiteral.FindAllString(body, -1)
}

func sortedKeys(set map[string]bool) []string {
	out := make([]string, 0, len(set))
	for k := range set {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

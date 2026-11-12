package platform

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
)

// These tests exercise the setup writes that back the resumable wizard. They
// use a migrated, disposable database from TEST_DATABASE_URL and are skipped
// otherwise, matching the rest of the repository's DB-backed tests.

func setupTestHandler(t *testing.T) (*Handler, string) {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	database, err := db.Connect(url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })

	h := NewHandler(NewService(database, nil))
	tenantID := fmt.Sprintf("setup-test-%d", time.Now().UnixNano())

	if err := h.withTenantTx(context.Background(), tenantID, "", func(tx *sql.Tx) error {
		_, err := tx.ExecContext(context.Background(),
			`INSERT INTO schools (tenant_id, school_name, subdomain) VALUES ($1,$2,$3)`,
			tenantID, "Setup Test School", tenantID)
		return err
	}); err != nil {
		t.Fatalf("create tenant: %v", err)
	}

	// Grades are global reference data; the demo seed creates them in a seeded
	// database but a bare migrated database has none.
	if err := h.withTenantTx(context.Background(), tenantID, "", func(tx *sql.Tx) error {
		_, err := tx.ExecContext(context.Background(),
			`INSERT INTO grades (grade_id, grade_label, level_band, lessons_per_week) VALUES
			 ('PP1','PP1','EYE',25),
			 ('G1','Grade 1','LOWER_PRIMARY',31),
			 ('G2','Grade 2','LOWER_PRIMARY',31)
			 ON CONFLICT (grade_id) DO NOTHING`)
		return err
	}); err != nil {
		t.Fatalf("seed grades: %v", err)
	}

	return h, tenantID
}

func inSetupTenant(t *testing.T, h *Handler, tenantID string, fn func(*sql.Tx) error) {
	t.Helper()
	if err := h.withTenantTx(context.Background(), tenantID, "", fn); err != nil {
		t.Fatalf("tenant tx: %v", err)
	}
}

func setupCount(t *testing.T, h *Handler, tenantID, query string, args ...any) int {
	t.Helper()
	var n int
	inSetupTenant(t, h, tenantID, func(tx *sql.Tx) error {
		return tx.QueryRowContext(context.Background(), query, args...).Scan(&n)
	})
	return n
}

func setupString(t *testing.T, h *Handler, tenantID, query string, args ...any) string {
	t.Helper()
	var s sql.NullString
	inSetupTenant(t, h, tenantID, func(tx *sql.Tx) error {
		return tx.QueryRowContext(context.Background(), query, args...).Scan(&s)
	})
	return s.String
}

func TestApplyCalendarIsIdempotent(t *testing.T) {
	h, tenantID := setupTestHandler(t)

	req := setupCalendarRequest{
		YearLabel:  "2031",
		StartDate:  "2031-01-05",
		EndDate:    "2031-11-30",
		SetCurrent: true,
		Terms: []setupTerm{
			{TermName: "Term 1", StartDate: "2031-01-05", EndDate: "2031-04-10"},
			{TermName: "Term 2", StartDate: "2031-05-05", EndDate: "2031-08-10"},
			{TermName: "Term 3", StartDate: "2031-09-01", EndDate: "2031-11-30"},
		},
	}

	apply := func(r setupCalendarRequest) string {
		t.Helper()
		yearID := ""
		inSetupTenant(t, h, tenantID, func(tx *sql.Tx) error {
			var err error
			yearID, err = h.applyCalendar(context.Background(), tx, tenantID, r)
			return err
		})
		if yearID == "" {
			t.Fatal("applyCalendar returned an empty year id")
		}
		return yearID
	}

	yearID := apply(req)
	apply(req)

	if got := setupCount(t, h, tenantID, `SELECT count(*) FROM academic_years WHERE tenant_id=$1`, tenantID); got != 1 {
		t.Fatalf("academic years after two saves = %d, want 1", got)
	}
	if got := setupCount(t, h, tenantID, `SELECT count(*) FROM terms WHERE tenant_id=$1 AND year_id=$2`, tenantID, yearID); got != 3 {
		t.Fatalf("terms after two saves = %d, want 3", got)
	}

	// Editing a saved term must update it, not append another copy.
	req.Terms[1].StartDate = "2031-05-12"
	req.EndDate = "2031-12-05"
	apply(req)

	if got := setupCount(t, h, tenantID, `SELECT count(*) FROM terms WHERE tenant_id=$1 AND year_id=$2`, tenantID, yearID); got != 3 {
		t.Fatalf("terms after an edit = %d, want 3", got)
	}
	if got := setupString(t, h, tenantID,
		`SELECT start_date::text FROM terms WHERE tenant_id=$1 AND year_id=$2 AND term_number=2`, tenantID, yearID); got != "2031-05-12" {
		t.Fatalf("term 2 start = %q, want 2031-05-12", got)
	}
	if got := setupString(t, h, tenantID,
		`SELECT end_date::text FROM academic_years WHERE tenant_id=$1 AND year_id=$2`, tenantID, yearID); got != "2031-12-05" {
		t.Fatalf("year end = %q, want 2031-12-05", got)
	}

	// Kenya has exactly three terms.
	tooMany := req
	tooMany.Terms = append(tooMany.Terms, setupTerm{TermName: "Term 4", StartDate: "2031-12-06", EndDate: "2031-12-20"})
	inSetupTenant(t, h, tenantID, func(tx *sql.Tx) error {
		if _, err := h.applyCalendar(context.Background(), tx, tenantID, tooMany); err == nil {
			t.Error("expected an error for a fourth term")
		}
		return nil
	})
}

func TestApplyStructureIsIdempotent(t *testing.T) {
	h, tenantID := setupTestHandler(t)

	inSetupTenant(t, h, tenantID, func(tx *sql.Tx) error {
		_, err := h.applyCalendar(context.Background(), tx, tenantID, setupCalendarRequest{
			YearLabel:  "2032",
			StartDate:  "2032-01-05",
			EndDate:    "2032-11-30",
			SetCurrent: true,
			Terms: []setupTerm{
				{TermName: "Term 1", StartDate: "2032-01-05", EndDate: "2032-04-10"},
			},
		})
		return err
	})

	req := setupStructureRequest{
		Streams: []string{"A", "B"},
		ClassGroups: []setupClassGroup{
			{GradeID: "G1", StreamName: "A"},
			{GradeID: "G1", StreamName: "B"},
			{GradeID: "G2", StreamName: "A"},
			{GradeID: "G2", StreamName: "B"},
		},
	}
	apply := func(r setupStructureRequest) {
		t.Helper()
		inSetupTenant(t, h, tenantID, func(tx *sql.Tx) error {
			return h.applyStructure(context.Background(), tx, tenantID, r)
		})
	}

	apply(req)
	apply(req)

	if got := setupCount(t, h, tenantID, `SELECT count(*) FROM streams WHERE tenant_id=$1`, tenantID); got != 2 {
		t.Fatalf("streams after two saves = %d, want 2", got)
	}
	if got := setupCount(t, h, tenantID, `SELECT count(*) FROM class_groups WHERE tenant_id=$1`, tenantID); got != 4 {
		t.Fatalf("class groups after two saves = %d, want 4", got)
	}

	// Saving again (even with a narrower selection) must not add duplicates.
	apply(setupStructureRequest{Streams: []string{"A", "B"}, ClassGroups: []setupClassGroup{{GradeID: "G1", StreamName: "A"}}})
	if got := setupCount(t, h, tenantID, `SELECT count(*) FROM class_groups WHERE tenant_id=$1`, tenantID); got != 4 {
		t.Fatalf("class groups after a third save = %d, want 4", got)
	}

	// A single-stream school has class groups with no stream; the baseline made
	// stream_id NOT NULL, so this also covers the migration's nullability fix.
	apply(setupStructureRequest{ClassGroups: []setupClassGroup{{GradeID: "PP1", StreamName: ""}}})
	apply(setupStructureRequest{ClassGroups: []setupClassGroup{{GradeID: "PP1", StreamName: ""}}})

	if got := setupCount(t, h, tenantID,
		`SELECT count(*) FROM class_groups WHERE tenant_id=$1 AND grade_id='PP1' AND stream_id IS NULL`, tenantID); got != 1 {
		t.Fatalf("unstreamed PP1 class groups = %d, want 1", got)
	}
}

func TestApplyFinanceIsIdempotent(t *testing.T) {
	h, tenantID := setupTestHandler(t)

	inSetupTenant(t, h, tenantID, func(tx *sql.Tx) error {
		_, err := h.applyCalendar(context.Background(), tx, tenantID, setupCalendarRequest{
			YearLabel:  "2033",
			StartDate:  "2033-01-05",
			EndDate:    "2033-11-30",
			SetCurrent: true,
			Terms: []setupTerm{
				{TermName: "Term 1", StartDate: "2033-01-05", EndDate: "2033-04-10"},
			},
		})
		return err
	})

	paybill := fmt.Sprintf("%09d", time.Now().UnixNano()%900000000+100000)
	req := setupFinanceRequest{
		Categories: []setupFinanceCategory{{Name: "Tuition", Code: "TUITION", IsMandatory: true}},
		Structures: []setupFinanceStructure{
			{GradeID: "G1", Amount: 7500},
			{GradeID: "G2", Amount: 7500},
		},
		Channels: []setupFinanceChannel{{
			ChannelType:        "PAYBILL",
			ShortcodeOrAccount: paybill,
			Label:              "Main Paybill",
			IsDefault:          true,
		}},
	}

	apply := func(r setupFinanceRequest) {
		t.Helper()
		inSetupTenant(t, h, tenantID, func(tx *sql.Tx) error {
			return h.applyFinance(context.Background(), tx, tenantID, r)
		})
	}

	apply(req)
	categoriesAfterFirst := setupCount(t, h, tenantID, `SELECT count(*) FROM fee_categories WHERE tenant_id=$1`, tenantID)
	apply(req)

	if got := setupCount(t, h, tenantID, `SELECT count(*) FROM fee_structures WHERE tenant_id=$1`, tenantID); got != 2 {
		t.Fatalf("fee structures after two saves = %d, want 2", got)
	}
	if got := setupCount(t, h, tenantID,
		`SELECT count(*) FROM fee_categories WHERE tenant_id=$1 AND upper(code)='TUITION'`, tenantID); got != 1 {
		t.Fatalf("tuition categories after two saves = %d, want 1", got)
	}
	if got := setupCount(t, h, tenantID, `SELECT count(*) FROM fee_categories WHERE tenant_id=$1`, tenantID); got != categoriesAfterFirst {
		t.Fatalf("fee categories after two saves = %d, want %d", got, categoriesAfterFirst)
	}
	if got := setupCount(t, h, tenantID,
		`SELECT count(*) FROM school_payment_channels WHERE tenant_id=$1 AND shortcode_or_account=$2`, tenantID, paybill); got != 1 {
		t.Fatalf("payment channels after two saves = %d, want 1", got)
	}

	// A corrected amount must replace the saved one.
	req.Structures = []setupFinanceStructure{
		{GradeID: "G1", Amount: 9000},
		{GradeID: "G2", Amount: 9000},
	}
	apply(req)

	if got := setupCount(t, h, tenantID, `SELECT count(*) FROM fee_structures WHERE tenant_id=$1`, tenantID); got != 2 {
		t.Fatalf("fee structures after editing the amount = %d, want 2", got)
	}
	if got := setupCount(t, h, tenantID,
		`SELECT count(*) FROM fee_structures WHERE tenant_id=$1 AND amount_per_term=9000 AND amount_per_year=9000`, tenantID); got != 2 {
		t.Fatalf("fee structures with the edited amount = %d, want 2", got)
	}
}

// TestSetupSaveUniquenessIndexes guards the migration: without these indexes the
// ON CONFLICT clauses in applyCalendar/applyStructure/applyFinance fail at
// runtime, which is how the duplicate rows were possible in the first place.
func TestSetupSaveUniquenessIndexes(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	database, err := db.Connect(url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer database.Close()

	want := []string{
		"uq_academic_years_tenant_label",
		"uq_terms_tenant_year_number",
		"uq_class_groups_tenant_year_grade_stream",
		"uq_fee_categories_tenant_code",
		"uq_fee_structures_tenant_year_grade_category",
	}
	for _, name := range want {
		var exists bool
		if err := database.QueryRow(
			`SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname=$1)`,
			name).Scan(&exists); err != nil {
			t.Fatalf("lookup index %s: %v", name, err)
		}
		if !exists {
			t.Errorf("missing unique index %s (migration 0044 not applied?)", name)
		}
	}

	var nullable string
	if err := database.QueryRow(
		`SELECT is_nullable FROM information_schema.columns
		 WHERE table_schema='public' AND table_name='class_groups' AND column_name='stream_id'`).Scan(&nullable); err != nil {
		t.Fatalf("lookup class_groups.stream_id: %v", err)
	}
	if nullable != "YES" {
		t.Errorf("class_groups.stream_id is_nullable = %q, want YES", nullable)
	}
}

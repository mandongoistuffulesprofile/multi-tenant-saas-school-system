package reports

import (
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/grading"
)

// TestBuildSnapshotRollsBack exercises the real snapshot SQL against a
// migrated database inside a transaction that is rolled back. It is skipped
// unless TEST_DATABASE_URL is set, matching the other integration tests.
func TestBuildSnapshotRollsBack(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	database, err := db.Connect(url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer database.Close()

	tenantID := "snapshot-test-" + strconv.FormatInt(time.Now().UnixNano(), 10)
	tx, err := database.BeginTenantTx(tenantID, "")
	if err != nil {
		t.Fatalf("begin tenant tx: %v", err)
	}
	defer tx.Rollback()

	mustExec := func(query string, args ...interface{}) {
		t.Helper()
		if _, err := tx.Exec(query, args...); err != nil {
			t.Fatalf("exec %q: %v", query, err)
		}
	}

	var tenantContext string
	if err := tx.QueryRow(`SELECT current_tenant_id()`).Scan(&tenantContext); err != nil {
		t.Fatalf("tenant context: %v", err)
	}
	mustExec(`INSERT INTO schools (tenant_id, school_name, subdomain) VALUES ($1, $2, $3)`,
		tenantID, "Snapshot Test School", tenantID)

	var yearID string
	if err := tx.QueryRow(
		`INSERT INTO academic_years (tenant_id, year_label, start_date, end_date)
		 VALUES ($1, '2026', '2026-01-01', '2026-12-31') RETURNING year_id::text`,
		tenantID).Scan(&yearID); err != nil {
		t.Fatalf("academic year: %v", err)
	}
	var termID string
	if err := tx.QueryRow(
		`INSERT INTO terms (tenant_id, year_id, term_number, term_label, start_date, end_date)
		 VALUES ($1, $2, 1, 'Term 1', '2026-01-05', '2026-04-05') RETURNING term_id::text`,
		tenantID, yearID).Scan(&termID); err != nil {
		t.Fatalf("term: %v", err)
	}
	var templateID string
	if err := tx.QueryRow(
		`INSERT INTO report_templates (tenant_id, template_name, template_type, grade_band, template_config)
		 VALUES ($1, 'Termly', 'CBC', 'UPPER_PRIMARY', '{}') RETURNING template_id::text`,
		tenantID).Scan(&templateID); err != nil {
		t.Fatalf("template: %v", err)
	}
	var runID string
	if err := tx.QueryRow(
		`INSERT INTO report_runs (tenant_id, template_id, academic_year_id, term_id, grade_id)
		 VALUES ($1, $2, $3, $4, 'G5') RETURNING run_id::text`,
		tenantID, templateID, yearID, termID).Scan(&runID); err != nil {
		t.Fatalf("run: %v", err)
	}
	var learnerID string
	if err := tx.QueryRow(
		`INSERT INTO learners (tenant_id, admission_number, first_name, last_name)
		 VALUES ($1, 'SNP-001', 'Amina', 'Wanjiku') RETURNING learner_id::text`,
		tenantID).Scan(&learnerID); err != nil {
		t.Fatalf("learner: %v", err)
	}
	var cardID string
	if err := tx.QueryRow(
		`INSERT INTO report_cards (tenant_id, run_id, learner_id, card_number, academic_year_id, term_id, grade_id)
		 VALUES ($1, $2, $3, 'G5-SNP-001', $4, $5, 'G5') RETURNING card_id::text`,
		tenantID, runID, learnerID, yearID, termID).Scan(&cardID); err != nil {
		t.Fatalf("card: %v", err)
	}

	var areaID, strandID, subStrandID string
	if err := tx.QueryRow(
		`SELECT area_id::text FROM learning_areas WHERE code = 'MAT' LIMIT 1`).Scan(&areaID); err != nil {
		t.Fatalf("learning area: %v", err)
	}
	if err := tx.QueryRow(
		`SELECT substrand.sub_strand_id::text, substrand.strand_id::text
		 FROM sub_strands substrand
		 JOIN strands strand ON strand.strand_id = substrand.strand_id
		 WHERE strand.area_id = $1 LIMIT 1`, areaID).Scan(&subStrandID, &strandID); err != nil {
		t.Fatalf("sub-strand: %v", err)
	}

	var eventID string
	if err := tx.QueryRow(
		`INSERT INTO assessment_events
		 (tenant_id, term_id, grade_id, learning_area_id, assessment_type, scoring_mode, assessment_window)
		 VALUES ($1, $2, 'G5', $3, 'SUMMATIVE', 'RUBRIC', 'TERM_1') RETURNING event_id::text`,
		tenantID, termID, areaID).Scan(&eventID); err != nil {
		t.Fatalf("event: %v", err)
	}
	mustExec(
		`INSERT INTO assessment_results
		 (tenant_id, event_id, learner_id, sub_strand_id, level_code, points, raw_score, max_score, state)
		 VALUES ($1, $2, $3, $4, 'ME1', 6, 62, 100, 'PUBLISHED')`,
		tenantID, eventID, learnerID, subStrandID)
	mustExec(
		`INSERT INTO report_card_comments (tenant_id, card_id, learning_area_id, comment_text)
		 VALUES ($1, $2, $3, 'Good progress in fractions')`,
		tenantID, cardID, areaID)
	mustExec(
		`INSERT INTO national_assessment_results
		 (tenant_id, learner_id, assessment_type, assessment_year, learning_area_id, raw_band, points)
		 VALUES ($1, $2, 'KPSEA', 2026, $3, 'ME', NULL)`,
		tenantID, learnerID, areaID)

	cfg := grading.DefaultConfig()
	snapshot, err := BuildSnapshot(tx.Tx, tenantID, cardID, cfg, 1)
	if err != nil {
		t.Fatalf("build snapshot: %v", err)
	}
	if len(snapshot.Areas) != 1 {
		t.Fatalf("areas = %d, want 1", len(snapshot.Areas))
	}
	area := snapshot.Areas[0]
	if area.LevelCode != "ME1" || area.Points != 6 {
		t.Fatalf("headline = %s/%d, want ME1/6", area.LevelCode, area.Points)
	}
	if area.Comment == "" {
		t.Fatal("teacher comment missing from snapshot")
	}
	if snapshot.Aggregate != nil {
		t.Fatal("aggregate must be absent by default")
	}
	if len(snapshot.National) != 1 || snapshot.National[0].RawBand != "ME" {
		t.Fatalf("national = %+v, want one ME row", snapshot.National)
	}

	cfg.ShowAggregate = true
	withAggregate, err := BuildSnapshot(tx.Tx, tenantID, cardID, cfg, 2)
	if err != nil {
		t.Fatalf("build snapshot with aggregate: %v", err)
	}
	if withAggregate.Aggregate == nil {
		t.Fatal("aggregate missing when enabled")
	}
	if withAggregate.Aggregate.Points != 6 || withAggregate.Aggregate.MaxPoints != 8 {
		t.Fatalf("aggregate = %d/%d, want 6/8",
			withAggregate.Aggregate.Points, withAggregate.Aggregate.MaxPoints)
	}
	if withAggregate.Aggregate.Grade != "EE2" {
		t.Fatalf("aggregate grade = %s, want EE2 at 75%%", withAggregate.Aggregate.Grade)
	}
}

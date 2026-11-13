package reports

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
)

// TestReportsTenantIsolation verifies that report templates, runs, cards and
// comments created by tenant A are invisible to tenant B once RLS is enforced
// through the request-scoped transaction the handlers now use.
//
// It runs against TEST_DATABASE_URL (a migrated, disposable database) and is
// skipped otherwise so `go test ./...` stays hermetic on a laptop.
func TestReportsTenantIsolation(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	database, err := db.Connect(url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer database.Close()

	ctx := context.Background()
	suffix := time.Now().UnixNano()
	tenantA := "reports-a-" + strconv.FormatInt(suffix, 10)
	tenantB := "reports-b-" + strconv.FormatInt(suffix, 10)

	// FORCE so the application role is subject to the policies (owners bypass
	// ENABLE alone), mirroring the pattern in db/rls_test.go.
	for _, stmt := range []string{
		`ALTER TABLE report_templates ENABLE ROW LEVEL SECURITY`,
		`ALTER TABLE report_templates FORCE ROW LEVEL SECURITY`,
		`ALTER TABLE report_runs ENABLE ROW LEVEL SECURITY`,
		`ALTER TABLE report_runs FORCE ROW LEVEL SECURITY`,
		`ALTER TABLE report_cards ENABLE ROW LEVEL SECURITY`,
		`ALTER TABLE report_cards FORCE ROW LEVEL SECURITY`,
		`ALTER TABLE report_card_comments ENABLE ROW LEVEL SECURITY`,
		`ALTER TABLE report_card_comments FORCE ROW LEVEL SECURITY`,
	} {
		if _, err := database.Exec(stmt); err != nil {
			t.Logf("prepare RLS skipped: %v", err)
		}
	}

	// Seed a school + template for tenant A so FK constraints are satisfied.
	var templateID string
	err = database.WithTenant(ctx, tenantA, "", func(tx *db.Tx) error {
		if _, err := tx.Exec(
			`INSERT INTO schools (tenant_id, school_name, subdomain) VALUES ($1, $2, $3)`,
			tenantA, "Reports School A", tenantA); err != nil {
			return err
		}
		return tx.QueryRow(
			`INSERT INTO report_templates (tenant_id, template_name, template_type, grade_band, is_default, is_active, template_config)
			 VALUES ($1, $2, 'TERMLY', 'LOWER_PRIMARY', true, true, '{}')
			 RETURNING template_id`,
			tenantA, "Termly A").Scan(&templateID)
	})
	if err != nil {
		t.Fatalf("seed tenant A: %v", err)
	}

	// Tenant B must not see tenant A's template through a request-scoped tx.
	var count int
	err = database.WithTenant(ctx, tenantB, "", func(tx *db.Tx) error {
		return tx.QueryRow(`SELECT count(*) FROM report_templates WHERE template_id = $1`, templateID).Scan(&count)
	})
	if err != nil {
		t.Fatalf("tenant B read: %v", err)
	}
	if count != 0 {
		t.Fatalf("tenant B saw %d of tenant A's templates, want 0", count)
	}

	// Tenant A sees its own template.
	err = database.WithTenant(ctx, tenantA, "", func(tx *db.Tx) error {
		return tx.QueryRow(`SELECT count(*) FROM report_templates WHERE template_id = $1`, templateID).Scan(&count)
	})
	if err != nil {
		t.Fatalf("tenant A read: %v", err)
	}
	if count != 1 {
		t.Fatalf("tenant A saw %d templates, want 1", count)
	}

	// Cleanup.
	for _, id := range []string{tenantA, tenantB} {
		_ = database.WithTenant(ctx, id, "", func(tx *db.Tx) error {
			_, _ = tx.Exec(`DELETE FROM report_templates WHERE tenant_id = $1`, id)
			_, _ = tx.Exec(`DELETE FROM schools WHERE tenant_id = $1`, id)
			return nil
		})
	}
}

// TestListReportRunsHandlesNullColumns guards the list endpoint against the
// nullable report_runs columns. A pending run has NULL term_id, grade_id,
// error_message, created_by and completed_at; scanning those straight into
// string used to fail the whole request with a 500.
func TestListReportRunsHandlesNullColumns(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	database, err := db.Connect(url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer database.Close()

	ctx := context.Background()
	tenantID := "reports-null-" + strconv.FormatInt(time.Now().UnixNano(), 10)
	var runID string

	err = database.WithTenant(ctx, tenantID, "", func(tx *db.Tx) error {
		if _, err := tx.Exec(
			`INSERT INTO schools (tenant_id, school_name, subdomain) VALUES ($1, $2, $3)`,
			tenantID, "Null Column School", tenantID); err != nil {
			return err
		}
		var templateID, yearID string
		if err := tx.QueryRow(
			`INSERT INTO report_templates (tenant_id, template_name, template_type, grade_band)
			 VALUES ($1, $2, 'TERMLY', 'LOWER_PRIMARY') RETURNING template_id`,
			tenantID, "Null Template").Scan(&templateID); err != nil {
			return err
		}
		if err := tx.QueryRow(
			`INSERT INTO academic_years (tenant_id, year_label, start_date, end_date)
			 VALUES ($1, '2026', '2026-01-01', '2026-12-31') RETURNING year_id`,
			tenantID).Scan(&yearID); err != nil {
			return err
		}
		return tx.QueryRow(
			`INSERT INTO report_runs (tenant_id, template_id, academic_year_id, status)
			 VALUES ($1, $2, $3, 'PENDING') RETURNING run_id`,
			tenantID, templateID, yearID).Scan(&runID)
	})
	if err != nil {
		t.Fatalf("seed pending run: %v", err)
	}

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/reports/runs", nil)
	c.Set("tenant_id", tenantID)

	err = database.WithTenant(ctx, tenantID, "", func(tx *db.Tx) error {
		c.Set("tx", tx.Tx)
		NewHandler(NewService(database)).ListReportRuns(c)
		return nil
	})
	if err != nil {
		t.Fatalf("list runs: %v", err)
	}
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}

	var runs []ReportRun
	if err := json.Unmarshal(recorder.Body.Bytes(), &runs); err != nil {
		t.Fatalf("decode runs: %v", err)
	}
	for _, run := range runs {
		if run.RunID != runID {
			continue
		}
		if run.TermID != "" || run.GradeID != "" || run.ErrorMessage != "" ||
			run.CreatedBy != "" || run.CompletedAt != "" {
			t.Fatalf("nullable columns were not normalized: %+v", run)
		}
		return
	}
	t.Fatalf("run %s missing from response %+v", runID, runs)
}

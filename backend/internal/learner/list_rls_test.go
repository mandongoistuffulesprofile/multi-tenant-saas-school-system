package learner

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
)

// TestListLearnersUsesTenantTransaction is the regression test for a real
// incident: ListLearners queried the connection pool instead of the request's
// tenant transaction, so row-level security had no tenant context and the
// endpoint answered [] for a school that plainly had learners. The roll looked
// empty rather than broken, which is the worst failure mode for a picker or a
// register.
//
// The fixture proves both halves of the contract: a pool-level read with no
// tenant context sees nothing, and the handler — given the same request-scoped
// transaction the TenantTxMiddleware opens — returns the learner.
//
// It needs TEST_DATABASE_URL (a migrated, disposable database) and is skipped
// otherwise, like the other RLS tests in this repo.
func TestListLearnersUsesTenantTransaction(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	database, err := db.Connect(url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer database.Close()

	tenantID := fmt.Sprintf("learner-list-%d", time.Now().UnixNano())
	admission := "LR-" + fmt.Sprint(time.Now().UnixNano()%1000000)
	create := func(tx *db.Tx) error {
		if _, err := tx.Exec(
			`INSERT INTO schools (tenant_id, school_name, subdomain) VALUES ($1, $2, $3)`,
			tenantID, "Learner List School", tenantID,
		); err != nil {
			return err
		}
		_, err := tx.Exec(
			`INSERT INTO learners (tenant_id, admission_number, first_name, last_name)
			 VALUES ($1, $2, 'Rls', 'Learner')`,
			tenantID, admission,
		)
		return err
	}
	if err := database.WithTenant(t.Context(), tenantID, "", create); err != nil {
		t.Fatalf("create fixture: %v", err)
	}
	t.Cleanup(func() {
		_ = database.WithTenant(t.Context(), tenantID, "", func(tx *db.Tx) error {
			_, _ = tx.Exec(`DELETE FROM learners WHERE tenant_id = $1`, tenantID)
			_, _ = tx.Exec(`DELETE FROM schools WHERE tenant_id = $1`, tenantID)
			return nil
		})
	})

	// Premise check: without a tenant context the pool sees zero rows. If this
	// fails the fixture is not exercising RLS and the test would pass vacuously.
	var poolCount int
	if err := database.QueryRow(
		`SELECT count(*) FROM learners WHERE tenant_id = $1`, tenantID,
	).Scan(&poolCount); err != nil {
		t.Fatalf("pool count: %v", err)
	}
	if poolCount != 0 {
		t.Fatalf("fixture is not under RLS: pool read saw %d learners without a tenant context", poolCount)
	}

	// A request-scoped tenant transaction, as TenantTxMiddleware would open it.
	tenantTx, err := database.BeginTenantTx(tenantID, "")
	if err != nil {
		t.Fatalf("begin tenant tx: %v", err)
	}
	defer tenantTx.Rollback()

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/learners?limit=200", nil)
	c.Set("tenant_id", tenantID)
	c.Set("tx", tenantTx.Tx)

	NewHandler(NewService(database)).ListLearners(c)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var learners []learnerView
	if err := json.Unmarshal(recorder.Body.Bytes(), &learners); err != nil {
		t.Fatalf("decode body %q: %v", recorder.Body.String(), err)
	}
	if len(learners) != 1 {
		t.Fatalf("got %d learners through the tenant transaction, want 1 (a pool query returns 0)", len(learners))
	}
	if learners[0].AdmissionNumber != admission {
		t.Fatalf("admission number = %q, want %q", learners[0].AdmissionNumber, admission)
	}
	if learners[0].TenantID != tenantID {
		t.Fatalf("tenant = %q, want %q", learners[0].TenantID, tenantID)
	}
}

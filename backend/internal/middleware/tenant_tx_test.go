package middleware

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
	_ "github.com/lib/pq"
)

// The suspension gate must never answer "active" when it does not know. These
// tests cover the two ways it could not know — no cache at all, and a status it
// cannot read — and prove both refuse the request instead of letting it through.

func gateTestRouter(database *sqlx.DB, tenantID string) (*gin.Engine, *bool) {
	reached := false
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set(ContextTenantID, tenantID)
		c.Next()
	})
	r.Use(TenantTxMiddleware(database, nil))
	r.GET("/probe", func(c *gin.Context) {
		reached = true
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})
	return r, &reached
}

func decodeResponse(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode %q: %v", w.Body.String(), err)
	}
	return body
}

func middlewareTestDB(t *testing.T) *sqlx.DB {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	database, err := sqlx.Open("postgres", url)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if err := database.Ping(); err != nil {
		database.Close()
		t.Fatalf("ping: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	return database
}

// createSchool writes the fixture inside the tenant's own RLS context, which is
// the only way the policy lets a row for that tenant in.
func createSchool(t *testing.T, database *sqlx.DB, tenantID, status string) {
	t.Helper()
	tx, err := database.Beginx()
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`SELECT set_config('app.current_tenant_id', $1, true)`, tenantID); err != nil {
		t.Fatalf("tenant context: %v", err)
	}
	if _, err := tx.Exec(
		`INSERT INTO schools (tenant_id, school_name, subdomain, status) VALUES ($1, $2, $3, $4)`,
		tenantID, "Middleware Gate School", tenantID, status); err != nil {
		t.Fatalf("create school: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit: %v", err)
	}
	t.Cleanup(func() {
		cleanup, err := database.Beginx()
		if err != nil {
			return
		}
		defer cleanup.Rollback()
		_, _ = cleanup.Exec(`SELECT set_config('app.current_tenant_id', $1, true)`, tenantID)
		_, _ = cleanup.Exec(`DELETE FROM schools WHERE tenant_id = $1`, tenantID)
		_ = cleanup.Commit()
	})
}

func TestTenantTxMiddlewareBlocksSuspendedTenantWithoutCache(t *testing.T) {
	database := middlewareTestDB(t)
	tenantID := fmt.Sprintf("mw-sus-%d", time.Now().UnixNano()%1e9)
	createSchool(t, database, tenantID, "SUSPENDED")

	// nil redis: the gate has to consult the database, not skip the check.
	router, reached := gateTestRouter(database, tenantID)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/probe", nil))

	if w.Code != http.StatusForbidden {
		t.Fatalf("got %d, want 403: %s", w.Code, w.Body.String())
	}
	if body := decodeResponse(t, w); body["code"] != "TENANT_SUSPENDED" {
		t.Fatalf("code is %v, want TENANT_SUSPENDED", body["code"])
	}
	if *reached {
		t.Fatal("a suspended tenant reached the handler")
	}
}

func TestTenantTxMiddlewareLetsAnActiveTenantThrough(t *testing.T) {
	database := middlewareTestDB(t)
	tenantID := fmt.Sprintf("mw-act-%d", time.Now().UnixNano()%1e9)
	createSchool(t, database, tenantID, "ACTIVE")

	router, reached := gateTestRouter(database, tenantID)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/probe", nil))

	if w.Code != http.StatusOK {
		t.Fatalf("got %d, want 200: %s", w.Code, w.Body.String())
	}
	if !*reached {
		t.Fatal("an active tenant did not reach the handler")
	}
}

func TestTenantTxMiddlewareRefusesWhenTheStatusIsUnknown(t *testing.T) {
	database := middlewareTestDB(t)
	tenantID := fmt.Sprintf("mw-miss-%d", time.Now().UnixNano()%1e9)
	// No schools row: the gate cannot establish the status.

	router, reached := gateTestRouter(database, tenantID)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/probe", nil))

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("got %d, want 503: %s", w.Code, w.Body.String())
	}
	if body := decodeResponse(t, w); body["code"] != "TENANT_STATUS_UNAVAILABLE" {
		t.Fatalf("code is %v, want TENANT_STATUS_UNAVAILABLE", body["code"])
	}
	if *reached {
		t.Fatal("a request with an unknown tenant status reached the handler")
	}
}

func TestTenantTxMiddlewareRefusesWhenTheDatabaseCannotBeRead(t *testing.T) {
	// A pool pointed at a port nothing listens on: every read fails. Both Redis
	// and the database are therefore unusable, which is the case that used to be
	// answered as "active".
	unreachable, err := sqlx.Open("postgres", "postgres://nobody:nothing@127.0.0.1:1/none?sslmode=disable&connect_timeout=1")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer unreachable.Close()

	router, reached := gateTestRouter(unreachable, "mw-unreachable")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/probe", nil))

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("got %d, want 503: %s", w.Code, w.Body.String())
	}
	if body := decodeResponse(t, w); body["code"] != "TENANT_STATUS_UNAVAILABLE" {
		t.Fatalf("code is %v, want TENANT_STATUS_UNAVAILABLE", body["code"])
	}
	if *reached {
		t.Fatal("a request with no reachable database reached the handler")
	}
}

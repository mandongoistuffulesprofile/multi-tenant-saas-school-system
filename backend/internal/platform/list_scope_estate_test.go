package platform

import (
	"context"
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

// ListPlatformInvoices, ListTenantUsage and ListExports were fixed alongside
// ListSubscriptions: they now read the whole estate instead of filtering by the
// caller's tenant. Only ListSubscriptions had a test, so this covers the other
// three against two seeded tenants.
func TestPlatformListsCoverEveryTenant(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	database, err := db.Connect(url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer database.Close()

	suffix := time.Now().UnixNano() % 1e9
	tenantA := fmt.Sprintf("estate-a-%d", suffix)
	tenantB := fmt.Sprintf("estate-b-%d", suffix)

	tx, err := database.BeginTxx(context.Background(), nil)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	// Rolls back every fixture row, so the test leaves the estate as it found it.
	defer tx.Rollback()
	for _, stmt := range []string{
		"SELECT set_config('app.current_user_role', 'SAAS_ADMIN', true)",
		"SELECT set_config('app.current_tenant_id', '" + tenantA + "', true)",
	} {
		if _, err := tx.Exec(stmt); err != nil {
			t.Fatalf("context: %v", err)
		}
	}

	for _, tenant := range []string{tenantA, tenantB} {
		if _, err := tx.Exec(
			`INSERT INTO schools (tenant_id, school_name, subdomain) VALUES ($1, $2, $3)`,
			tenant, "Estate "+tenant, tenant); err != nil {
			t.Fatalf("create school %s: %v", tenant, err)
		}
		if _, err := tx.Exec(
			`INSERT INTO platform_invoices (tenant_id, invoice_number, amount, status, issue_date)
			 VALUES ($1, $2, 1500.00, 'ISSUED', CURRENT_DATE)`,
			tenant, "SCOPE-"+tenant); err != nil {
			t.Fatalf("create platform invoice %s: %v", tenant, err)
		}
		if _, err := tx.Exec(
			`INSERT INTO tenant_usage (tenant_id, period_month, active_learners)
			 VALUES ($1, '2026-11', 1)`,
			tenant); err != nil {
			t.Fatalf("create tenant usage %s: %v", tenant, err)
		}
		if _, err := tx.Exec(
			`INSERT INTO exports (tenant_id, export_type, status, record_count)
			 VALUES ($1, 'LEARNERS', 'COMPLETED', 1)`,
			tenant); err != nil {
			t.Fatalf("create export %s: %v", tenant, err)
		}
	}

	h := NewHandler(NewService(database, nil))
	gin.SetMode(gin.TestMode)

	call := func(handler func(*gin.Context)) []byte {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/platform/list", nil)
		// A platform request carries no school tenant and must not be limited to
		// one either.
		c.Set("tenant_id", "")
		c.Set("tx", tx)
		handler(c)
		if w.Code != http.StatusOK {
			t.Fatalf("got %d, want 200: %s", w.Code, w.Body.String())
		}
		return w.Body.Bytes()
	}

	assertBoth := func(name string, body []byte, tenantOf func([]byte) ([]string, error)) {
		tenants, err := tenantOf(body)
		if err != nil {
			t.Fatalf("%s: decode %q: %v", name, body, err)
		}
		seen := map[string]bool{}
		for _, tenant := range tenants {
			seen[tenant] = true
		}
		if !seen[tenantA] || !seen[tenantB] {
			t.Fatalf("%s listed %v, want both %s and %s", name, seen, tenantA, tenantB)
		}
	}

	t.Run("invoices", func(t *testing.T) {
		body := call(h.ListPlatformInvoices)
		assertBoth("invoices", body, func(raw []byte) ([]string, error) {
			var rows []PlatformInvoice
			if err := json.Unmarshal(raw, &rows); err != nil {
				return nil, err
			}
			tenants := make([]string, 0, len(rows))
			for _, row := range rows {
				tenants = append(tenants, row.TenantID)
			}
			return tenants, nil
		})
	})

	t.Run("usage", func(t *testing.T) {
		body := call(h.ListTenantUsage)
		assertBoth("usage", body, func(raw []byte) ([]string, error) {
			var rows []TenantUsage
			if err := json.Unmarshal(raw, &rows); err != nil {
				return nil, err
			}
			tenants := make([]string, 0, len(rows))
			for _, row := range rows {
				tenants = append(tenants, row.TenantID)
			}
			return tenants, nil
		})
	})

	t.Run("exports", func(t *testing.T) {
		body := call(h.ListExports)
		assertBoth("exports", body, func(raw []byte) ([]string, error) {
			var rows []Export
			if err := json.Unmarshal(raw, &rows); err != nil {
				return nil, err
			}
			tenants := make([]string, 0, len(rows))
			for _, row := range rows {
				tenants = append(tenants, row.TenantID)
			}
			return tenants, nil
		})
	})
}

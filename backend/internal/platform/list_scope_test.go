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

// A platform list answers the whole estate. Filtering these four handlers by the
// caller's tenant made `/platform/subscriptions`, `/platform/invoices`,
// `/platform/usage` and `/platform/exports` show one tenant's rows — which on a
// platform desk looks like an empty screen, not a scoping bug.
func TestListSubscriptionsCoversEveryTenant(t *testing.T) {
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
	tenantA := fmt.Sprintf("scope-a-%d", suffix)
	tenantB := fmt.Sprintf("scope-b-%d", suffix)

	tx, err := database.BeginTxx(context.Background(), nil)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback()
	for _, stmt := range []string{
		"SELECT set_config('app.current_user_role', 'SAAS_ADMIN', true)",
		"SELECT set_config('app.current_tenant_id', '" + tenantA + "', true)",
	} {
		if _, err := tx.Exec(stmt); err != nil {
			t.Fatalf("context: %v", err)
		}
	}

	var planID string
	if err := tx.QueryRow(
		`INSERT INTO plans (plan_code, name, price_monthly, price_yearly, max_learners, max_staff)
		 VALUES ($1, 'Scope Test', 0, 0, 10, 10) RETURNING plan_id`,
		fmt.Sprintf("scope-%d", suffix)).Scan(&planID); err != nil {
		t.Fatalf("create plan: %v", err)
	}
	for _, tenant := range []string{tenantA, tenantB} {
		if _, err := tx.Exec(
			`INSERT INTO schools (tenant_id, school_name, subdomain) VALUES ($1, $2, $3)`,
			tenant, "Scope "+tenant, tenant); err != nil {
			t.Fatalf("create school %s: %v", tenant, err)
		}
		if _, err := tx.Exec(
			`INSERT INTO subscriptions (tenant_id, plan_id, status) VALUES ($1, $2, 'ACTIVE')`,
			tenant, planID); err != nil {
			t.Fatalf("create subscription %s: %v", tenant, err)
		}
	}
	t.Cleanup(func() {
		_, _ = database.Exec(`DELETE FROM subscriptions WHERE tenant_id IN ($1, $2)`, tenantA, tenantB)
		_, _ = database.Exec(`DELETE FROM plans WHERE plan_id = $1`, planID)
		_, _ = database.Exec(`DELETE FROM schools WHERE tenant_id IN ($1, $2)`, tenantA, tenantB)
	})

	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/platform/subscriptions", nil)
	// The platform route cannot carry a school's tenant, and must not be limited
	// to one either.
	c.Set("tenant_id", "")
	c.Set("tx", tx)

	h := NewHandler(NewService(database, nil))
	h.ListSubscriptions(c)

	if w.Code != http.StatusOK {
		t.Fatalf("got %d, want 200: %s", w.Code, w.Body.String())
	}
	var subs []Subscription
	if err := json.Unmarshal(w.Body.Bytes(), &subs); err != nil {
		t.Fatalf("decode %q: %v", w.Body.String(), err)
	}
	seen := map[string]bool{}
	for _, sub := range subs {
		seen[sub.TenantID] = true
	}
	if !seen[tenantA] || !seen[tenantB] {
		t.Fatalf("subscriptions listed %v, want both %s and %s", seen, tenantA, tenantB)
	}
}

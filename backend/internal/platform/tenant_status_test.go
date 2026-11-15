package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
)

// The console sends the status it was looking at. If the school has moved since,
// the change must be refused with a stated reason rather than applied over the
// other operator's decision.
//
// schools is protected by row-level security, so these tests run the way the
// platform routes do: inside a transaction that carries the platform-admin role
// the TenantTxMiddleware sets, which is what platform_admin_bypass keys on.

func platformTx(t *testing.T, h *Handler) *sqlx.Tx {
	t.Helper()
	tx, err := h.service.database.BeginTxx(context.Background(), nil)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	if _, err := tx.Exec(`SELECT set_config('app.current_user_role', 'SAAS_ADMIN', true)`); err != nil {
		tx.Rollback()
		t.Fatalf("platform role context: %v", err)
	}
	return tx
}

func statusOf(t *testing.T, h *Handler, tenantID string) string {
	t.Helper()
	tx := platformTx(t, h)
	defer tx.Rollback()
	var status string
	if err := tx.QueryRow(`SELECT status FROM schools WHERE tenant_id = $1`, tenantID).Scan(&status); err != nil {
		t.Fatalf("read status: %v", err)
	}
	return status
}

func putTenantStatus(t *testing.T, h *Handler, tenantID string, body map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	payload, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPut, "/platform/tenants/"+tenantID+"/status", bytes.NewReader(payload))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Params = gin.Params{{Key: "id", Value: tenantID}}

	tx := platformTx(t, h)
	c.Set("tx", tx)
	h.SetTenantStatus(c)
	// Like the middleware: keep successful writes, roll back refusals.
	if w.Code >= 400 {
		tx.Rollback()
	} else if err := tx.Commit(); err != nil {
		t.Fatalf("commit: %v", err)
	}
	return w
}

func TestSetTenantStatusRefusesAStaleChange(t *testing.T) {
	h := newOnboardingHandler(t)
	token := fmt.Sprintf("%d", time.Now().UnixNano())
	tenantID := "status-test-" + token

	tx := platformTx(t, h)
	if _, err := tx.Exec(
		`INSERT INTO schools (tenant_id, school_name, subdomain, status) VALUES ($1,$2,$3,'ACTIVE')`,
		tenantID, "Status Test School", tenantID); err != nil {
		tx.Rollback()
		t.Fatalf("create school: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit school: %v", err)
	}
	t.Cleanup(func() {
		cleanupTx := platformTx(t, h)
		defer cleanupTx.Rollback()
		_, _ = cleanupTx.Exec(`DELETE FROM schools WHERE tenant_id = $1`, tenantID)
	})

	// First operator: suspends from the state they saw.
	if w := putTenantStatus(t, h, tenantID, map[string]any{
		"status": "SUSPENDED", "expected_status": "ACTIVE",
	}); w.Code != http.StatusOK {
		t.Fatalf("first change: got %d, want 200: %s", w.Code, w.Body.String())
	}
	if got := statusOf(t, h, tenantID); got != "SUSPENDED" {
		t.Fatalf("status is %q, want SUSPENDED", got)
	}

	// Second operator, same stale screen: must be told, not silently accepted.
	w := putTenantStatus(t, h, tenantID, map[string]any{
		"status": "SUSPENDED", "expected_status": "ACTIVE",
	})
	if w.Code != http.StatusConflict {
		t.Fatalf("stale change: got %d, want 409: %s", w.Code, w.Body.String())
	}
	body := decodeBody(t, w)
	if body["code"] != "STATUS_CHANGED" {
		t.Fatalf("code is %v, want STATUS_CHANGED", body["code"])
	}
	message, _ := body["message"].(string)
	if !bytes.Contains([]byte(message), []byte("already SUSPENDED")) {
		t.Fatalf("message %q does not say the school is already suspended", message)
	}

	// The other operator's decision still stands.
	if got := statusOf(t, h, tenantID); got != "SUSPENDED" {
		t.Fatalf("status is %q after the refused change, want SUSPENDED", got)
	}

	// A caller that does not state its expectation (the older URL-only form)
	// keeps working.
	if w := putTenantStatus(t, h, tenantID, map[string]any{"status": "ACTIVE"}); w.Code != http.StatusOK {
		t.Fatalf("unconditional change: got %d, want 200: %s", w.Code, w.Body.String())
	}
	if got := statusOf(t, h, tenantID); got != "ACTIVE" {
		t.Fatalf("status is %q, want ACTIVE", got)
	}

	// And a missing school is still a 404, not a conflict.
	missing := "status-missing-" + token
	if w := putTenantStatus(t, h, missing, map[string]any{"status": "ACTIVE", "expected_status": "ACTIVE"}); w.Code != http.StatusNotFound {
		t.Fatalf("missing school: got %d, want 404: %s", w.Code, w.Body.String())
	}
}

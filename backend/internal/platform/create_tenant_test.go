package platform

import (
	"bytes"
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

// Onboarding a school creates a real account in the shared users table. Doing it
// twice with the same email or phone has to come back as a stated conflict, not
// as a 500 carrying a unique-index message, and it must not leave a half-built
// school behind.

func newOnboardingHandler(t *testing.T) *Handler {
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
	gin.SetMode(gin.TestMode)
	return NewHandler(NewService(database, nil))
}

func cleanupTenant(t *testing.T, h *Handler, tenantID, email string) {
	t.Helper()
	t.Cleanup(func() {
		// Schools cascade to memberships, finance settings and subscriptions;
		// the administrator account lives on its own.
		_, _ = h.service.database.Exec(`DELETE FROM schools WHERE tenant_id = $1`, tenantID)
		_, _ = h.service.database.Exec(`DELETE FROM users WHERE email = $1`, email)
	})
}

func postCreateTenant(t *testing.T, h *Handler, body map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	payload, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/platform/tenants", bytes.NewReader(payload))
	c.Request.Header.Set("Content-Type", "application/json")
	h.CreateTenant(c)
	return w
}

func tenantExists(t *testing.T, h *Handler, tenantID string) bool {
	t.Helper()
	var exists bool
	if err := h.service.database.QueryRow(`SELECT EXISTS (SELECT 1 FROM schools WHERE tenant_id = $1)`, tenantID).
		Scan(&exists); err != nil {
		t.Fatalf("lookup tenant %s: %v", tenantID, err)
	}
	return exists
}

func decodeBody(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode %q: %v", w.Body.String(), err)
	}
	return body
}

func TestCreateTenantReportsDuplicateAdministrator(t *testing.T) {
	h := newOnboardingHandler(t)
	token := fmt.Sprintf("%d", time.Now().UnixNano())
	email := "admin-" + token + "@dup-test.example"
	phone := "2547" + token[len(token)-8:]
	otherEmail := "admin-b-" + token + "@dup-test.example"
	otherPhone := "2541" + token[len(token)-8:]

	first := map[string]any{
		"school_name": "Duplicate Test Primary",
		"subdomain":   "dup-a-" + token,
		"admin_email": email,
		"admin_phone": phone,
	}
	cleanupTenant(t, h, "dup-a-"+token, email)

	if w := postCreateTenant(t, h, first); w.Code != http.StatusCreated {
		t.Fatalf("first onboarding: got %d, want 201: %s", w.Code, w.Body.String())
	}

	t.Run("same email in a different case", func(t *testing.T) {
		second := map[string]any{
			"school_name": "Second Primary",
			"subdomain":   "dup-b-" + token,
			"admin_email": "ADMIN-" + token + "@DUP-TEST.EXAMPLE",
			"admin_phone": otherPhone,
		}
		w := postCreateTenant(t, h, second)
		if w.Code != http.StatusConflict {
			t.Fatalf("got %d, want 409: %s", w.Code, w.Body.String())
		}
		message, _ := decodeBody(t, w)["message"].(string)
		if !bytes.Contains([]byte(message), []byte("administrator email")) {
			t.Fatalf("message %q does not name the administrator email", message)
		}
		if tenantExists(t, h, "dup-b-"+token) {
			t.Fatal("the rejected onboarding left a school row behind")
		}
	})

	t.Run("same phone number", func(t *testing.T) {
		third := map[string]any{
			"school_name": "Third Primary",
			"subdomain":   "dup-c-" + token,
			"admin_email": otherEmail,
			"admin_phone": phone,
		}
		w := postCreateTenant(t, h, third)
		if w.Code != http.StatusConflict {
			t.Fatalf("got %d, want 409: %s", w.Code, w.Body.String())
		}
		message, _ := decodeBody(t, w)["message"].(string)
		if !bytes.Contains([]byte(message), []byte("phone number")) {
			t.Fatalf("message %q does not name the phone number", message)
		}
		if tenantExists(t, h, "dup-c-"+token) {
			t.Fatal("the rejected onboarding left a school row behind")
		}
	})

	t.Run("both already in use", func(t *testing.T) {
		fourth := map[string]any{
			"school_name": "Fourth Primary",
			"subdomain":   "dup-d-" + token,
			"admin_email": email,
			"admin_phone": phone,
		}
		w := postCreateTenant(t, h, fourth)
		if w.Code != http.StatusConflict {
			t.Fatalf("got %d, want 409: %s", w.Code, w.Body.String())
		}
		if message, _ := decodeBody(t, w)["message"].(string); !bytes.Contains([]byte(message), []byte("email and phone")) {
			t.Fatalf("message %q does not name both fields", message)
		}
	})
}

func TestCreateTenantStoresLoginLookupFields(t *testing.T) {
	h := newOnboardingHandler(t)
	token := fmt.Sprintf("%d", time.Now().UnixNano())
	email := "admin-" + token + "@dup-test.example"
	tenantID := "dup-login-" + token

	cleanupTenant(t, h, tenantID, email)

	w := postCreateTenant(t, h, map[string]any{
		"school_name": "Login Lookup Primary",
		"subdomain":   tenantID,
		"admin_email": email,
		"admin_phone": "2547" + token[len(token)-8:],
	})
	if w.Code != http.StatusCreated {
		t.Fatalf("got %d, want 201: %s", w.Code, w.Body.String())
	}

	// The console's account has to be findable by the login path, which looks up
	// auth_lookup_credentials by email_norm.
	var found string
	if err := h.service.database.QueryRow(`SELECT user_id FROM auth_lookup_credentials($1)`, email).
		Scan(&found); err != nil {
		t.Fatalf("new administrator cannot be looked up for login: %v", err)
	}
}

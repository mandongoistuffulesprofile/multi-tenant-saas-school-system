package middleware

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func testRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(CaptureBodyMiddleware(), CacheControlMiddleware())
	r.POST("/login", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"token_pair": gin.H{"access_token": "abc"}})
	})
	r.POST("/created", func(c *gin.Context) {
		c.JSON(http.StatusCreated, gin.H{"ok": true})
	})
	r.GET("/me", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"user_id": "u1"})
	})
	r.GET("/empty", func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})
	r.GET("/shared", func(c *gin.Context) {
		AllowSharedCache(c, 5*time.Minute)
		c.JSON(http.StatusOK, gin.H{"plans": []string{"basic"}})
	})
	// A handler that sets its own Vary must not lose the CORS origin entry
	// when the middleware adds Cookie.
	r.GET("/cors", func(c *gin.Context) {
		c.Header("Vary", "Origin")
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})
	return r
}

func do(r *gin.Engine, method, path string, headers map[string]string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(method, path, nil)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	r.ServeHTTP(w, req)
	return w
}

// A buffered response writer must never swallow write-response bodies: login
// returned 200 with Content-Length: 0 because only GET responses were flushed.
func TestWriteResponseBodiesArePreserved(t *testing.T) {
	r := testRouter()

	w := do(r, http.MethodPost, "/login", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("login status = %d, want 200", w.Code)
	}
	var login map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &login); err != nil {
		t.Fatalf("login body invalid or empty: %v (raw %q)", err, w.Body.String())
	}
	if _, ok := login["token_pair"]; !ok {
		t.Fatalf("login body missing token_pair: %q", w.Body.String())
	}

	w = do(r, http.MethodPost, "/created", nil)
	if w.Code != http.StatusCreated {
		t.Fatalf("created status = %d, want 201", w.Code)
	}
	if w.Body.Len() == 0 {
		t.Fatal("201 response body was dropped")
	}
}

// Authenticated, tenant-scoped GETs must never be stored by a shared cache:
// a proxy replaying one school's payload to another would be a cross-tenant
// data leak.
func TestTenantGetsArePrivateAndVaryOnCookie(t *testing.T) {
	r := testRouter()

	for _, path := range []string{"/me", "/empty"} {
		w := do(r, http.MethodGet, path, nil)
		if got := w.Header().Get("Cache-Control"); got != "private, no-store" {
			t.Fatalf("%s Cache-Control = %q, want %q", path, got, "private, no-store")
		}
		if got := w.Header().Get("Vary"); !strings.Contains(got, "Cookie") {
			t.Fatalf("%s Vary = %q, want it to include Cookie", path, got)
		}
	}
}

// The 304 path still has to carry the same privacy headers as the full body.
func TestNotModifiedKeepsPrivacyHeaders(t *testing.T) {
	r := testRouter()

	first := do(r, http.MethodGet, "/me", nil)
	etag := first.Header().Get("ETag")
	if etag == "" {
		t.Fatal("missing ETag")
	}

	second := do(r, http.MethodGet, "/me", map[string]string{"If-None-Match": etag})
	if second.Code != http.StatusNotModified {
		t.Fatalf("conditional status = %d, want 304", second.Code)
	}
	if got := second.Header().Get("Cache-Control"); got != "private, no-store" {
		t.Fatalf("304 Cache-Control = %q, want %q", got, "private, no-store")
	}
	if got := second.Header().Get("Vary"); !strings.Contains(got, "Cookie") {
		t.Fatalf("304 Vary = %q, want it to include Cookie", got)
	}
}

// Genuinely shared content keeps public caching, without a cookie-dependent
// Vary that would defeat it.
func TestSharedCacheOptInIsPublic(t *testing.T) {
	r := testRouter()

	w := do(r, http.MethodGet, "/shared", nil)
	if got := w.Header().Get("Cache-Control"); got != "public, max-age=300" {
		t.Fatalf("Cache-Control = %q, want %q", got, "public, max-age=300")
	}
	if got := w.Header().Get("Vary"); strings.Contains(got, "Cookie") {
		t.Fatalf("shared response Vary = %q, must not vary on Cookie", got)
	}
}

func TestVaryKeepsExistingOrigin(t *testing.T) {
	r := testRouter()

	w := do(r, http.MethodGet, "/cors", nil)
	vary := w.Header().Values("Vary")
	joined := strings.ToLower(strings.Join(vary, ","))
	if !strings.Contains(joined, "origin") {
		t.Fatalf("Vary = %q, want Origin preserved", joined)
	}
	if !strings.Contains(joined, "cookie") {
		t.Fatalf("Vary = %q, want Cookie added", joined)
	}
}

func TestWriteResponsesAreNotPubliclyCacheable(t *testing.T) {
	r := testRouter()

	w := do(r, http.MethodPost, "/login", nil)
	if got := w.Header().Get("Cache-Control"); strings.Contains(got, "public") {
		t.Fatalf("POST Cache-Control = %q, must not be public", got)
	}
}

func TestGetResponsesGetETagAndNotModified(t *testing.T) {
	r := testRouter()

	first := do(r, http.MethodGet, "/me", nil)
	if first.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", first.Code)
	}
	if first.Body.Len() == 0 {
		t.Fatal("GET body was dropped")
	}
	etag := first.Header().Get("ETag")
	if etag == "" {
		t.Fatal("missing ETag")
	}

	second := do(r, http.MethodGet, "/me", map[string]string{"If-None-Match": etag})
	if second.Code != http.StatusNotModified {
		t.Fatalf("conditional status = %d, want 304", second.Code)
	}
	if second.Body.Len() != 0 {
		t.Fatalf("304 response must not include a body, got %q", second.Body.String())
	}
}

func TestEmptyGetKeepsStatus(t *testing.T) {
	r := testRouter()
	w := do(r, http.MethodGet, "/empty", nil)
	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", w.Code)
	}
	if w.Body.Len() != 0 {
		t.Fatalf("204 response must not include a body, got %q", w.Body.String())
	}
}

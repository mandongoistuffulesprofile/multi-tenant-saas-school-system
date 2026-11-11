package middleware

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

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

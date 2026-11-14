package middleware

import (
	"crypto/sha256"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// privateNoStore is the default for this API. Every authenticated response is
// tenant-scoped, so a shared proxy that replays one school's payload to another
// would be a cross-tenant data leak; nothing here is safe to store publicly.
const privateNoStore = "private, no-store"

// bodyBufferWriter buffers a GET response body so an ETag can be computed and
// If-None-Match honoured with a 304 (no body) before anything is committed.
type bodyBufferWriter struct {
	gin.ResponseWriter
	body       []byte
	statusCode int
	written    bool
	committed  bool
}

func (w *bodyBufferWriter) WriteHeader(code int) {
	if w.written || w.committed {
		return
	}
	w.statusCode = code
	// Defer committing to the underlying writer until we know whether to
	// return 304 (no body) or the buffered body.
}

func (w *bodyBufferWriter) Write(data []byte) (int, error) {
	w.written = true
	w.body = append(w.body, data...)
	return len(data), nil
}

// WriteHeaderNow is used by c.AbortWithStatus and streaming helpers. Commit
// immediately so those responses keep their status code.
func (w *bodyBufferWriter) WriteHeaderNow() {
	if w.written || w.committed {
		return
	}
	w.written = true
	w.commit(w.statusCode, nil)
}

func (w *bodyBufferWriter) Status() int   { return w.statusCode }
func (w *bodyBufferWriter) Size() int     { return len(w.body) }
func (w *bodyBufferWriter) Written() bool { return w.written }

func (w *bodyBufferWriter) commit(status int, body []byte) {
	if !w.committed {
		w.ResponseWriter.WriteHeader(status)
		w.committed = true
	}
	if len(body) > 0 {
		_, _ = w.ResponseWriter.Write(body)
	}
}

// CacheControlMiddleware marks GET responses as private to the caller and
// honours If-None-Match with a 304 when the ETag matches. This keeps repeat
// fetches cheap for the client without letting a shared cache store one
// tenant's data for the next caller. Handlers serving content that is truly
// identical for every caller opt in with AllowSharedCache.
func CacheControlMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		isGet := c.Request.Method == http.MethodGet
		if isGet {
			c.Header("Cache-Control", privateNoStore)
			// Responses depend on the session cookie, so any cache that keeps
			// them must key on it rather than treat them as shared objects.
			addVaryCookie(c.Writer.Header())
		}
		c.Next()

		// Re-assert Vary once the handler has run: a handler that sets its own
		// Vary values (for example Origin) replaces whatever was there, and the
		// response still depends on the session cookie. Public opt-ins remove it
		// themselves, so they are left alone.
		if isGet && !strings.HasPrefix(c.Writer.Header().Get("Cache-Control"), "public") {
			addVaryCookie(c.Writer.Header())
		}

		proxy, ok := c.Writer.(*bodyBufferWriter)
		if !ok {
			return
		}

		// Write bodies must always be flushed. CaptureBodyMiddleware only wraps
		// GET responses, so this is defensive; a buffered body must never be
		// dropped (that previously emptied every POST response, including login).
		if !isGet {
			proxy.commit(proxy.statusCode, proxy.body)
			return
		}

		body := proxy.body
		if len(body) == 0 {
			proxy.commit(proxy.statusCode, nil)
			return
		}

		etag := fmt.Sprintf(`"%x"`, sha256.Sum256(body))
		c.Header("ETag", etag)

		if match := c.GetHeader("If-None-Match"); match != "" && match == etag {
			c.Header("Content-Length", "0")
			proxy.commit(http.StatusNotModified, nil)
			return
		}

		proxy.commit(proxy.statusCode, body)
	}
}

// AllowSharedCache marks the response as cacheable by shared caches. It is only
// for endpoints whose body is identical for every caller and free of tenant or
// session data, such as a public asset catalogue. It must be called before the
// handler writes a body; the default everywhere else is private, no-store.
func AllowSharedCache(c *gin.Context, maxAge time.Duration) {
	seconds := int(maxAge.Seconds())
	if seconds < 0 {
		seconds = 0
	}
	c.Header("Cache-Control", fmt.Sprintf("public, max-age=%d", seconds))
	// A public response must not vary on the caller's cookie.
	removeVaryCookie(c.Writer.Header())
}

func addVaryCookie(h http.Header) {
	for _, value := range h.Values("Vary") {
		for _, part := range strings.Split(value, ",") {
			if strings.EqualFold(strings.TrimSpace(part), "Cookie") {
				return
			}
		}
	}
	h.Add("Vary", "Cookie")
}

func removeVaryCookie(h http.Header) {
	values := h.Values("Vary")
	if len(values) == 0 {
		return
	}
	h.Del("Vary")
	for _, value := range values {
		kept := make([]string, 0, len(values))
		for _, part := range strings.Split(value, ",") {
			trimmed := strings.TrimSpace(part)
			if trimmed == "" || strings.EqualFold(trimmed, "Cookie") {
				continue
			}
			kept = append(kept, trimmed)
		}
		if len(kept) > 0 {
			h.Add("Vary", strings.Join(kept, ", "))
		}
	}
}

// CaptureBodyMiddleware replaces the response writer with a buffer so the body
// can be hashed for ETag generation. Only GET responses are buffered; write
// responses (including streaming downloads/uploads) pass straight through.
// Install before CacheControlMiddleware.
func CaptureBodyMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Method == http.MethodGet {
			c.Writer = &bodyBufferWriter{ResponseWriter: c.Writer, statusCode: http.StatusOK}
		}
		c.Next()
	}
}

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

// maxBufferedBody is how much of a response may be held back for ETag
// generation. Above it the body is streamed straight through: buffering a
// multi-megabyte export would cost a second full copy in RAM just to hash it,
// and a shared response that large is not worth an ETag anyway.
const maxBufferedBody = 256 << 10

// bodyBufferWriter buffers a small JSON GET body so an ETag can be computed and
// If-None-Match honoured with a 304 (no body) before anything is committed.
//
// It stops buffering as soon as it can tell the response is not eligible: a
// non-JSON content type (report-card PDFs, exports) or a body that grows past
// maxBufferedBody. From that point the headers and everything buffered so far
// are flushed and later writes go straight to the client.
type bodyBufferWriter struct {
	gin.ResponseWriter
	body       []byte
	statusCode int
	size       int
	written    bool
	committed  bool
	streaming  bool
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
	w.size += len(data)
	if w.streaming {
		return w.ResponseWriter.Write(data)
	}
	if w.shouldStream(len(data)) {
		w.startStreaming()
		return w.ResponseWriter.Write(data)
	}
	w.body = append(w.body, data...)
	return len(data), nil
}

// shouldStream reports whether this response is ineligible for the ETag path.
func (w *bodyBufferWriter) shouldStream(incoming int) bool {
	if len(w.body)+incoming > maxBufferedBody {
		return true
	}
	contentType := w.Header().Get("Content-Type")
	if contentType == "" {
		// The handler may set it together with the body; keep buffering.
		return false
	}
	return !isETagCandidate(contentType)
}

// startStreaming flushes what was held back and stops buffering.
func (w *bodyBufferWriter) startStreaming() {
	w.streaming = true
	w.commit(w.statusCode, w.body)
	w.body = nil
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
func (w *bodyBufferWriter) Size() int     { return w.size }
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

// isETagCandidate reports whether a response type is worth buffering so it can
// be hashed. Only JSON and unknown types qualify: PDFs, downloads and other
// binary attachments are large one-shot responses.
func isETagCandidate(contentType string) bool {
	mediaType := contentType
	if i := strings.IndexByte(mediaType, ';'); i >= 0 {
		mediaType = mediaType[:i]
	}
	mediaType = strings.ToLower(strings.TrimSpace(mediaType))
	if mediaType == "" {
		return true
	}
	return mediaType == "application/json" || strings.HasSuffix(mediaType, "+json")
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

		// A response that outgrew the buffer, or was never JSON, has already been
		// flushed to the client; there is nothing left to hash.
		if proxy.streaming {
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

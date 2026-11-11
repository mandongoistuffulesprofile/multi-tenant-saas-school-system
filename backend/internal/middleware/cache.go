package middleware

import (
	"crypto/sha256"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
)

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

// CacheControlMiddleware sets short-lived cache headers on safe GET responses
// and honours If-None-Match with a 304 when the ETag matches. This reduces
// repeat fetch payloads on slow/metered mobile connections.
func CacheControlMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		isGet := c.Request.Method == http.MethodGet
		if isGet {
			c.Header("Cache-Control", "public, max-age=60, must-revalidate")
		}
		c.Next()

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

package middleware

import (
	"crypto/sha256"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
)

// bodyBufferWriter buffers the response body so an ETag can be computed and
// If-None-Match honoured with a 304 (no body) before anything is committed.
type bodyBufferWriter struct {
	gin.ResponseWriter
	body       []byte
	statusCode int
	written    bool
}

func (w *bodyBufferWriter) Write(data []byte) (int, error) {
	if !w.written {
		w.written = true
		w.ResponseWriter.WriteHeader(w.statusCode)
	}
	w.body = append(w.body, data...)
	return len(data), nil
}

func (w *bodyBufferWriter) WriteHeader(code int) {
	if w.written {
		return
	}
	w.statusCode = code
	// Defer committing to the underlying writer until we know whether to
	// return 304 (no body) or the buffered body.
}

// CacheControlMiddleware sets short-lived cache headers on safe GET responses
// and honours If-None-Match with a 304 when the ETag matches. This reduces
// repeat fetch payloads on slow/metered mobile connections.
func CacheControlMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Method == http.MethodGet {
			c.Header("Cache-Control", "public, max-age=60, must-revalidate")
		}
		c.Next()

		if c.Request.Method != http.MethodGet {
			return
		}

		proxy, ok := c.Writer.(*bodyBufferWriter)
		if !ok {
			return
		}

		body := proxy.body
		if len(body) == 0 {
			return
		}

		etag := fmt.Sprintf(`"%x"`, sha256.Sum256(body))
		c.Header("ETag", etag)

		if match := c.GetHeader("If-None-Match"); match != "" && match == etag {
			c.Header("Content-Length", "0")
			proxy.ResponseWriter.WriteHeader(http.StatusNotModified)
			return
		}

		proxy.ResponseWriter.WriteHeader(proxy.statusCode)
		if _, err := proxy.ResponseWriter.Write(body); err != nil {
			// Best effort; connection may have closed.
		}
	}
}

// CaptureBodyMiddleware replaces the response writer with a buffer so the body
// can be hashed for ETag generation. Install before CacheControlMiddleware.
func CaptureBodyMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Writer = &bodyBufferWriter{ResponseWriter: c.Writer, statusCode: http.StatusOK}
		c.Next()
	}
}

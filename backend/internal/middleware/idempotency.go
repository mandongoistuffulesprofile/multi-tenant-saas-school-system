package middleware

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

// idempotencyResponse is the cached representation of an HTTP response.
type idempotencyResponse struct {
	StatusCode int         `json:"status_code"`
	Header     http.Header `json:"header"`
	Body       []byte      `json:"body"`
}

// maxCachedResponseBytes caps how much of a response is retained for caching.
// Large exports (CSV/PDF) are streamed straight through instead of being held
// in process memory and pushed into Redis.
const maxCachedResponseBytes = 64 * 1024

// idempotencyBufferWriter buffers a response only up to the cache cap so it
// can be cached before being committed to the client. Once the cap is crossed
// the writer switches to pass-through streaming and the response is not cached.
type idempotencyBufferWriter struct {
	gin.ResponseWriter
	body       []byte
	statusCode int
	written    bool
	committed  bool
	tooLarge   bool
}

func (w *idempotencyBufferWriter) WriteHeader(code int) {
	if w.written || w.committed {
		return
	}
	w.statusCode = code
	w.written = true
}

func (w *idempotencyBufferWriter) Write(data []byte) (int, error) {
	if !w.written {
		w.WriteHeader(http.StatusOK)
	}
	w.written = true

	if w.tooLarge {
		return w.ResponseWriter.Write(data)
	}
	if len(w.body)+len(data) > maxCachedResponseBytes {
		// Cross the cap: send the real status, flush what is buffered and
		// stream the rest directly. Later commits become no-ops.
		w.tooLarge = true
		w.commit(w.statusCode, nil)
		if len(w.body) > 0 {
			if _, err := w.ResponseWriter.Write(w.body); err != nil {
				return 0, err
			}
			w.body = nil
		}
		return w.ResponseWriter.Write(data)
	}

	w.body = append(w.body, data...)
	return len(data), nil
}

func (w *idempotencyBufferWriter) WriteHeaderNow() {
	if w.written || w.committed {
		return
	}
	w.written = true
	w.commit(w.statusCode, nil)
}

func (w *idempotencyBufferWriter) Status() int   { return w.statusCode }
func (w *idempotencyBufferWriter) Size() int     { return len(w.body) }
func (w *idempotencyBufferWriter) Written() bool { return w.written }

func (w *idempotencyBufferWriter) commit(status int, body []byte) {
	if !w.committed {
		w.ResponseWriter.WriteHeader(status)
		w.committed = true
	}
	if len(body) > 0 {
		_, _ = w.ResponseWriter.Write(body)
	}
}

// IdempotencyMiddleware provides universal idempotency for state-changing
// requests. When an X-Idempotency-Key header is present on a POST/PUT/PATCH/
// DELETE request, the middleware checks Redis for a previously cached response
// for the same tenant+key+method+path. On a replay it returns the cached
// response without invoking the handler. On first execution it buffers the
// response, caches it in Redis (24h TTL), then writes it to the client.
func IdempotencyMiddleware(rc *redis.Client) gin.HandlerFunc {
	stateChanging := map[string]bool{
		http.MethodPost:   true,
		http.MethodPut:    true,
		http.MethodPatch:  true,
		http.MethodDelete: true,
	}

	return func(c *gin.Context) {
		if !stateChanging[c.Request.Method] {
			c.Next()
			return
		}

		key := c.GetHeader("X-Idempotency-Key")
		if key == "" {
			c.Next()
			return
		}

		tenantID := c.GetString(ContextTenantID)
		cacheKey := "idempotency:" + tenantID + ":" + key + ":" + c.Request.Method + ":" + c.FullPath()

		// Replay check: return cached response if present.
		if cached, err := rc.Get(c.Request.Context(), cacheKey).Result(); err == nil {
			var resp idempotencyResponse
			if json.Unmarshal([]byte(cached), &resp) == nil {
				c.Header("Idempotent-Replay", "true")
				for k, vv := range resp.Header {
					for _, v := range vv {
						c.Header(k, v)
					}
				}
				ct := resp.Header.Get("Content-Type")
				if ct == "" {
					ct = "application/json"
				}
				c.Data(resp.StatusCode, ct, resp.Body)
				c.Abort()
				return
			}
		}

		// Buffer the response so we can cache it before committing.
		proxy := &idempotencyBufferWriter{
			ResponseWriter: c.Writer,
			statusCode:     http.StatusOK,
		}
		c.Writer = proxy

		c.Next()

		// Cache only fully buffered responses; oversized bodies have already
		// been streamed to the client and must not be replayed from Redis.
		if !proxy.tooLarge {
			resp := idempotencyResponse{
				StatusCode: proxy.statusCode,
				Header:     proxy.Header(),
				Body:       proxy.body,
			}
			if payload, err := json.Marshal(resp); err == nil {
				_ = rc.Set(c.Request.Context(), cacheKey, payload, 24*time.Hour).Err()
			}
		}

		proxy.commit(proxy.statusCode, proxy.body)
	}
}

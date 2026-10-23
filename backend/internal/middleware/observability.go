package middleware

import (
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// RequestLogger emits one structured line per request. Keeping it separate
// from gin.Logger avoids the default's unstructured output and includes the
// correlation ID and tenant, which are the two fields support needs.
func RequestLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()

		attrs := []any{
			"method", c.Request.Method,
			"path", c.Request.URL.Path,
			"route", c.FullPath(),
			"status", c.Writer.Status(),
			"latency_ms", time.Since(start).Milliseconds(),
			"request_id", c.GetString(ContextRequestID),
			"ip", c.ClientIP(),
		}
		if tenant := c.GetString(ContextTenantID); tenant != "" {
			attrs = append(attrs, "tenant_id", tenant)
		}
		if len(c.Errors) > 0 {
			attrs = append(attrs, "error", c.Errors.String())
		}

		switch {
		case c.Writer.Status() >= 500:
			slog.Error("http_request", attrs...)
		case c.Writer.Status() >= 400:
			slog.Warn("http_request", attrs...)
		default:
			slog.Info("http_request", attrs...)
		}
	}
}

// SecurityHeaders applies low-risk headers to every response. The API returns
// JSON, so the CSP is deliberately strict; the frontend is served by Caddy with
// its own policy.
func SecurityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "DENY")
		c.Header("Referrer-Policy", "no-referrer")
		c.Header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		c.Header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		c.Next()
	}
}

// BodyLimit rejects oversized request bodies before a handler can allocate
// memory for them. 2 MiB is comfortably above the largest JSON payload.
func BodyLimit(maxBytes int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Body != nil {
			c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBytes)
		}
		c.Next()
	}
}

type metricKey struct {
	method string
	route  string
	status int
}

var (
	metricsMu sync.Mutex
	metrics   = map[metricKey]uint64{}
)

// MetricsMiddleware records request counts. A dependency-free implementation
// is enough for the single-VPS deployment; swap for prometheus/client_golang
// when histograms or process metrics are needed.
func MetricsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()
		route := c.FullPath()
		if route == "" {
			route = "unmatched"
		}
		key := metricKey{method: c.Request.Method, route: route, status: c.Writer.Status()}
		metricsMu.Lock()
		metrics[key]++
		metricsMu.Unlock()
	}
}

// MetricsHandler exposes the counters in Prometheus text format.
func MetricsHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		if want := strings.TrimSpace(os.Getenv("METRICS_TOKEN")); want != "" {
			if c.GetHeader("Authorization") != "Bearer "+want {
				c.AbortWithStatus(http.StatusUnauthorized)
				return
			}
		}

		metricsMu.Lock()
		keys := make([]metricKey, 0, len(metrics))
		for k := range metrics {
			keys = append(keys, k)
		}
		sort.Slice(keys, func(i, j int) bool {
			if keys[i].route != keys[j].route {
				return keys[i].route < keys[j].route
			}
			if keys[i].method != keys[j].method {
				return keys[i].method < keys[j].method
			}
			return keys[i].status < keys[j].status
		})

		c.Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		fmt.Fprintln(c.Writer, "# HELP skulapp_http_requests_total HTTP requests by method, route and status.")
		fmt.Fprintln(c.Writer, "# TYPE skulapp_http_requests_total counter")
		for _, k := range keys {
			fmt.Fprintf(c.Writer, "skulapp_http_requests_total{method=%q,route=%q,status=%q} %d\n",
				k.method, k.route, fmt.Sprintf("%d", k.status), metrics[k])
		}
		metricsMu.Unlock()
	}
}

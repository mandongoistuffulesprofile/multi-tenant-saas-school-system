package middleware

import (
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
)

// CORS allows only the configured origins. CORS_ALLOWED_ORIGIN may contain a
// comma-separated list; "*" is accepted for local development but credentials
// are then disabled. Unknown origins get no CORS headers, and preflights from
// them are rejected.
func CORS(allowedOrigins string) gin.HandlerFunc {
	allowed := map[string]bool{}
	wildcard := strings.TrimSpace(allowedOrigins) == "" || strings.TrimSpace(allowedOrigins) == "*"
	// Fail closed in production: never fall back to wildcard when unset.
	if os.Getenv("APP_ENV") == "production" && (strings.TrimSpace(allowedOrigins) == "" || strings.TrimSpace(allowedOrigins) == "*") {
		wildcard = false
	}
	for _, origin := range strings.Split(allowedOrigins, ",") {
		if origin = strings.TrimSpace(origin); origin != "" && origin != "*" {
			allowed[origin] = true
		}
	}

	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		permitted := wildcard || allowed[origin]
		if origin != "" && !permitted {
			if c.Request.Method == http.MethodOptions {
				c.AbortWithStatus(http.StatusForbidden)
				return
			}
			c.Next()
			return
		}

		if wildcard {
			c.Header("Access-Control-Allow-Origin", "*")
		} else if origin != "" {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Access-Control-Allow-Credentials", "true")
			c.Header("Vary", "Origin")
		}
		c.Header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Tenant-ID, X-Request-ID, X-CSRF-Token")
		c.Header("Access-Control-Expose-Headers", "Content-Length, X-Tenant-ID, X-Request-ID")

		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	}
}

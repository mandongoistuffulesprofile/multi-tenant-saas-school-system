package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// CORS allows the Vite dev server and same-site SPAs to call the API.
// The allowed origin can be narrowed with CORS_ALLOWED_ORIGIN in production.
func CORS(allowedOrigin string) gin.HandlerFunc {
	if allowedOrigin == "" {
		allowedOrigin = "*"
	}

	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", allowedOrigin)
		c.Header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Tenant-ID, X-Request-ID")
		c.Header("Access-Control-Expose-Headers", "Content-Length, X-Tenant-ID, X-Request-ID")
		if allowedOrigin != "*" {
			c.Header("Vary", "Origin")
		}

		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	}
}

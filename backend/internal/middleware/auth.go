package middleware

import (
	"fmt"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"kenyan-primary-saas/backend/internal/auth"
	"kenyan-primary-saas/backend/internal/db"
	"kenyan-primary-saas/backend/internal/validation"
)

// Re-export validation helpers so existing `middleware.BadRequest` callers
// continue to work without changing their import paths.
var (
	BadRequest       = validation.BadRequest
	Unauthorized      = validation.Unauthorized
	Forbidden         = validation.Forbidden
	NotFound          = validation.NotFound
	Conflict          = validation.Conflict
	TooManyRequests   = validation.TooManyRequests
	Internal          = validation.Internal
	JSONError         = validation.JSONError
	BindJSON          = validation.BindJSON
	ValidationErrors  = validation.Errors
)

// TenantContextMiddleware extracts tenant from JWT and sets DB context.
// Invalid or malformed bearer tokens are rejected with 401 immediately.
//
// RLS ENFORCEMENT: this middleware sets the session-level app.current_tenant_id
// and app.current_user_id on the DB so that subsequent queries are subject to
// Row-Level Security policies.
//
// NOTE ON CONNECTION POOLS: PostgreSQL session-level SET commands persist on
// the underlying connection. With database/sql pooling, a connection that has
// been "stamped" with tenant context may be reused for later queries from
// the same or even a different tenant, which would leak RLS context. Mitigations:
//   - SetConnMaxLifetime limits how long a connection lives, bounding the leak
//     window. The default pool settings already set 30min.
//   - For absolute isolation, handlers that perform sensitive writes MUST use
//     BeginTenantTx (which uses SET LOCAL, scoped to the transaction only).
// This middleware provides defense-in-depth for read paths; it is NOT a
// substitute for transaction-scoped context on writes.
// publicAuthPaths are endpoints that must work without (and must not be
// blocked by) a bearer token. A client that still holds a stale/expired
// access token would otherwise be rejected before reaching the handler —
// e.g. POST /auth/login would fail with "Invalid or expired token"
// instead of actually authenticating the supplied credentials.
var publicAuthPaths = []string{
	"/auth/login",
	"/auth/refresh",
	"/auth/otp/request",
	"/auth/otp/verify",
	"/auth/password/reset/request",
	"/auth/password/reset/confirm",
	"/auth/password/reset",
	"/auth/parent/activate",
	"/auth/invite/accept",
}

func isPublicAuthPath(path string) bool {
	for _, p := range publicAuthPaths {
		if strings.HasSuffix(path, p) {
			return true
		}
	}
	return false
}

func TenantContextMiddleware(jwtManager *auth.JWTManager, database *db.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.Next()
			return
		}

		// Public auth endpoints ignore any Authorization header. A stale token
		// must not block login/refresh.
		if isPublicAuthPath(c.Request.URL.Path) {
			c.Next()
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			validation.Unauthorized(c, "Invalid authorization header")
			c.Abort()
			return
		}

		claims, err := jwtManager.ValidateToken(parts[1])
		if err != nil {
			validation.Unauthorized(c, "Invalid or expired token")
			c.Abort()
			return
		}

		c.Set("user_id", claims.UserID)
		c.Set("tenant_id", claims.TenantID)
		c.Set("roles", claims.Roles)
		c.Set("current_user_id", claims.UserID)

		c.Header("X-User-ID", claims.UserID)
		c.Header("X-Tenant-ID", claims.TenantID)

		// Stamp the session so pooled connections carry RLS context.
		_ = database.SetSessionContext(claims.TenantID, claims.UserID)

		// Reset on exit so the next request that grabs this connection
		// doesn't inherit a stale tenant context.
		defer func() {
			_ = database.ResetSessionContext()
		}()

		c.Next()
	}
}

// RequireAuth ensures the user is authenticated
func RequireAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, exists := c.Get("user_id")
		if !exists {
			validation.Unauthorized(c, "Authentication required")
			c.Abort()
			return
		}
		c.Set("current_user_id", userID)
		c.Next()
	}
}

// RequireRole ensures the user has one of the specified roles
func RequireRole(allowedRoles ...string) gin.HandlerFunc {
	return func(c *gin.Context) {
		roles, exists := c.Get("roles")
		if !exists {
			validation.Forbidden(c, "No roles assigned")
			c.Abort()
			return
		}

		userRoles, ok := roles.([]string)
		if !ok {
			validation.Forbidden(c, "Invalid roles format")
			c.Abort()
			return
		}

		for _, userRole := range userRoles {
			for _, allowedRole := range allowedRoles {
				if userRole == allowedRole {
					c.Next()
					return
				}
			}
		}

		validation.Forbidden(c, "Insufficient permissions")
		c.Abort()
	}
}

// RequestIDMiddleware adds a request ID to every request.
func RequestIDMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		requestID := c.GetHeader("X-Request-ID")
		if requestID == "" {
			requestID = fmt.Sprintf("req_%d", time.Now().UnixNano())
		}
		c.Set("X-Request-ID", requestID)
		c.Header("X-Request-ID", requestID)
		c.Next()
	}
}
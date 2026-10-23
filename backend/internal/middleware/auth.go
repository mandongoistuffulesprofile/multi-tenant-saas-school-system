package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/auth"
)

// Context keys shared by the middleware and the service handlers.
const (
	ContextUserID    = "user_id"
	ContextTenantID  = "tenant_id"
	ContextRoles     = "roles"
	ContextRole      = "role"
	ContextRequestID = "X-Request-ID"
)

// RequireAuth rejects requests that did not carry a valid access token.
// TenantContextMiddleware performs the actual token verification and stores the
// identity; this guard simply enforces that authentication happened.
func RequireAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.GetString(ContextUserID) == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"code":       "UNAUTHORIZED",
				"message":    "Authentication required",
				"request_id": c.GetString(ContextRequestID),
			})
			return
		}
		c.Next()
	}
}

// RequireRole allows the request when the authenticated user holds at least one
// of the supplied roles.
func RequireRole(allowedRoles ...string) gin.HandlerFunc {
	return func(c *gin.Context) {
		value, _ := c.Get(ContextRoles)
		roles, _ := value.([]string)

		for _, have := range roles {
			for _, want := range allowedRoles {
				if have == want {
					c.Next()
					return
				}
			}
		}

		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
			"code":       "FORBIDDEN",
			"message":    "Insufficient permissions",
			"request_id": c.GetString(ContextRequestID),
		})
	}
}

// RequestIDMiddleware assigns a correlation ID to every request. Incoming
// X-Request-ID values are preserved so traces survive a proxy hop.
func RequestIDMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		requestID := strings.TrimSpace(c.GetHeader(ContextRequestID))
		if requestID == "" {
			requestID = uuid.NewString()
		}
		c.Header(ContextRequestID, requestID)
		c.Set(ContextRequestID, requestID)
		c.Next()
	}
}

// ParseBearerToken extracts and validates an access token from the
// Authorization header. It returns nil when no token was supplied.
func ParseBearerToken(c *gin.Context, jwtManager *auth.JWTManager) (*auth.Claims, error) {
	header := c.GetHeader("Authorization")
	if header == "" {
		return nil, nil
	}

	if !strings.HasPrefix(header, "Bearer ") {
		return nil, auth.ErrInvalidToken
	}

	claims, err := jwtManager.ValidateToken(strings.TrimSpace(strings.TrimPrefix(header, "Bearer ")))
	if err != nil {
		return nil, err
	}
	return claims, nil
}

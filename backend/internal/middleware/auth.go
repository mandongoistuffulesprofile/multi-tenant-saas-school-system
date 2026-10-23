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

// ParseBearerToken extracts a token from the Authorization header only.
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
	if claims.TokenType != auth.TokenTypeAccess {
		return nil, auth.ErrInvalidToken
	}
	return claims, nil
}

// ParseAccessToken resolves the access token from the bearer header first, then
// from the HttpOnly cookie. The bool reports whether cookie authentication was
// used, which determines whether CSRF double-submit is required.
func ParseAccessToken(c *gin.Context, jwtManager *auth.JWTManager) (*auth.Claims, bool, error) {
	header := c.GetHeader("Authorization")
	if header != "" {
		claims, err := ParseBearerToken(c, jwtManager)
		return claims, false, err
	}

	cookie, err := c.Cookie(auth.AccessCookie)
	if err != nil || strings.TrimSpace(cookie) == "" {
		return nil, false, nil
	}
	claims, err := jwtManager.ValidateToken(strings.TrimSpace(cookie))
	if err != nil {
		return nil, true, err
	}
	if claims.TokenType != auth.TokenTypeAccess {
		return nil, true, auth.ErrInvalidToken
	}
	return claims, true, nil
}

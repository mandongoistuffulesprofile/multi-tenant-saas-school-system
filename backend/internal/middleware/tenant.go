package middleware

import (
	"crypto/subtle"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/auth"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
)

// TenantContextMiddleware establishes the request identity:
//
//  1. If a bearer token is present it is verified once and the user, tenant and
//     role claims are copied into the gin context.
//  2. Without a valid token the tenant remains unset; there is no header or
//     subdomain fallback, so callers cannot spoof a tenant.
//
// Handlers read the values with c.GetString("tenant_id") etc., and pass them to
// db.BeginTenantTx so PostgreSQL RLS enforces isolation inside each transaction.
func TenantContextMiddleware(jwtManager *auth.JWTManager, database *db.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		claims, fromCookie, err := ParseAccessToken(c, jwtManager)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"code":       "UNAUTHORIZED",
				"message":    "Invalid or expired token",
				"request_id": c.GetString(ContextRequestID),
			})
			return
		}

		// Login and refresh establish a session; they cannot present a CSRF
		// token yet (or may carry an expired access cookie alongside a valid
		// refresh cookie). Every other cookie-authenticated mutation needs it.
		skipCSRF := c.Request.URL.Path == "/api/v1/auth/login" || c.Request.URL.Path == "/api/v1/auth/refresh"
		if claims != nil && fromCookie && isUnsafeMethod(c.Request.Method) && !skipCSRF {
			cookie, _ := c.Cookie(auth.CSRFCookie)
			header := c.GetHeader("X-CSRF-Token")
			if cookie == "" || subtle.ConstantTimeCompare([]byte(cookie), []byte(header)) != 1 {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
					"code":       "CSRF_FAILED",
					"message":    "Missing or invalid CSRF token",
					"request_id": c.GetString(ContextRequestID),
				})
				return
			}
		}

		if claims != nil {
			c.Set(ContextUserID, claims.UserID)
			c.Set("current_user_id", claims.UserID)
			c.Set(ContextTenantID, claims.TenantID)
			c.Set(ContextRoles, claims.Roles)
			if len(claims.Roles) > 0 {
				c.Set(ContextRole, claims.Roles[0])
			}
		}

		c.Next()
	}
}

func isUnsafeMethod(method string) bool {
	switch method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	default:
		return false
	}
}

// ParseAccessToken extracts and validates an access token from the Gin
// context. It first checks the Authorization header, then falls back to the
// HttpOnly access_token cookie. Returns the claims, whether the token came
// from a cookie, and any validation error.
func ParseAccessToken(c *gin.Context, jm *auth.JWTManager) (*auth.Claims, bool, error) {
	authHeader := c.GetHeader("Authorization")
	if authHeader != "" && strings.HasPrefix(authHeader, "Bearer ") {
		tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
		claims, err := jm.ValidateToken(tokenStr, auth.TokenTypeAccess)
		if err != nil {
			return nil, false, err
		}
		return claims, false, nil
	}

	// Fall back to the HttpOnly access_token cookie.
	cookie, err := c.Cookie(auth.AccessCookie)
	if err != nil || cookie == "" {
		return nil, false, nil
	}
	claims, err := jm.ValidateToken(cookie, auth.TokenTypeAccess)
	if err != nil {
		return nil, false, err
	}
	return claims, true, nil
}

package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/auth"
)

type contextKey string

const (
	TenantIDKey contextKey = "tenant_id"
	UserIDKey   contextKey = "user_id"
	UserRoleKey contextKey = "user_role"

	// Gin context keys (string-based, used by c.Get/c.Set).
	ContextRequestID = "request_id"
	ContextTenantID  = "tenant_id"
	ContextUserID    = "user_id"
	ContextRoles     = "roles"
	ContextRole      = "role"
	ContextReadOnly  = "read_only"
)

// RequireAuthGin validates the access token from Authorization Bearer header
// or HttpOnly access_token cookie and sets user/tenant/role claims in context.
func RequireAuthGin(jm *auth.JWTManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		claims, _, err := ParseAccessToken(c, jm)
		if err != nil || claims == nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized: missing or invalid token"})
			return
		}

		c.Set(ContextUserID, claims.UserID)
		c.Set(ContextTenantID, claims.TenantID)
		if len(claims.Roles) > 0 {
			c.Set(ContextRole, claims.Roles[0])
		}
		c.Set(ContextRoles, claims.Roles)
		c.Set(ContextReadOnly, claims.ReadOnly)
		c.Next()
	}
}

// RequireRoles restricts routes to specific school roles (e.g. 'school_admin', 'accountant', 'teacher')
func RequireRoles(allowedRoles ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			role, _ := r.Context().Value(UserRoleKey).(string)
			for _, allowed := range allowedRoles {
				if role == allowed {
					next.ServeHTTP(w, r)
					return
				}
			}
			http.Error(w, `{"error":"forbidden: insufficient role permissions"}`, http.StatusForbidden)
		})
	}
}

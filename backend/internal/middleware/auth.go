package middleware

import (
	"context"
	"database/sql"
	"net/http"
	"strings"

	"github.com/google/uuid"
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
)

// TenantResolver resolves tenant ID from subdomain (e.g. school1.domain.com) or X-Tenant-ID header
func TenantResolver(db *sql.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var tenantID uuid.UUID

			// 1. Check custom header (useful for mobile apps & API testing)
			headerTenant := r.Header.Get("X-Tenant-ID")
			if headerTenant != "" {
				parsed, err := uuid.Parse(headerTenant)
				if err == nil {
					tenantID = parsed
				}
			}

			// 2. Fallback to subdomain resolution
			if tenantID == uuid.Nil {
				host := r.Host
				parts := strings.Split(host, ".")
				if len(parts) >= 2 {
					subdomain := strings.ToLower(parts[0])
					_ = db.QueryRowContext(r.Context(), "SELECT id FROM tenants WHERE subdomain = $1", subdomain).Scan(&tenantID)
				}
			}

			ctx := context.WithValue(r.Context(), TenantIDKey, tenantID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// RequireAuth validates JWT and verifies that the tenant in token matches request tenant
func RequireAuth(authService *auth.AuthService) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
				http.Error(w, `{"error":"unauthorized: missing or invalid token"}`, http.StatusUnauthorized)
				return
			}

			tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
			claims, err := authService.ParseToken(tokenStr)
			if err != nil {
				http.Error(w, `{"error":"unauthorized: token invalid or expired"}`, http.StatusUnauthorized)
				return
			}

			// Ensure tenant isolation boundary: Token tenant MUST match request tenant if resolved
			reqTenant, _ := r.Context().Value(TenantIDKey).(uuid.UUID)
			if reqTenant != uuid.Nil {
				claimsTenantID, _ := uuid.Parse(claims.TenantID)
				if claimsTenantID != reqTenant {
					http.Error(w, `{"error":"forbidden: cross-tenant access denied"}`, http.StatusForbidden)
					return
				}
			}

			ctx := context.WithValue(r.Context(), UserIDKey, claims.UserID)
			ctx = context.WithValue(ctx, TenantIDKey, claims.TenantID)
			role := ""
			if len(claims.Roles) > 0 {
				role = claims.Roles[0]
			}
			ctx = context.WithValue(ctx, UserRoleKey, role)

			next.ServeHTTP(w, r.WithContext(ctx))
		})
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

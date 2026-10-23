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
//  2. Otherwise the tenant may still be resolved from the X-Tenant-ID header
//     (tenant id or subdomain) for public, tenant-aware routes.
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
			// A header may not override the signed tenant claim. Fail closed if
			// it names a different tenant (including an unknown one).
			if headerTenant := strings.TrimSpace(c.GetHeader("X-Tenant-ID")); headerTenant != "" {
				if resolveTenantValue(database, headerTenant) != claims.TenantID {
					c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
						"code":       "TENANT_MISMATCH",
						"message":    "X-Tenant-ID does not match the access token",
						"request_id": c.GetString(ContextRequestID),
					})
					return
				}
			}

			c.Set(ContextUserID, claims.UserID)
			c.Set("current_user_id", claims.UserID)
			c.Set(ContextTenantID, claims.TenantID)
			c.Set(ContextRoles, claims.Roles)
			if len(claims.Roles) > 0 {
				c.Set(ContextRole, claims.Roles[0])
			}
		}

		if c.GetString(ContextTenantID) == "" {
			if tenantID := resolveTenant(c, database); tenantID != "" {
				c.Set(ContextTenantID, tenantID)
			}
		}

		c.Next()
	}
}

// resolveTenant reads X-Tenant-ID, falling back to the subdomain of the host.
// Values may be a tenant id or a subdomain; both are verified against schools.
func resolveTenant(c *gin.Context, database *db.DB) string {
	value := strings.TrimSpace(c.GetHeader("X-Tenant-ID"))
	if value == "" {
		host := c.Request.Host
		if i := strings.IndexByte(host, ':'); i >= 0 {
			host = host[:i]
		}
		parts := strings.Split(host, ".")
		if len(parts) > 2 {
			value = parts[0]
		}
	}
	if value == "" || database == nil {
		return ""
	}

	return resolveTenantValue(database, value)
}

func resolveTenantValue(database *db.DB, value string) string {
	if database == nil || value == "" {
		return ""
	}
	var tenantID string
	if err := database.QueryRow(
		`SELECT tenant_id FROM schools
		  WHERE status = 'ACTIVE' AND (tenant_id = $1 OR subdomain = $1)
		  LIMIT 1`,
		value,
	).Scan(&tenantID); err != nil {
		return ""
	}
	return tenantID
}

func isUnsafeMethod(method string) bool {
	switch method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	default:
		return false
	}
}

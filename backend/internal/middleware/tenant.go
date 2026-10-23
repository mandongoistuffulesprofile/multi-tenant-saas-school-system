package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/auth"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
)

// TenantContextMiddleware establishes the request identity:
//
//  1. If a bearer token is present it is verified once and the user, tenant and
//     role claims are copied into the gin context.
//  2. Otherwise the tenant may still be resolved from the X-Tenant-ID header
//     (tenant UUID, subdomain or school code) for public, tenant-aware routes.
//
// Handlers read the values with c.GetString("tenant_id") etc., and pass them to
// db.BeginTenantTx so PostgreSQL RLS enforces isolation inside each transaction.
func TenantContextMiddleware(jwtManager *auth.JWTManager, database *db.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		claims, err := ParseBearerToken(c, jwtManager)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"code":       "UNAUTHORIZED",
				"message":    "Invalid or expired token",
				"request_id": c.GetString(ContextRequestID),
			})
			return
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

		if c.GetString(ContextTenantID) == "" {
			if tenantID := resolveTenant(c, database); tenantID != "" {
				c.Set(ContextTenantID, tenantID)
			}
		}

		c.Next()
	}
}

// resolveTenant reads X-Tenant-ID, falling back to the subdomain of the host.
// Values may be a tenant UUID, a subdomain or a school code.
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
	if value == "" {
		return ""
	}

	if parsed, err := uuid.Parse(value); err == nil {
		return parsed.String()
	}

	// Allow subdomains and school codes, but never treat them as a tenant ID
	// without verifying they exist.
	if database == nil {
		return ""
	}
	var tenantID string
	if err := database.QueryRow(
		`SELECT id::text FROM tenants WHERE subdomain = $1 OR school_code = $1 LIMIT 1`,
		value,
	).Scan(&tenantID); err != nil {
		return ""
	}
	return tenantID
}

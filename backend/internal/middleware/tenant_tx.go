package middleware

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
	"github.com/redis/go-redis/v9"
)

type txKey struct{}

const (
	tenantStatusCacheTTL  = 30 * time.Second
	tenantStatusKeyPrefix = "tenant:status:"
)

// TenantTxMiddleware opens a request-scoped transaction, sets the tenant
// context for RLS, and commits on success / rolls back on error.
// It also checks that the tenant is not suspended (cached in Redis).
// If the JWT has read_only claim, the transaction is set to READ ONLY.
func TenantTxMiddleware(db *sqlx.DB, redisClient *redis.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		tenantID := c.GetString(ContextTenantID)
		if tenantID == "" {
			c.Next()
			return
		}

		// Check if this is a read-only session (impersonation)
		readOnly := false
		if v, ok := c.Get("read_only"); ok {
			if b, ok := v.(bool); ok {
				readOnly = b
			}
		}

		// Check tenant status (suspended tenants cannot make API calls)
		if redisClient != nil {
			cacheKey := tenantStatusKeyPrefix + tenantID
			status, err := redisClient.Get(c.Request.Context(), cacheKey).Result()
			if err == nil {
				if status == "SUSPENDED" {
					c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"code": "TENANT_SUSPENDED", "message": "Tenant is suspended"})
					return
				}
			} else if err != redis.Nil {
				// On Redis error, fall back to DB check (fail-open for availability)
				var dbStatus string
				if err := db.QueryRowContext(c.Request.Context(), `SELECT status FROM schools WHERE tenant_id = $1`, tenantID).Scan(&dbStatus); err == nil {
					if dbStatus == "SUSPENDED" {
						c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"code": "TENANT_SUSPENDED", "message": "Tenant is suspended"})
						return
					}
					// Cache the status
					_ = redisClient.Set(c.Request.Context(), cacheKey, dbStatus, tenantStatusCacheTTL).Err()
				}
			} else {
				// Cache miss - fetch from DB and cache
				var dbStatus string
				if err := db.QueryRowContext(c.Request.Context(), `SELECT status FROM schools WHERE tenant_id = $1`, tenantID).Scan(&dbStatus); err == nil {
					if dbStatus == "SUSPENDED" {
						c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"code": "TENANT_SUSPENDED", "message": "Tenant is suspended"})
						return
					}
					_ = redisClient.Set(c.Request.Context(), cacheKey, dbStatus, tenantStatusCacheTTL).Err()
				}
			}
		}

		tx, err := db.BeginTxx(c.Request.Context(), nil)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "failed to begin transaction"})
			return
		}

		// Set read-only mode if the token has read_only claim
		if readOnly {
			if _, err := tx.ExecContext(c.Request.Context(), "SET TRANSACTION READ ONLY"); err != nil {
				tx.Rollback()
				c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "failed to set read-only transaction"})
				return
			}
		}

		if _, err := tx.ExecContext(c.Request.Context(), "SELECT set_config('app.current_tenant_id', $1, true)", tenantID); err != nil {
			tx.Rollback()
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "failed to set tenant context"})
			return
		}

		// Platform (SaaS) administrators operate across tenants. Mark the
		// transaction so the platform_admin_bypass RLS policy can grant them
		// cross-tenant reads; tenant sessions never set this GUC.
		if isPlatformAdmin(c) {
			if _, err := tx.ExecContext(c.Request.Context(), "SELECT set_config('app.current_user_role', 'SAAS_ADMIN', true)"); err != nil {
				tx.Rollback()
				c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "failed to set platform role context"})
				return
			}
		}

		c.Request = c.Request.WithContext(context.WithValue(c.Request.Context(), txKey{}, tx))
		c.Set("tx", tx)

		c.Next()

		if len(c.Errors) > 0 || c.Writer.Status() >= 400 {
			tx.Rollback()
			return
		}
		if err := tx.Commit(); err != nil {
			// best effort; response already sent
		}
	}
}

// isPlatformAdmin reports whether the signed session carries a SaaS platform
// administrator role. It reads the same claims RequireRole uses.
func isPlatformAdmin(c *gin.Context) bool {
	if rolesVal, ok := c.Get(ContextRoles); ok {
		if roles, ok := rolesVal.([]string); ok {
			for _, role := range roles {
				if role == RoleSaasAdmin || role == RoleSuperAdmin {
					return true
				}
			}
		}
	}
	switch c.GetString(ContextRole) {
	case RoleSaasAdmin, RoleSuperAdmin:
		return true
	}
	return false
}

// TxFromContext returns the request-scoped transaction if present.
func TxFromContext(ctx context.Context) *sqlx.Tx {
	if v := ctx.Value(txKey{}); v != nil {
		if tx, ok := v.(*sqlx.Tx); ok {
			return tx
		}
	}
	return nil
}

// TxFromGin returns the request-scoped transaction from a gin context.
func TxFromGin(c *gin.Context) *sqlx.Tx {
	if v, ok := c.Get("tx"); ok {
		if tx, ok := v.(*sqlx.Tx); ok {
			return tx
		}
	}
	return TxFromContext(c.Request.Context())
}

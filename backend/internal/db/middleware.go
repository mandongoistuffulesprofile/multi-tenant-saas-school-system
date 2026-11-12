package db

import (
	"context"
	"database/sql"
	"net/http"

	"github.com/gin-gonic/gin"
)

const (
	TxKey       = "CTX_TENANT_DB_TX"
	TenantIDKey = "tenant_id"
	RoleKey     = "user_role"
)

// TenantTxMiddleware guarantees tenant isolation through Postgres RLS within a transaction.
func TenantTxMiddleware(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		tenantID := c.GetString(TenantIDKey)
		if tenantID == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "tenant context missing"})
			return
		}
		role := c.GetString(RoleKey)

		ctx := c.Request.Context()

		// Begin isolation-safe transaction
		tx, err := db.BeginTx(ctx, &sql.TxOptions{
			Isolation: sql.LevelReadCommitted,
			ReadOnly:  c.Request.Method == http.MethodGet || c.Request.Method == http.MethodHead,
		})
		if err != nil {
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "transaction allocation failure"})
			return
		}

		// Ensure automatic rollback if not explicitly committed
		defer func() {
			_ = tx.Rollback()
		}()

		// SET LOCAL binds only to the lifetime of this specific transaction block
		if _, err := tx.ExecContext(ctx, "SELECT set_config('app.current_tenant_id', $1, true)", tenantID); err != nil {
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "tenant isolation binding failed"})
			return
		}

		if role != "" {
			if _, err := tx.ExecContext(ctx, "SELECT set_config('app.current_user_role', $1, true)", role); err != nil {
				c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "role context binding failed"})
				return
			}
		}

		// Store transaction in Gin context for controllers/services
		c.Set(TxKey, tx)
		c.Next()

		// If no unhandled errors and response is successful, commit
		if len(c.Errors) == 0 && c.Writer.Status() < http.StatusBadRequest {
			if err := tx.Commit(); err != nil {
				c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "transaction commit failure"})
				return
			}
		}
	}
}

// GetTx extracts the active tenant-scoped transaction from Gin Context.
func GetTx(c *gin.Context) (*sql.Tx, bool) {
	val, exists := c.Get(TxKey)
	if !exists {
		return nil, false
	}
	tx, ok := val.(*sql.Tx)
	return tx, ok
}

// WithTenantTx executes fn within a tenant-scoped transaction.
// Used by background workers that need RLS context.
func WithTenantTx(ctx context.Context, db *sql.DB, tenantID, userRole string, fn func(*sql.Tx) error) error {
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	if _, err := tx.ExecContext(ctx, "SELECT set_config('app.current_tenant_id', $1, true)", tenantID); err != nil {
		return err
	}

	if userRole != "" {
		if _, err := tx.ExecContext(ctx, "SELECT set_config('app.current_user_role', $1, true)", userRole); err != nil {
			return err
		}
	}

	if err := fn(tx); err != nil {
		return err
	}

	return tx.Commit()
}
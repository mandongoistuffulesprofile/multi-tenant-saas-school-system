package middleware

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
)

type txKey struct{}

// TenantTxMiddleware opens a request-scoped transaction, sets the tenant
// context for RLS, and commits on success / rolls back on error.
func TenantTxMiddleware(db *sqlx.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		tenantID := c.GetString(ContextTenantID)
		if tenantID == "" {
			c.Next()
			return
		}

		tx, err := db.BeginTxx(c.Request.Context(), nil)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "failed to begin transaction"})
			return
		}

		if _, err := tx.ExecContext(c.Request.Context(), "SELECT set_config('app.current_tenant_id', $1, true)", tenantID); err != nil {
			tx.Rollback()
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "failed to set tenant context"})
			return
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

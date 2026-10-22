package middleware

import (
	"context"
	"database/sql"
	"net/http"
	"strings"
)

type contextKey string

const (
	TxContextKey     contextKey = "db_tenant_tx"
	TenantContextKey contextKey = "tenant_id"
)

// TransactionalRLSMiddleware guarantees that every request executes inside a strict
// transaction with SET LOCAL app.current_tenant_id to eliminate connection pool state bleed.
func TransactionalRLSMiddleware(db *sql.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Extract tenant slug or header
			tenantID := r.Header.Get("X-Tenant-ID")
			if tenantID == "" {
				authHeader := r.Header.Get("Authorization")
				if strings.HasPrefix(authHeader, "Bearer ") {
					// Fallback default demo tenant UUID if no specific claim parsed
					tenantID = "11111111-1111-1111-1111-111111111111"
				} else {
					tenantID = "11111111-1111-1111-1111-111111111111"
				}
			}

			// Begin dedicated transaction
			tx, err := db.BeginTx(r.Context(), &sql.TxOptions{Isolation: sql.LevelReadCommitted})
			if err != nil {
				http.Error(w, `{"error":"Hitilafu ya kuanzisha muamala wa hifadhidata"}`, http.StatusInternalServerError)
				return
			}

			// Enforce PostgreSQL Session RLS
			_, err = tx.ExecContext(r.Context(), "SET LOCAL app.current_tenant_id = $1;", tenantID)
			if err != nil {
				_ = tx.Rollback()
				http.Error(w, `{"error":"Imeshindwa kuweka mipaka ya usalama wa shule (RLS failure)"}`, http.StatusForbidden)
				return
			}

			// Inject Tx and TenantID into Context
			ctx := context.WithValue(r.Context(), TxContextKey, tx)
			ctx = context.WithValue(ctx, TenantContextKey, tenantID)

			// Wrap response writer to capture status code for auto-commit/rollback
			rw := &responseWatcher{ResponseWriter: w, statusCode: http.StatusOK}
			next.ServeHTTP(rw, r.WithContext(ctx))

			// Automatic transactional commit or rollback based on HTTP status
			if rw.statusCode >= 400 {
				_ = tx.Rollback()
			} else {
				if err := tx.Commit(); err != nil {
					_ = tx.Rollback()
				}
			}
		})
	}
}

type responseWatcher struct {
	http.ResponseWriter
	statusCode int
}

func (rw *responseWatcher) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}

package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/google/uuid"
)

type contextKey string

const TenantIDKey contextKey = "tenant_id"

// TenantMiddleware extracts the tenant ID or subdomain and passes it into request context
func TenantMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tenantHeader := r.Header.Get("X-Tenant-ID")
		if tenantHeader == "" {
			// Fallback: extract subdomain from Host (e.g., hillcrest.schools.ke)
			hostParts := strings.Split(r.Host, ".")
			if len(hostParts) > 2 {
				tenantHeader = hostParts[0]
			}
		}

		if tenantHeader == "" {
			http.Error(w, `{"error": "Tenant identification missing"}`, http.StatusBadRequest)
			return
		}

		parsedID, err := uuid.Parse(tenantHeader)
		if err != nil {
			// Allowed if identifying by subdomain lookup in router
			ctx := context.WithValue(r.Context(), TenantIDKey, tenantHeader)
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}

		ctx := context.WithValue(r.Context(), TenantIDKey, parsedID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

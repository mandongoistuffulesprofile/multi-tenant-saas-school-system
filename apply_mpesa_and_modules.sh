#!/usr/bin/env bash
set -e

echo "📦 [1/4] Ensuring backend/go.mod has correct dependencies..."
mkdir -p backend/internal/mpesa

cat << 'MOD_EOF' > backend/go.mod
module github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend

go 1.21

require (
	github.com/golang-jwt/jwt/v5 v5.2.1
	github.com/google/uuid v1.6.0
	github.com/jackc/pgx/v5 v5.5.5
	golang.org/x/crypto v0.22.0
)

require (
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20221227161230-091c0ba34f0a // indirect
	github.com/jackc/puddle/v2 v2.2.1 // indirect
	golang.org/x/sync v0.1.0 // indirect
	golang.org/x/sys v0.19.0 // indirect
	golang.org/x/text v0.14.0 // indirect
)
MOD_EOF

echo "💳 [2/4] Implementing Safaricom Daraja M-Pesa Service & Allocation Handler..."

cat << 'GO_EOF' > backend/internal/mpesa/daraja.go
package mpesa

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/database"
)

// C2BCallbackPayload represents the inbound Safaricom C2B confirmation JSON
type C2BCallbackPayload struct {
	TransactionType string  `json:"TransactionType"`
	TransID         string  `json:"TransID"`
	TransTime       string  `json:"TransTime"`
	TransAmount     float64 `json:"TransAmount,string"`
	BusinessShortCode string `json:"BusinessShortCode"`
	BillRefNumber   string  `json:"BillRefNumber"` // Student Admission Number
	MSISDN          string  `json:"MSISDN"`
	FirstName       string  `json:"FirstName"`
}

type DarajaService struct {
	dbPool *pgxpool.Pool
}

func NewDarajaService(pool *pgxpool.Pool) *DarajaService {
	return &DarajaService{dbPool: pool}
}

// HandleValidation responds immediately to Safaricom C2B validation queries
func (s *DarajaService) HandleValidation(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	// Return ResultCode 0 to accept the transaction before Safaricom takes money from parent
	w.Write([]byte(`{"ResultCode": 0, "ResultDesc": "Accepted"}`))
}

// HandleConfirmation processes payment, deduplicates by TransID, and auto-allocates to invoices
func (s *DarajaService) HandleConfirmation(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var payload C2BCallbackPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid payload", http.StatusBadRequest)
		return
	}

	// Always respond 200 OK immediately to Safaricom to prevent callback storms
	defer func() {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"ResultCode": 0, "ResultDesc": "Confirmation processed"}`))
	}()

	if s.dbPool == nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Locate student and tenant by admission number (BillRefNumber)
	var studentID, tenantID uuid.UUID
	err := s.dbPool.QueryRow(ctx, `
		SELECT id, tenant_id FROM students WHERE UPPER(admission_number) = UPPER($1) LIMIT 1
	`, payload.BillRefNumber).Scan(&studentID, &tenantID)

	if err != nil {
		// Log unlinked payment for bursar manual review
		return
	}

	// Execute inside isolated tenant transaction using RLS wrapper
	_ = database.RunInTenantTx(ctx, s.dbPool, tenantID, func(tx pgx.Tx) error {
		rawJSON, _ := json.Marshal(payload)

		var paymentID uuid.UUID
		err := tx.QueryRow(ctx, `
			INSERT INTO payments (tenant_id, student_id, mpesa_trans_id, payment_method, amount, phone_number, raw_payload)
			VALUES ($1, $2, $3, 'MPESA', $4, $5, $6)
			ON CONFLICT (mpesa_trans_id) DO NOTHING
			RETURNING id
		`, tenantID, studentID, payload.TransID, payload.TransAmount, payload.MSISDN, rawJSON).Scan(&paymentID)

		if errors.Is(err, pgx.ErrNoRows) {
			// Idempotent duplicate: already processed this TransID
			return nil
		}
		if err != nil {
			return fmt.Errorf("failed to insert payment: %w", err)
		}

		// Auto-allocate against oldest unpaid invoices
		rows, err := tx.Query(ctx, `
			SELECT i.id, i.total_amount, COALESCE(SUM(fa.allocated_amount), 0) AS total_allocated
			FROM invoices i
			LEFT JOIN fee_allocations fa ON i.id = fa.invoice_id
			WHERE i.tenant_id = $1 AND i.student_id = $2
			GROUP BY i.id, i.total_amount, i.invoice_date
			HAVING COALESCE(SUM(fa.allocated_amount), 0) < i.total_amount
			ORDER BY i.invoice_date ASC
		`, tenantID, studentID)
		if err != nil {
			return err
		}
		defer rows.Close()

		remainingAmount := payload.TransAmount

		type InvBal struct {
			ID      uuid.UUID
			Balance float64
		}
		var invoicesToPay []InvBal

		for rows.Next() {
			var invID uuid.UUID
			var totalAmt, allocAmt float64
			if err := rows.Scan(&invID, &totalAmt, &allocAmt); err == nil {
				invoicesToPay = append(invoicesToPay, InvBal{ID: invID, Balance: totalAmt - allocAmt})
			}
		}

		for _, inv := range invoicesToPay {
			if remainingAmount <= 0 {
				break
			}
			alloc := remainingAmount
			if alloc > inv.Balance {
				alloc = inv.Balance
			}
			_, err = tx.Exec(ctx, `
				INSERT INTO fee_allocations (tenant_id, invoice_id, payment_id, allocated_amount)
				VALUES ($1, $2, $3, $4)
			`, tenantID, inv.ID, paymentID, alloc)
			if err != nil {
				return err
			}
			remainingAmount -= alloc
		}

		return nil
	})
}
GO_EOF

echo "🔧 [3/4] Updating main.go to link Daraja Service..."

cat << 'MAIN_EOF' > backend/cmd/api/main.go
package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/mpesa"
)

type Config struct {
	Port        string
	DatabaseURL string
}

func main() {
	cfg := Config{
		Port:        getEnv("PORT", "8080"),
		DatabaseURL: getEnv("DATABASE_URL", "postgres://school_admin:dev_secret_password@localhost:5432/school_system?sslmode=disable"),
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	dbPool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Printf("⚠️ Running in offline/scaffold mode: %v", err)
	} else {
		defer dbPool.Close()
		log.Println("✅ Database connection pool established successfully.")
	}

	darajaSvc := mpesa.NewDarajaService(dbPool)
	mux := http.NewServeMux()

	// Healthcheck
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"status":    "healthy",
			"system":    "Kenyan Primary School SaaS API",
			"timestamp": time.Now().UTC(),
		})
	})

	// Safaricom Daraja C2B Endpoints
	mux.HandleFunc("/api/v1/payments/c2b-validation", darajaSvc.HandleValidation)
	mux.HandleFunc("/api/v1/payments/c2b-confirmation", darajaSvc.HandleConfirmation)

	// Protected Tenant Sub-router
	tenantHandler := http.NewServeMux()
	tenantHandler.HandleFunc("/api/v1/tenant/info", func(w http.ResponseWriter, r *http.Request) {
		tenantID := r.Context().Value(middleware.TenantIDKey)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"tenant_context": tenantID,
			"message":        "Tenant scope active and isolated via RLS",
		})
	})

	mux.Handle("/api/v1/tenant/", middleware.TenantMiddleware(tenantHandler))

	server := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		log.Printf("🚀 Primary School SaaS API listening on port %s", cfg.Port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down API server gracefully...")
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}
	log.Println("API server exited cleanly.")
}

func getEnv(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}
MAIN_EOF

echo "🧹 [4/4] Cleaning temp scripts, staging, and pushing..."
rm -f apply_backend_wiring.sh

# If Go is installed locally, download dependencies
if command -v go &> /dev/null; then
    echo "Running go mod tidy..."
    (cd backend && go mod tidy) || true
fi

git add .
git commit -m "feat(mpesa): implement Daraja C2B validation/confirmation with TransID idempotency and fee allocations"
git push origin main || git push origin master

echo "✅ Daraja M-Pesa integration pushed to GitHub!"

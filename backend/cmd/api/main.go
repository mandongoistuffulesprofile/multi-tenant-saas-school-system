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
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/attendance"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/auth"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/cbc"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/mpesa"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/student"
)

type Config struct {
	Port        string
	DatabaseURL string
	JWTSecret   string
}

func main() {
	cfg := Config{
		Port:        getEnv("PORT", "8080"),
		DatabaseURL: getEnv("DATABASE_URL", "postgres://school_admin:dev_secret_password@localhost:5432/school_system?sslmode=disable"),
		JWTSecret:   getEnv("JWT_SECRET", "super-secret-kenyan-school-saas-key-32chars!"),
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

	authHandler := auth.NewHandler(dbPool, []byte(cfg.JWTSecret))
	darajaSvc := mpesa.NewDarajaService(dbPool)
	studentSvc := student.NewService(dbPool)
	cbcSvc := cbc.NewService(dbPool)
	attendanceSvc := attendance.NewService(dbPool)

	mux := http.NewServeMux()

	// 1. Public Endpoints
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"status":    "healthy",
			"system":    "Kenyan Primary School SaaS API",
			"timestamp": time.Now().UTC(),
		})
	})
	mux.HandleFunc("/api/v1/auth/login", authHandler.HandleLogin)
	mux.HandleFunc("/api/v1/payments/c2b-validation", darajaSvc.HandleValidation)
	mux.HandleFunc("/api/v1/payments/c2b-confirmation", darajaSvc.HandleConfirmation)

	// 2. Protected Tenant Sub-router
	tenantMux := http.NewServeMux()

	tenantMux.HandleFunc("/api/v1/tenant/info", func(w http.ResponseWriter, r *http.Request) {
		tenantID := r.Context().Value(middleware.TenantIDKey)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"tenant_context": tenantID,
			"message":        "Tenant scope active and isolated via RLS",
		})
	})

	tenantMux.HandleFunc("/api/v1/tenant/students", studentSvc.HandleStudents)
	tenantMux.HandleFunc("/api/v1/tenant/attendance/roll-call", attendanceSvc.HandleRollCall)
	tenantMux.HandleFunc("/api/v1/tenant/cbc/evaluations", cbcSvc.HandleBulkEvaluations)
	tenantMux.HandleFunc("/api/v1/tenant/cbc/report-card", cbcSvc.HandleReportCard)

	// Wrap tenant routes with TenantMiddleware + AuthMiddleware
	authMiddleware := middleware.AuthMiddleware([]byte(cfg.JWTSecret))
	mux.Handle("/api/v1/tenant/", middleware.TenantMiddleware(authMiddleware(tenantMux)))

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

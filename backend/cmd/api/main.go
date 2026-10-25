package main

import (
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	_ "github.com/lib/pq"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/auth"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/cbc"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/daraja"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/handlers"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
)

func main() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://postgres:postgres@localhost:5432/school_saas?sslmode=disable"
	}

	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		jwtSecret = "super-secure-production-school-secret-key-256bit"
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// Connect to PostgreSQL connection pool
	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		log.Fatalf("Database connection error: %v", err)
	}
	defer db.Close()
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(10)
	db.SetConnMaxLifetime(5 * time.Minute)

	if err := db.Ping(); err != nil {
		log.Printf("Warning: Database ping failed (%v). Ensure Postgres is running.", err)
	}

	// Instantiate Core Services
	authSvc := auth.NewAuthService(jwtSecret)
	mpesaSvc := daraja.NewMpesaService(db)
	cbcSvc := cbc.NewCBCService(db)
	api := handlers.NewAPIHandlers(db, authSvc, mpesaSvc, cbcSvc)

	mux := http.NewServeMux()

	// Base Public Routes
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"status":"healthy","time":"%s"}`, time.Now().UTC().Format(time.RFC3339))
	})

	// Tenant Public Onboarding & Auth
	mux.HandleFunc("/api/v1/auth/register-school", api.RegisterSchoolHandler)
	mux.HandleFunc("/api/v1/auth/login", api.LoginHandler)

	// Daraja M-Pesa Webhook Endpoints (Isolated via Tenant Resolver)
	mux.HandleFunc("/api/v1/daraja/c2b/validation", api.DarajaC2BCallbackHandler)
	mux.HandleFunc("/api/v1/daraja/c2b/confirmation", api.DarajaC2BCallbackHandler)

	// Protected Routes (Require Authentication + Tenant Context)
	authMiddleware := middleware.RequireAuth(authSvc)
	teacherGuard := middleware.RequireRoles("school_admin", "teacher")

	mux.Handle("/api/v1/cbc/assessments/sync", authMiddleware(teacherGuard(http.HandlerFunc(api.CBCSyncHandler))))

	// Wrap root with TenantResolver
	tenantWrapped := middleware.TenantResolver(db)(mux)

	server := &http.Server{
		Addr:         ":" + port,
		Handler:      tenantWrapped,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	log.Printf("School SaaS Backend running on port %s", port)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("Server failed: %v", err)
	}
}

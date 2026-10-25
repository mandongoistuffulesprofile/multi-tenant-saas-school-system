package main

import (
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	_ "github.com/lib/pq"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/audit"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/auth"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/cbc"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/daraja"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/handlers"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/sms"
)

func main() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://postgres:postgrespassword@localhost:5432/school_saas?sslmode=disable"
	}

	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		jwtSecret = "super-secure-production-school-secret-key-256bit"
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		log.Fatalf("Database connection error: %v", err)
	}
	defer db.Close()

	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(10)
	db.SetConnMaxLifetime(5 * time.Minute)

	// Instantiate Core Services
	authSvc := auth.NewAuthService(jwtSecret)
	mpesaSvc := daraja.NewMpesaService(db)
	cbcSvc := cbc.NewCBCService(db)
	smsSvc := sms.NewSMSService()
	auditLogger := audit.NewAuditLogger(db)

	api := handlers.NewAPIHandlers(db, authSvc, mpesaSvc, cbcSvc, smsSvc, auditLogger)

	mux := http.NewServeMux()

	// Public Health Endpoint
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"status":"healthy","time":"%s"}`, time.Now().UTC().Format(time.RFC3339))
	})

	// Public Auth & Onboarding
	mux.HandleFunc("/api/v1/auth/register-school", api.RegisterSchoolHandler)
	mux.HandleFunc("/api/v1/auth/login", api.LoginHandler)

	// Safaricom Webhook Endpoints
	mux.HandleFunc("/api/v1/daraja/c2b/validation", api.DarajaC2BCallbackHandler)
	mux.HandleFunc("/api/v1/daraja/c2b/confirmation", api.DarajaC2BCallbackHandler)
	mux.HandleFunc("/api/v1/daraja/stk/callback", api.STKCallbackHandler)

	// Protected Endpoints
	authMW := middleware.RequireAuth(authSvc)
	teacherMW := middleware.RequireRoles("school_admin", "teacher")
	adminMW := middleware.RequireRoles("school_admin", "accountant")

	// STK Push Trigger
	mux.Handle("/api/v1/daraja/stk/initiate", authMW(http.HandlerFunc(api.InitiateSTKPushHandler)))

	// C2B Registration (Admin Only)
	mux.Handle("/api/v1/daraja/c2b/register", authMW(adminMW(http.HandlerFunc(api.RegisterC2BHandler))))

	// CBC Offline Sync
	mux.Handle("/api/v1/cbc/assessments/sync", authMW(teacherMW(http.HandlerFunc(api.CBCSyncHandler))))

	// Root wrapped with Subdomain Tenant Resolver
	tenantWrapped := middleware.TenantResolver(db)(mux)

	server := &http.Server{
		Addr:         ":" + port,
		Handler:      tenantWrapped,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	log.Printf("School SaaS Backend online at :%s", port)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("Server stopped: %v", err)
	}
}

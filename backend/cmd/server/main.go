package main

import (
	"database/sql"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/pkg/controllers"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/pkg/middleware"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://postgres:postgres@localhost:5432/school_saas?sslmode=disable"
	}

	// Initialize dummy or real DB connection pool
	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		log.Printf("Warning: Database connection not opened: %v. Running in mock mode.", err)
	} else {
		db.SetMaxOpenConns(25)
		db.SetMaxIdleConns(10)
		db.SetConnMaxLifetime(5 * time.Minute)
	}

	mux := http.NewServeMux()

	mpesaCtrl := controllers.NewMpesaController(db)
	cbcCtrl := controllers.NewCBCController(db)

	// API Routes wrapped in Transactional RLS Middleware
	mux.HandleFunc("/api/v1/mpesa/callback", mpesaCtrl.IngestCallback)
	mux.HandleFunc("/api/v1/mpesa/unallocated", mpesaCtrl.GetUnallocatedPool)
	mux.HandleFunc("/api/v1/cbc/assessment", cbcCtrl.RecordAssessment)
	mux.HandleFunc("/api/v1/sync/batch", cbcCtrl.BatchSync)

	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"healthy","system":"EduKe SaaS Go Engine"}`))
	})

	handler := middleware.TransactionalRLSMiddleware(db)(mux)

	log.Printf(">>> EduKe Go Engine listening on :%s", port)
	if err := http.ListenAndServe(":"+port, handler); err != nil {
		log.Fatalf("Server stopped: %v", err)
	}
}

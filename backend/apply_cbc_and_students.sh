#!/usr/bin/env bash
set -e

echo "🎓 [1/4] Implementing Student Admission & Stream Service..."
mkdir -p backend/internal/student
mkdir -p backend/internal/cbc

cat << 'GO_EOF' > backend/internal/student/student.go
package student

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/database"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
)

type Student struct {
	ID              uuid.UUID  `json:"id"`
	AdmissionNumber string     `json:"admission_number"`
	UPINemis        *string    `json:"upi_nemis,omitempty"`
	FirstName       string     `json:"first_name"`
	LastName        string     `json:"last_name"`
	Gender          string     `json:"gender"`
	DateOfBirth     string     `json:"date_of_birth"`
	CurrentStreamID *uuid.UUID `json:"current_stream_id,omitempty"`
	Status          string     `json:"status"`
}

type Service struct {
	dbPool *pgxpool.Pool
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{dbPool: pool}
}

func (s *Service) HandleStudents(w http.ResponseWriter, r *http.Request) {
	tenantVal := r.Context().Value(middleware.TenantIDKey)
	tenantID, ok := tenantVal.(uuid.UUID)
	if !ok {
		http.Error(w, `{"error": "Invalid tenant context"}`, http.StatusUnauthorized)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	switch r.Method {
	case http.MethodGet:
		s.listStudents(w, r, tenantID)
	case http.MethodPost:
		s.admitStudent(w, r, tenantID)
	default:
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
	}
}

func (s *Service) listStudents(w http.ResponseWriter, r *http.Request, tenantID uuid.UUID) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var students []Student
	err := database.RunInTenantTx(ctx, s.dbPool, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT id, admission_number, upi_nemis, first_name, last_name, gender, TO_CHAR(date_of_birth, 'YYYY-MM-DD'), current_stream_id, status
			FROM students
			WHERE tenant_id = $1
			ORDER BY first_name ASC
		`, tenantID)
		if err != nil {
			return err
		}
		defer rows.Close()

		for rows.Next() {
			var st Student
			if err := rows.Scan(&st.ID, &st.AdmissionNumber, &st.UPINemis, &st.FirstName, &st.LastName, &st.Gender, &st.DateOfBirth, &st.CurrentStreamID, &st.Status); err == nil {
				students = append(students, st)
			}
		}
		return nil
	})

	if err != nil {
		http.Error(w, `{"error": "Failed to fetch students"}`, http.StatusInternalServerError)
		return
	}

	if students == nil {
		students = []Student{}
	}
	json.NewEncoder(w).Encode(students)
}

func (s *Service) admitStudent(w http.ResponseWriter, r *http.Request, tenantID uuid.UUID) {
	var req struct {
		AdmissionNumber string     `json:"admission_number"`
		UPINemis        *string    `json:"upi_nemis"`
		FirstName       string     `json:"first_name"`
		LastName        string     `json:"last_name"`
		Gender          string     `json:"gender"`
		DateOfBirth     string     `json:"date_of_birth"`
		CurrentStreamID *uuid.UUID `json:"current_stream_id"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error": "Invalid request body"}`, http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var newID uuid.UUID
	err := database.RunInTenantTx(ctx, s.dbPool, tenantID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			INSERT INTO students (tenant_id, admission_number, upi_nemis, first_name, last_name, gender, date_of_birth, current_stream_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7::DATE, $8)
			RETURNING id
		`, tenantID, req.AdmissionNumber, req.UPINemis, req.FirstName, req.LastName, req.Gender, req.DateOfBirth, req.CurrentStreamID).Scan(&newID)
	})

	if err != nil {
		http.Error(w, `{"error": "Admission failed. Admission number may already exist."}`, http.StatusConflict)
		return
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]any{
		"message":    "Student admitted successfully",
		"student_id": newID,
	})
}
GO_EOF

echo "📋 [2/4] Implementing CBC Evaluation Engine & Report Card Aggregator..."

cat << 'GO_EOF' > backend/internal/cbc/cbc.go
package cbc

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/database"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
)

type EvaluationEntry struct {
	StudentID uuid.UUID `json:"student_id"`
	StrandID  uuid.UUID `json:"strand_id"`
	Rating    string    `json:"rating"` // EE, ME, AE, BE
	Comments  string    `json:"comments"`
}

type ReportCardItem struct {
	LearningArea string    `json:"learning_area"`
	StrandTitle  string    `json:"strand_title"`
	Rating       string    `json:"rating"`
	Comments     string    `json:"comments"`
	AssessedAt   time.Time `json:"assessed_at"`
}

type Service struct {
	dbPool *pgxpool.Pool
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{dbPool: pool}
}

// HandleBulkEvaluations records immutable CBC formative events
func (s *Service) HandleBulkEvaluations(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	tenantVal := r.Context().Value(middleware.TenantIDKey)
	tenantID, ok := tenantVal.(uuid.UUID)
	if !ok {
		http.Error(w, `{"error": "Invalid tenant context"}`, http.StatusUnauthorized)
		return
	}

	var req struct {
		Evaluations []EvaluationEntry `json:"evaluations"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.Evaluations) == 0 {
		http.Error(w, `{"error": "Invalid evaluation payload"}`, http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	// Append-only batch insert into cbc_evaluation_events
	err := database.RunInTenantTx(ctx, s.dbPool, tenantID, func(tx pgx.Tx) error {
		for _, ev := range req.Evaluations {
			_, err := tx.Exec(ctx, `
				INSERT INTO cbc_evaluation_events (tenant_id, student_id, strand_id, rating, comments)
				VALUES ($1, $2, $3, $4, $5)
			`, tenantID, ev.StudentID, ev.StrandID, ev.Rating, ev.Comments)
			if err != nil {
				return err
			}
		}
		return nil
	})

	if err != nil {
		http.Error(w, `{"error": "Failed to record evaluations"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]any{
		"message": "CBC Evaluations recorded successfully",
		"count":   len(req.Evaluations),
	})
}

// HandleReportCard extracts the latest performance rubric per sub-strand for a learner
func (s *Service) HandleReportCard(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	tenantVal := r.Context().Value(middleware.TenantIDKey)
	tenantID, ok := tenantVal.(uuid.UUID)
	if !ok {
		http.Error(w, `{"error": "Invalid tenant context"}`, http.StatusUnauthorized)
		return
	}

	studentIDStr := r.URL.Query().Get("student_id")
	studentID, err := uuid.Parse(studentIDStr)
	if err != nil {
		http.Error(w, `{"error": "Missing or invalid student_id query parameter"}`, http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var reportItems []ReportCardItem
	err = database.RunInTenantTx(ctx, s.dbPool, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT DISTINCT ON (e.student_id, e.strand_id)
				la.name, s.title, e.rating, COALESCE(e.comments, ''), e.assessed_at
			FROM cbc_evaluation_events e
			JOIN cbc_strands s ON e.strand_id = s.id
			JOIN cbc_learning_areas la ON s.learning_area_id = la.id
			WHERE e.tenant_id = $1 AND e.student_id = $2
			ORDER BY e.student_id, e.strand_id, e.assessed_at DESC
		`, tenantID, studentID)
		if err != nil {
			return err
		}
		defer rows.Close()

		for rows.Next() {
			var item ReportCardItem
			if err := rows.Scan(&item.LearningArea, &item.StrandTitle, &item.Rating, &item.Comments, &item.AssessedAt); err == nil {
				reportItems = append(reportItems, item)
			}
		}
		return nil
	})

	if err != nil {
		http.Error(w, `{"error": "Failed to compile report card"}`, http.StatusInternalServerError)
		return
	}

	if reportItems == nil {
		reportItems = []ReportCardItem{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"student_id": studentID,
		"results":    reportItems,
	})
}
GO_EOF

echo "🔧 [3/4] Registering Student & CBC Routes into main.go..."

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
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/cbc"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/mpesa"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/student"
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
	studentSvc := student.NewService(dbPool)
	cbcSvc := cbc.NewService(dbPool)

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

	// Student Management
	tenantHandler.HandleFunc("/api/v1/tenant/students", studentSvc.HandleStudents)

	// CBC Assessment Handlers
	tenantHandler.HandleFunc("/api/v1/tenant/cbc/evaluations", cbcSvc.HandleBulkEvaluations)
	tenantHandler.HandleFunc("/api/v1/tenant/cbc/report-card", cbcSvc.HandleReportCard)

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

echo "🧹 [4/4] Cleaning temp script and pushing..."
rm -f apply_mpesa_and_modules.sh

git add .
git commit -m "feat(cbc): implement student admission and CBC rubric evaluation engine with report card aggregator"
git push origin main || git push origin master

echo "✅ Student & CBC assessment engine pushed to GitHub!"

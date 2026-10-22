#!/usr/bin/env bash
set -e

# 1. Automatically jump to the Git repository root
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"
echo "📂 Switched to repository root: $(pwd)"

# 2. Clean up any misplaced folders created inside backend/
rm -rf backend/migrations
rm -rf backend/backend
rm -f apply_auth_and_attendance.sh

echo "📁 [1/5] Ensuring all subdirectories exist..."
mkdir -p migrations/slice3
mkdir -p backend/internal/database
mkdir -p backend/internal/middleware
mkdir -p backend/internal/auth
mkdir -p backend/internal/attendance
mkdir -p backend/internal/cbc
mkdir -p backend/internal/student
mkdir -p backend/internal/mpesa
mkdir -p backend/cmd/api

echo "📦 [2/5] Creating Migration Slice 3 (Guardians, Attendance, CBC Sub-strands)..."

cat << 'SQL_EOF' > migrations/slice3/004_comprehensive_modules.sql
-- migrations/slice3/004_comprehensive_modules.sql
-- Guardians, Daily Attendance, KICD Sub-strands & Teacher Allocations

CREATE TABLE IF NOT EXISTS guardians (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    first_name VARCHAR(64) NOT NULL,
    last_name VARCHAR(64) NOT NULL,
    phone_number VARCHAR(20) NOT NULL,
    id_number VARCHAR(32),
    email VARCHAR(255),
    relationship VARCHAR(32) NOT NULL CHECK (relationship IN ('FATHER', 'MOTHER', 'LEGAL_GUARDIAN', 'SPONSOR')),
    is_primary_contact BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE guardians ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardians FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_guardians ON guardians
    FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS student_guardians (
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    guardian_id UUID NOT NULL REFERENCES guardians(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    PRIMARY KEY (student_id, guardian_id)
);

ALTER TABLE student_guardians ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_guardians FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_student_guardians ON student_guardians
    FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS attendance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    stream_id UUID NOT NULL REFERENCES class_streams(id) ON DELETE CASCADE,
    attendance_date DATE NOT NULL DEFAULT CURRENT_DATE,
    session VARCHAR(10) NOT NULL DEFAULT 'MORNING' CHECK (session IN ('MORNING', 'AFTERNOON')),
    status VARCHAR(10) NOT NULL CHECK (status IN ('PRESENT', 'ABSENT', 'EXCUSED', 'SICK')),
    remarks TEXT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_student_daily_attendance UNIQUE (tenant_id, student_id, attendance_date, session)
);

ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_attendance ON attendance_records
    FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS cbc_sub_strands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    strand_id UUID NOT NULL REFERENCES cbc_strands(id) ON DELETE CASCADE,
    title VARCHAR(150) NOT NULL,
    specific_learning_outcomes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE cbc_sub_strands ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbc_sub_strands FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_substrands ON cbc_sub_strands
    FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS teacher_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stream_id UUID NOT NULL REFERENCES class_streams(id) ON DELETE CASCADE,
    is_class_teacher BOOLEAN NOT NULL DEFAULT false,
    academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_teacher_stream UNIQUE (tenant_id, teacher_id, stream_id, academic_year_id)
);

ALTER TABLE teacher_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_allocations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_teacher_alloc ON teacher_allocations
    FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
SQL_EOF

echo "🔐 [3/5] Writing Auth Middleware and Login Handlers..."

cat << 'GO_EOF' > backend/internal/middleware/auth.go
package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/auth"
)

const (
	UserIDKey contextKey = "user_id"
	RoleKey   contextKey = "user_role"
)

func AuthMiddleware(jwtSecret []byte) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
				http.Error(w, `{"error": "Missing or invalid authorization header"}`, http.StatusUnauthorized)
				return
			}

			tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
			claims := &auth.CustomClaims{}

			token, err := jwt.ParseWithClaims(tokenStr, claims, func(token *jwt.Token) (interface{}, error) {
				return jwtSecret, nil
			})

			if err != nil || !token.Valid {
				http.Error(w, `{"error": "Invalid or expired token"}`, http.StatusUnauthorized)
				return
			}

			if tenantIDVal := r.Context().Value(TenantIDKey); tenantIDVal != nil {
				if tenantID, ok := tenantIDVal.(uuid.UUID); ok && tenantID != claims.TenantID {
					http.Error(w, `{"error": "Tenant boundary violation"}`, http.StatusForbidden)
					return
				}
			}

			ctx := context.WithValue(r.Context(), UserIDKey, claims.UserID)
			ctx = context.WithValue(ctx, RoleKey, claims.Role)
			ctx = context.WithValue(ctx, TenantIDKey, claims.TenantID)

			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func RequireRole(allowedRoles ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			roleVal := r.Context().Value(RoleKey)
			userRole, ok := roleVal.(string)
			if !ok {
				http.Error(w, `{"error": "Unauthorized role context"}`, http.StatusForbidden)
				return
			}

			for _, allowed := range allowedRoles {
				if userRole == allowed {
					next.ServeHTTP(w, r)
					return
				}
			}

			http.Error(w, `{"error": "Insufficient permissions"}`, http.StatusForbidden)
		})
	}
}
GO_EOF

cat << 'GO_EOF' > backend/internal/auth/handler.go
package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Handler struct {
	dbPool    *pgxpool.Pool
	jwtSecret []byte
}

func NewHandler(pool *pgxpool.Pool, secret []byte) *Handler {
	return &Handler{dbPool: pool, jwtSecret: secret}
}

func (h *Handler) HandleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Subdomain string `json:"subdomain"`
		Email     string `json:"email"`
		Password  string `json:"password"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error": "Invalid request payload"}`, http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var userID, tenantID uuid.UUID
	var passwordHash, role, firstName, lastName string

	err := h.dbPool.QueryRow(ctx, `
		SELECT u.id, u.tenant_id, u.password_hash, u.role, u.first_name, u.last_name
		FROM users u
		JOIN tenants t ON u.tenant_id = t.id
		WHERE t.subdomain = $1 AND (LOWER(u.email) = LOWER($2) OR u.phone_number = $2) AND u.is_active = true
	`, req.Subdomain, req.Email).Scan(&userID, &tenantID, &passwordHash, &role, &firstName, &lastName)

	if err != nil {
		http.Error(w, `{"error": "Invalid credentials or inactive account"}`, http.StatusUnauthorized)
		return
	}

	valid, _ := ComparePassword(req.Password, passwordHash)
	if !valid {
		http.Error(w, `{"error": "Invalid credentials"}`, http.StatusUnauthorized)
		return
	}

	token, err := GenerateJWT(h.jwtSecret, userID, tenantID, role)
	if err != nil {
		http.Error(w, `{"error": "Failed to generate session token"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"token": token,
		"user": map[string]any{
			"id":         userID,
			"tenant_id":  tenantID,
			"first_name": firstName,
			"last_name":  lastName,
			"role":       role,
		},
	})
}
GO_EOF

echo "📋 [4/5] Writing Attendance Service & updating main.go..."

cat << 'GO_EOF' > backend/internal/attendance/attendance.go
package attendance

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

type AttendanceEntry struct {
	StudentID uuid.UUID `json:"student_id"`
	Status    string    `json:"status"`
	Remarks   *string   `json:"remarks"`
}

type Service struct {
	dbPool *pgxpool.Pool
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{dbPool: pool}
}

func (s *Service) HandleRollCall(w http.ResponseWriter, r *http.Request) {
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
		StreamID uuid.UUID         `json:"stream_id"`
		Date     string            `json:"date"`
		Session  string            `json:"session"`
		Entries  []AttendanceEntry `json:"entries"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.Entries) == 0 {
		http.Error(w, `{"error": "Invalid attendance payload"}`, http.StatusBadRequest)
		return
	}

	if req.Session == "" {
		req.Session = "MORNING"
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	err := database.RunInTenantTx(ctx, s.dbPool, tenantID, func(tx pgx.Tx) error {
		for _, entry := range req.Entries {
			_, err := tx.Exec(ctx, `
				INSERT INTO attendance_records (tenant_id, student_id, stream_id, attendance_date, session, status, remarks)
				VALUES ($1, $2, $3, $4::DATE, $5, $6, $7)
				ON CONFLICT (tenant_id, student_id, attendance_date, session)
				DO UPDATE SET status = EXCLUDED.status, remarks = EXCLUDED.remarks, recorded_at = NOW()
			`, tenantID, entry.StudentID, req.StreamID, req.Date, req.Session, entry.Status, entry.Remarks)
			if err != nil {
				return err
			}
		}
		return nil
	})

	if err != nil {
		http.Error(w, `{"error": "Failed to record attendance"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]any{
		"message": "Roll call recorded successfully",
		"count":   len(req.Entries),
	})
}
GO_EOF

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
MAIN_EOF

echo "🚀 [5/5] Committing and Pushing fixes to GitHub..."
git add .
git commit -m "feat(auth-attendance): add guardians, attendance roll call, KICD sub-strands, JWT login and RBAC"
git push origin main || git push origin master

rm -f run_auth_and_attendance_fix.sh
echo "✅ All fixes applied and pushed successfully!"

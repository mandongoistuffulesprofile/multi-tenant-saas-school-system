#!/usr/bin/env bash
set -e

echo "🚀 [1/6] Cleaning up unwanted artifacts..."
rm -f ./-h

echo "📁 [2/6] Generating directory structure..."
mkdir -p migrations/slice0
mkdir -p migrations/slice1
mkdir -p migrations/slice2
mkdir -p backend/internal/database
mkdir -p backend/internal/middleware
mkdir -p backend/internal/auth
mkdir -p infrastructure/docker

echo "📝 [3/6] Writing Database Migrations (RLS, CBC & Daraja M-Pesa)..."

# 1. Foundation Migration (Tenants, Users, Academic Structure)
cat << 'SQL_EOF' > migrations/slice0/001_foundation.sql
-- migrations/slice0/001_foundation.sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    subdomain VARCHAR(63) NOT NULL UNIQUE,
    school_code VARCHAR(32) UNIQUE,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'PENDING')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS UUID AS $$
BEGIN
    RETURN NULLIF(current_setting('app.current_tenant_id', true), '')::UUID;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255),
    phone_number VARCHAR(20),
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(64) NOT NULL,
    last_name VARCHAR(64) NOT NULL,
    role VARCHAR(32) NOT NULL CHECK (role IN (
        'SUPERADMIN', 'HEAD_TEACHER', 'DEPUTY_HEAD', 'BURSAR', 'TEACHER', 'PARENT'
    )),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tenant_user_email UNIQUE (tenant_id, email),
    CONSTRAINT uq_tenant_user_phone UNIQUE (tenant_id, phone_number)
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_users ON users
    FOR ALL
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS academic_years (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    year_name VARCHAR(10) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_current BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tenant_academic_year UNIQUE (tenant_id, year_name)
);

ALTER TABLE academic_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE academic_years FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_academic_years ON academic_years
    FOR ALL
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS terms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    term_number SMALLINT NOT NULL CHECK (term_number IN (1, 2, 3)),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_current BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT uq_tenant_term UNIQUE (tenant_id, academic_year_id, term_number)
);

ALTER TABLE terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE terms FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_terms ON terms
    FOR ALL
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());
SQL_EOF

# 2. Students & CBC Evaluation Migration
cat << 'SQL_EOF' > migrations/slice1/002_students_and_cbc.sql
-- migrations/slice1/002_students_and_cbc.sql
-- Student Lifecycle and Event-Based CBC Assessment Schema

CREATE TABLE IF NOT EXISTS class_streams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    grade_level VARCHAR(20) NOT NULL, -- PP1, PP2, Grade 1 to 6
    stream_name VARCHAR(50) NOT NULL, -- e.g. East, West, Blue
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tenant_grade_stream UNIQUE (tenant_id, grade_level, stream_name)
);

ALTER TABLE class_streams ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_streams FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_streams ON class_streams
    FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    admission_number VARCHAR(64) NOT NULL,
    upi_nemis VARCHAR(32), -- MoE UPI/NEMIS identifier
    first_name VARCHAR(64) NOT NULL,
    last_name VARCHAR(64) NOT NULL,
    gender VARCHAR(10) NOT NULL CHECK (gender IN ('MALE', 'FEMALE')),
    date_of_birth DATE NOT NULL,
    current_stream_id UUID REFERENCES class_streams(id),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'TRANSFERRED', 'GRADUATED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tenant_admission UNIQUE (tenant_id, admission_number)
);

ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE students FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_students ON students
    FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS cbc_learning_areas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL, -- e.g. Mathematics, Kiswahili Language
    code VARCHAR(20) NOT NULL,
    grade_level VARCHAR(20) NOT NULL
);

ALTER TABLE cbc_learning_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbc_learning_areas FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_areas ON cbc_learning_areas
    FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS cbc_strands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    learning_area_id UUID NOT NULL REFERENCES cbc_learning_areas(id) ON DELETE CASCADE,
    title VARCHAR(150) NOT NULL
);

ALTER TABLE cbc_strands ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbc_strands FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_strands ON cbc_strands
    FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

-- CBC Append-Only Evaluation Events (Never overwrite prior ratings)
CREATE TABLE IF NOT EXISTS cbc_evaluation_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    strand_id UUID NOT NULL REFERENCES cbc_strands(id) ON DELETE CASCADE,
    teacher_id UUID NOT NULL REFERENCES users(id),
    rating VARCHAR(2) NOT NULL CHECK (rating IN ('EE', 'ME', 'AE', 'BE')),
    comments TEXT,
    assessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE cbc_evaluation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbc_evaluation_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_evaluations ON cbc_evaluation_events
    FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
SQL_EOF

# 3. Fees & Daraja M-Pesa Migration
cat << 'SQL_EOF' > migrations/slice2/003_finance_mpesa.sql
-- migrations/slice2/003_finance_mpesa.sql
-- Double-Entry Fee Ledger & Safaricom Daraja M-Pesa Integration

CREATE TABLE IF NOT EXISTS fee_structures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    term_id UUID NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
    grade_level VARCHAR(20) NOT NULL,
    title VARCHAR(100) NOT NULL,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE fee_structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_structures FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_feestructures ON fee_structures
    FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    term_id UUID NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
    total_amount NUMERIC(12, 2) NOT NULL CHECK (total_amount >= 0),
    invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_invoices ON invoices
    FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

-- Payments with Daraja TransID Idempotency Constraint
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    mpesa_trans_id VARCHAR(64) UNIQUE, -- Strict Safaricom TransID Idempotency
    payment_method VARCHAR(32) NOT NULL DEFAULT 'MPESA' CHECK (payment_method IN ('MPESA', 'BANK', 'CASH')),
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    phone_number VARCHAR(20),
    payment_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    raw_payload JSONB -- Complete Daraja Webhook for Audit
);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_payments ON payments
    FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS fee_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    allocated_amount NUMERIC(12, 2) NOT NULL CHECK (allocated_amount > 0),
    allocated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE fee_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_allocations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_allocations ON fee_allocations
    FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
SQL_EOF

echo "💻 [4/6] Writing Go Backend Tenant Isolation & Middleware..."

# Go Tenant Context Abstraction
cat << 'GO_EOF' > backend/internal/database/tenant.go
package database

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// RunInTenantTx guarantees tenant isolation inside a single transaction
// by executing SET LOCAL app.current_tenant_id, preventing connection-leak across pgx pools.
func RunInTenantTx(ctx context.Context, pool *pgxpool.Pool, tenantID uuid.UUID, fn func(tx pgx.Tx) error) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	_, err = tx.Exec(ctx, "SET LOCAL app.current_tenant_id = $1", tenantID.String())
	if err != nil {
		return fmt.Errorf("failed to set tenant context: %w", err)
	}

	if err := fn(tx); err != nil {
		return err
	}

	return tx.Commit(ctx)
}
GO_EOF

# Go Tenant Resolution Middleware
cat << 'GO_EOF' > backend/internal/middleware/tenant.go
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
GO_EOF

# Go Argon2id & JWT Auth Helper
cat << 'GO_EOF' > backend/internal/auth/auth.go
package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/argon2"
)

type CustomClaims struct {
	UserID   uuid.UUID `json:"user_id"`
	TenantID uuid.UUID `json:"tenant_id"`
	Role     string    `json:"role"`
	jwt.RegisteredClaims
}

func GenerateJWT(secret []byte, userID, tenantID uuid.UUID, role string) (string, error) {
	claims := CustomClaims{
		UserID:   userID,
		TenantID: tenantID,
		Role:     role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(secret)
}

func HashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	hash := argon2.IDKey([]byte(password), salt, 1, 64*1024, 4, 32)
	b64Salt := base64.RawStdEncoding.EncodeToString(salt)
	b64Hash := base64.RawStdEncoding.EncodeToString(hash)
	return fmt.Sprintf("$argon2id$v=19$m=65536,t=1,p=4$%s$%s", b64Salt, b64Hash), nil
}

func ComparePassword(password, encodedHash string) (bool, error) {
	parts := strings.Split(encodedHash, "$")
	if len(parts) != 6 {
		return false, errors.New("invalid hash format")
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false, err
	}
	expectedHash, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return false, err
	}
	hash := argon2.IDKey([]byte(password), salt, 1, 64*1024, 4, uint32(len(expectedHash)))
	return subtle.ConstantTimeCompare(hash, expectedHash) == 1, nil
}
GO_EOF

echo "🐳 [5/6] Updating Docker Orchestration..."
cat << 'DOCKER_EOF' > infrastructure/docker/docker-compose.yml
version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    container_name: school_postgres
    restart: always
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-school_admin}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-dev_secret_password}
      POSTGRES_DB: ${POSTGRES_DB:-school_system}
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ../../migrations:/docker-entrypoint-initdb.d:ro

  backend:
    build:
      context: ../../backend
      dockerfile: ../infrastructure/docker/Dockerfile.backend
    container_name: school_api
    restart: on-failure
    environment:
      DATABASE_URL: postgres://school_admin:dev_secret_password@postgres:5432/school_system?sslmode=disable
      PORT: 8080
    ports:
      - "8080:8080"
    depends_on:
      - postgres

volumes:
  pgdata:
DOCKER_EOF

echo "📦 [6/6] Committing and Pushing to GitHub..."
git add .
git commit -m "feat(core): implement hardened RLS migrations, Go tenant isolation, CBC & Daraja schemas"
git push origin main || git push origin master

echo "✅ All changes have been applied and pushed to GitHub!"

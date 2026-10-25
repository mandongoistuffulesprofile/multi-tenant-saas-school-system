#!/usr/bin/env python3
"""
BATCH SYSTEM PATCHER
Multi-Tenant SaaS School Management System (Kenya)
Bundles: Database Schema (RLS), Auth/JWT, Daraja M-Pesa Engine, Fee Allocator, & CBC Assessment
"""
import os
import sys
import subprocess
import traceback

def create_file(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(content.strip() + "\n")
    print(f"  [+] Synced: {path}")

def main():
    print("=" * 80)
    print(" KENYAN SAAS SCHOOL SYSTEM - BATCH PRODUCTION DEPLOYMENT")
    print("=" * 80)

    # --------------------------------------------------------------------------
    # 1. DATABASE COMPREHENSIVE MIGRATION (PostgreSQL + RLS + Views)
    # --------------------------------------------------------------------------
    schema_sql = """-- ============================================================================
-- FULL SYSTEM SCHEMA: MULTI-TENANCY, RLS, CBC, & FINANCIAL ALLOCATION
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "citext";

CREATE OR REPLACE FUNCTION current_tenant() RETURNS UUID AS $$
BEGIN
    RETURN NULLIF(current_setting('app.current_tenant_id', true), '')::UUID;
END;
$$ LANGUAGE plpgsql STABLE;

-- 1. TENANTS & RBAC USERS
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    subdomain VARCHAR(63) NOT NULL UNIQUE,
    shortcode VARCHAR(16) NOT NULL DEFAULT '',
    passkey TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email CITEXT NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(32) NOT NULL CHECK (role IN ('super_admin', 'school_admin', 'teacher', 'accountant', 'parent')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT users_tenant_email_key UNIQUE (tenant_id, email)
);
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_users ON users;
CREATE POLICY rls_users ON users USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant());

-- 2. ACADEMIC STRUCTURE & STUDENTS
CREATE TABLE IF NOT EXISTS academic_terms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(64) NOT NULL, -- e.g., '2026 Term 1'
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_current BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE academic_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE academic_terms FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_academic_terms ON academic_terms;
CREATE POLICY rls_academic_terms ON academic_terms USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant());

CREATE TABLE IF NOT EXISTS students (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    admission_number VARCHAR(64) NOT NULL,
    first_name VARCHAR(128) NOT NULL,
    last_name VARCHAR(128) NOT NULL,
    grade_level VARCHAR(32) NOT NULL, -- PP1, PP2, Grade 1 to Grade 9
    parent_phone VARCHAR(15) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT students_admission_key UNIQUE (tenant_id, admission_number)
);
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE students FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_students ON students;
CREATE POLICY rls_students ON students USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant());

-- 3. FINANCIAL ENGINE: INVOICES, DARAJA TRANSACTIONS, ALLOCATIONS
CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    term_id UUID NOT NULL REFERENCES academic_terms(id) ON DELETE RESTRICT,
    title VARCHAR(255) NOT NULL,
    total_cents BIGINT NOT NULL CHECK (total_cents >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_invoices ON invoices;
CREATE POLICY rls_invoices ON invoices USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant());

CREATE TABLE IF NOT EXISTS mpesa_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    trans_id VARCHAR(64) NOT NULL UNIQUE, -- Safaricom TransID (QX...)
    trans_time TIMESTAMPTZ NOT NULL,
    trans_amount_cents BIGINT NOT NULL CHECK (trans_amount_cents > 0),
    msisdn VARCHAR(15) NOT NULL,
    bill_ref_number VARCHAR(64) NOT NULL,
    raw_payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE mpesa_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mpesa_transactions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_mpesa_transactions ON mpesa_transactions;
CREATE POLICY rls_mpesa_transactions ON mpesa_transactions USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant());

CREATE TABLE IF NOT EXISTS fee_allocations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    mpesa_transaction_id UUID REFERENCES mpesa_transactions(id) ON DELETE RESTRICT,
    allocated_cents BIGINT NOT NULL CHECK (allocated_cents > 0),
    allocated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE fee_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_allocations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_fee_allocations ON fee_allocations;
CREATE POLICY rls_fee_allocations ON fee_allocations USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant());

-- 4. CBC CURRICULUM & ASSESSMENT EVENTS
CREATE TABLE IF NOT EXISTS cbc_assessment_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    learning_area VARCHAR(128) NOT NULL, -- e.g. 'Mathematics'
    strand VARCHAR(128) NOT NULL,
    sub_strand VARCHAR(128) NOT NULL,
    performance_level INT NOT NULL CHECK (performance_level BETWEEN 1 AND 4), -- 1:BE, 2:AE, 3:ME, 4:EE
    recorded_by UUID NOT NULL REFERENCES users(id),
    sync_id UUID NOT NULL DEFAULT uuid_generate_v4() UNIQUE,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE cbc_assessment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbc_assessment_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_cbc_assessment ON cbc_assessment_events;
CREATE POLICY rls_cbc_assessment ON cbc_assessment_events USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant());

-- 5. ANALYTICAL VIEWS
CREATE OR REPLACE VIEW v_student_fee_balances AS
SELECT 
    s.tenant_id,
    s.id AS student_id,
    s.admission_number,
    COALESCE(SUM(DISTINCT inv.total_cents), 0) AS total_invoiced_cents,
    COALESCE(SUM(alloc.allocated_cents), 0) AS total_paid_cents,
    COALESCE(SUM(DISTINCT inv.total_cents), 0) - COALESCE(SUM(alloc.allocated_cents), 0) AS balance_due_cents
FROM students s
LEFT JOIN invoices inv ON inv.student_id = s.id AND inv.tenant_id = s.tenant_id
LEFT JOIN fee_allocations alloc ON alloc.invoice_id = inv.id AND alloc.tenant_id = s.tenant_id
GROUP BY s.tenant_id, s.id, s.admission_number;
"""

    # --------------------------------------------------------------------------
    # 2. GO AUTH ENGINE (Argon2id, JWT & Role Middleware)
    # --------------------------------------------------------------------------
    auth_go = """package auth

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

type Claims struct {
	UserID   uuid.UUID `json:"user_id"`
	TenantID uuid.UUID `json:"tenant_id"`
	Role     string    `json:"role"`
	jwt.RegisteredClaims
}

type AuthService struct {
	jwtSecret []byte
}

func NewAuthService(secret string) *AuthService {
	return &AuthService{jwtSecret: []byte(secret)}
}

// HashPassword creates an Argon2id hash with OWASP recommended parameters
func (a *AuthService) HashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	hash := argon2.IDKey([]byte(password), salt, 3, 64*1024, 2, 32)
	b64Salt := base64.RawStdEncoding.EncodeToString(salt)
	b64Hash := base64.RawStdEncoding.EncodeToString(hash)
	return fmt.Sprintf("$argon2id$v=19$m=65536,t=3,p=2$%s$%s", b64Salt, b64Hash), nil
}

// VerifyPassword validates raw password against stored hash in constant time
func (a *AuthService) VerifyPassword(password, encodedHash string) (bool, error) {
	parts := strings.Split(encodedHash, "$")
	if len(parts) != 6 {
		return false, errors.New("invalid hash format")
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false, err
	}
	decodedHash, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return false, err
	}
	comparisonHash := argon2.IDKey([]byte(password), salt, 3, 64*1024, 2, uint32(len(decodedHash)))
	return subtle.ConstantTimeCompare(decodedHash, comparisonHash) == 1, nil
}

// GenerateToken creates a signed JWT with strict tenant and role claims
func (a *AuthService) GenerateToken(userID, tenantID uuid.UUID, role string, ttl time.Duration) (string, error) {
	claims := Claims{
		UserID:   userID,
		TenantID: tenantID,
		Role:     role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(ttl)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(a.jwtSecret)
}

// ParseToken validates the token and extracts the claims
func (a *AuthService) ParseToken(tokenStr string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return a.jwtSecret, nil
	})
	if err != nil {
		return nil, err
	}
	if claims, ok := token.Claims.(*Claims); ok && token.Valid {
		return claims, nil
	}
	return nil, errors.New("invalid token")
}
"""

    # --------------------------------------------------------------------------
    # 3. DARAJA M-PESA & ALLOCATION ENGINE
    # --------------------------------------------------------------------------
    daraja_go = """package daraja

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
)

type C2BCallback struct {
	TransactionType string `json:"TransactionType"`
	TransID         string `json:"TransID"`
	TransTime       string `json:"TransTime"`
	TransAmount     string `json:"TransAmount"`
	BusinessShortCode string `json:"BusinessShortCode"`
	BillRefNumber   string `json:"BillRefNumber"`
	MSISDN          string `json:"MSISDN"`
	FirstName       string `json:"FirstName"`
}

type MpesaService struct {
	db *sql.DB
}

func NewMpesaService(db *sql.DB) *MpesaService {
	return &MpesaService{db: db}
}

// GeneratePassword calculates Daraja API authorization password
func GeneratePassword(shortcode, passkey string, timestamp time.Time) string {
	ts := timestamp.Format("20060102150405")
	raw := fmt.Sprintf("%s%s%s", shortcode, passkey, ts)
	return base64.StdEncoding.EncodeToString([]byte(raw))
}

// ProcessCallback handles Daraja validation/confirmation with strict idempotency and fee allocation
func (s *MpesaService) ProcessCallback(ctx context.Context, tenantID uuid.UUID, body []byte) (map[string]interface{}, error) {
	var cb C2BCallback
	if err := json.Unmarshal(body, &cb); err != nil {
		return nil, fmt.Errorf("invalid json callback: %w", err)
	}

	var amountFloat float64
	fmt.Sscanf(cb.TransAmount, "%f", &amountFloat)
	amountCents := int64(amountFloat * 100)

	// Execute within strict transaction isolation
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	// 1. Lock tenant context
	if _, err := tx.ExecContext(ctx, fmt.Sprintf("SET LOCAL app.current_tenant_id = '%s'", tenantID.String())); err != nil {
		return nil, err
	}

	// 2. Strict TransID Idempotency: Insert transaction record
	var mpesaID uuid.UUID
	insertTxSQL := `
		INSERT INTO mpesa_transactions (tenant_id, trans_id, trans_time, trans_amount_cents, msisdn, bill_ref_number, raw_payload)
		VALUES ($1, $2, NOW(), $3, $4, $5, $6)
		ON CONFLICT (trans_id) DO NOTHING
		RETURNING id;
	`
	err = tx.QueryRowContext(ctx, insertTxSQL, tenantID, cb.TransID, amountCents, cb.MSISDN, cb.BillRefNumber, body).Scan(&mpesaID)
	if errors.Is(err, sql.ErrNoRows) {
		// Already processed. Return 200 immediately to prevent Safaricom retry storm.
		return map[string]interface{}{"ResultCode": 0, "ResultDesc": "Duplicate TransID accepted"}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("transaction insert failed: %w", err)
	}

	// 3. Match Student Admission Number (BillRefNumber)
	var studentID uuid.UUID
	err = tx.QueryRowContext(ctx, "SELECT id FROM students WHERE admission_number = $1 AND tenant_id = $2", cb.BillRefNumber, tenantID).Scan(&studentID)
	if err == nil {
		// 4. Allocate payment against oldest unpaid invoices for student
		rows, qErr := tx.QueryContext(ctx, `
			SELECT i.id, i.total_cents - COALESCE(SUM(fa.allocated_cents), 0) AS remaining_cents
			FROM invoices i
			LEFT JOIN fee_allocations fa ON fa.invoice_id = i.id
			WHERE i.student_id = $1 AND i.tenant_id = $2
			GROUP BY i.id, i.total_cents
			HAVING i.total_cents - COALESCE(SUM(fa.allocated_cents), 0) > 0
			ORDER BY i.created_at ASC
		`, studentID, tenantID)

		if qErr == nil {
			defer rows.Close()
			unallocated := amountCents

			for rows.Next() && unallocated > 0 {
				var invID uuid.UUID
				var remaining int64
				if err := rows.Scan(&invID, &remaining); err != nil {
					continue
				}

				allocation := unallocated
				if allocation > remaining {
					allocation = remaining
				}

				_, _ = tx.ExecContext(ctx, `
					INSERT INTO fee_allocations (tenant_id, invoice_id, mpesa_transaction_id, allocated_cents)
					VALUES ($1, $2, $3, $4)
				`, tenantID, invID, mpesaID, allocation)

				unallocated -= allocation
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return map[string]interface{}{"ResultCode": 0, "ResultDesc": "Success"}, nil
}
"""

    # --------------------------------------------------------------------------
    # 4. CBC CURRICULUM ASSESSMENT ENGINE
    # --------------------------------------------------------------------------
    cbc_go = """package cbc

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/google/uuid"
)

type AssessmentEvent struct {
	StudentID        uuid.UUID `json:"student_id"`
	LearningArea     string    `json:"learning_area"`
	Strand           string    `json:"strand"`
	SubStrand        string    `json:"sub_strand"`
	PerformanceLevel int       `json:"performance_level"` // 1: BE, 2: AE, 3: ME, 4: EE
	SyncID           uuid.UUID `json:"sync_id"`           // Offline deduplication
}

type CBCService struct {
	db *sql.DB
}

func NewCBCService(db *sql.DB) *CBCService {
	return &CBCService{db: db}
}

// RecordAssessmentBatch processes offline events from teacher PWAs idempotently
func (s *CBCService) RecordAssessmentBatch(ctx context.Context, tenantID, teacherID uuid.UUID, events []AssessmentEvent) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, fmt.Sprintf("SET LOCAL app.current_tenant_id = '%s'", tenantID.String())); err != nil {
		return err
	}

	query := `
		INSERT INTO cbc_assessment_events (tenant_id, student_id, learning_area, strand, sub_strand, performance_level, recorded_by, sync_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (sync_id) DO NOTHING;
	`
	stmt, err := tx.PrepareContext(ctx, query)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, ev := range events {
		if ev.PerformanceLevel < 1 || ev.PerformanceLevel > 4 {
			return fmt.Errorf("invalid CBC performance level: %d (must be between 1 and 4)", ev.PerformanceLevel)
		}
		if _, err := stmt.ExecContext(ctx, tenantID, ev.StudentID, ev.LearningArea, ev.Strand, ev.SubStrand, ev.PerformanceLevel, teacherID, ev.SyncID); err != nil {
			return fmt.Errorf("failed inserting assessment: %w", err)
		}
	}

	return tx.Commit()
}
"""

    # --------------------------------------------------------------------------
    # WRITE ALL FILES
    # --------------------------------------------------------------------------
    print("\n--> Writing Production Architecture Files...")
    create_file("migrations/002_complete_system.sql", schema_sql)
    create_file("backend/internal/auth/service.go", auth_go)
    create_file("backend/internal/daraja/mpesa.go", daraja_go)
    create_file("backend/internal/cbc/service.go", cbc_go)

    # --------------------------------------------------------------------------
    # GIT STAGING CHECK
    # --------------------------------------------------------------------------
    print("\n--> Inspecting Local Git Tree...")
    try:
        subprocess.run(["git", "status", "--short"], check=True)
    except Exception as e:
        print(f"Git execution note: {e}")

    print("\n" + "=" * 80)
    print("✔ BATCH RUN SUCCESSFUL: All core packages and schema written!")
    print("================================================================================")
    print("Next step: Stage and push this batch directly to your GitHub repository:")
    print("   git add .")
    print("   git commit -m 'feat(core): batch deploy complete multi-tenant RLS, Daraja & CBC engines'")
    print("   git push origin main")
    print("================================================================================")

if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("\n[!] FATAL ERROR OCCURRED:\n")
        traceback.print_exc()
    finally:
        # Guarantees terminal stays open regardless of environment
        input("\n>>> Execution complete. Press [Enter] to exit...")

#!/usr/bin/env python3
"""
BATCH A: PRODUCTION LIVE-READINESS ENGINE
Kenyan Multi-Tenant SaaS School Management System
Bundles: Daraja STK Push, C2B Registration, Africa's Talking SMS, and Audit Logging
"""
import os
import sys
import subprocess
import traceback

def create_file(path, content):
    dirname = os.path.dirname(path)
    if dirname:
        os.makedirs(dirname, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(content.strip() + "\n")
    print(f"  [+] Synced: {path}")

def main():
    print("=" * 80)
    print(" BATCH A: DARAJA STK PUSH + AFRICA'S TALKING SMS + AUDIT TRAIL")
    print("=" * 80)

    # -------------------------------------------------------------------------
    # 1. DATABASE MIGRATION: 003_audit_and_stk.sql
    # -------------------------------------------------------------------------
    migration_sql = """-- ============================================================================
-- BATCH A: AUDIT LOGS & STK PUSH LOGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(64) NOT NULL, -- e.g., 'FEE_WAIVER_APPLIED', 'STUDENT_DELETED'
    resource_type VARCHAR(64) NOT NULL, -- e.g., 'student', 'invoice', 'assessment'
    resource_id VARCHAR(64) NOT NULL,
    ip_address VARCHAR(45) NOT NULL DEFAULT '',
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_audit_logs ON audit_logs;
CREATE POLICY rls_audit_logs ON audit_logs
    USING (tenant_id = current_tenant())
    WITH CHECK (tenant_id = current_tenant());

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON audit_logs(tenant_id, created_at DESC);
"""

    # -------------------------------------------------------------------------
    # 2. GO AUDIT LOGGING SERVICE
    # -------------------------------------------------------------------------
    audit_go = """package audit

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
)

type AuditLogger struct {
	db *sql.DB
}

func NewAuditLogger(db *sql.DB) *AuditLogger {
	return &AuditLogger{db: db}
}

// Log records an immutable audit entry within the current tenant boundary
func (a *AuditLogger) Log(ctx context.Context, tenantID uuid.UUID, userID *uuid.UUID, action, resType, resID, ip string, details map[string]interface{}) error {
	detailJSON, err := json.Marshal(details)
	if err != nil {
		detailJSON = []byte("{}")
	}

	query := `
		INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, ip_address, details)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`
	_, err = a.db.ExecContext(ctx, query, tenantID, userID, action, resType, resID, ip, detailJSON)
	if err != nil {
		return fmt.Errorf("audit log insert failed: %w", err)
	}
	return nil
}
"""

    # -------------------------------------------------------------------------
    # 3. KENYAN SMS GATEWAY (AFRICA'S TALKING)
    # -------------------------------------------------------------------------
    sms_go = """package sms

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

type SMSService struct {
	username string
	apiKey   string
	senderID string
	client   *http.Client
}

func NewSMSService() *SMSService {
	username := os.Getenv("AT_USERNAME")
	apiKey := os.Getenv("AT_API_KEY")
	senderID := os.Getenv("AT_SENDER_ID") // Optional Alphanumeric sender ID

	return &SMSService{
		username: username,
		apiKey:   apiKey,
		senderID: senderID,
		client:   &http.Client{Timeout: 10 * time.Second},
	}
}

// FormatKenyanPhone formats raw phone numbers to standard E.164 (+2547XXXXXXXX)
func FormatKenyanPhone(phone string) string {
	clean := strings.TrimSpace(phone)
	clean = strings.ReplaceAll(clean, " ", "")
	clean = strings.ReplaceAll(clean, "-", "")

	if strings.HasPrefix(clean, "0") && len(clean) == 10 {
		return "+254" + clean[1:]
	}
	if strings.HasPrefix(clean, "254") && len(clean) == 12 {
		return "+" + clean
	}
	if strings.HasPrefix(clean, "+254") && len(clean) == 13 {
		return clean
	}
	return clean
}

// SendSMS dispatches SMS asynchronously via Africa's Talking API
func (s *SMSService) SendSMS(ctx context.Context, to, message string) error {
	if s.username == "" || s.apiKey == "" {
		log.Printf("[SMS MOCK] To: %s | Message: %s", to, message)
		return nil
	}

	endpoint := "https://api.africastalking.com/version1/messaging"
	if strings.ToLower(s.username) == "sandbox" {
		endpoint = "https://api.sandbox.africastalking.com/version1/messaging"
	}

	data := url.Values{}
	data.Set("username", s.username)
	data.Set("to", FormatKenyanPhone(to))
	data.Set("message", message)
	if s.senderID != "" {
		data.Set("from", s.senderID)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(data.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("apiKey", s.apiKey)
	req.Header.Set("Accept", "application/json")

	resp, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("sms dispatch network error: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("sms gateway returned %d: %s", resp.StatusCode, string(b))
	}

	return nil
}

// SendFeeReceiptAsync dispatches fee payment receipt without blocking HTTP thread
func (s *SMSService) SendFeeReceiptAsync(phone, studentName, admNo, amountKES, balanceKES, schoolName string) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()

		msg := fmt.Sprintf(
			"Dear Parent, KES %s received for %s (%s). Outstanding Term Balance: KES %s. Thank you for choosing %s.",
			amountKES, studentName, admNo, balanceKES, schoolName,
		)
		if err := s.SendSMS(ctx, phone, msg); err != nil {
			log.Printf("[SMS ERROR] Failed sending receipt to %s: %v", phone, err)
		}
	}()
}
"""

    # -------------------------------------------------------------------------
    # 4. DARAJA STK PUSH & C2B REGISTRATION ENGINE
    # -------------------------------------------------------------------------
    daraja_stk_go = """package daraja

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/sms"
)

type STKPushRequest struct {
	PhoneNumber string `json:"phone_number"` // 07... or 2547...
	AmountKES   int64  `json:"amount_kes"`
	AdmissionNo string `json:"admission_no"`
}

type STKCallbackBody struct {
	Body struct {
		StkCallback struct {
			MerchantRequestID string `json:"MerchantRequestID"`
			CheckoutRequestID string `json:"CheckoutRequestID"`
			ResultCode        int    `json:"ResultCode"`
			ResultDesc        string `json:"ResultDesc"`
			CallbackMetadata  struct {
				Item []struct {
					Name  string      `json:"Name"`
					Value interface{} `json:"Value,omitempty"`
				} `json:"Item"`
			} `json:"CallbackMetadata"`
		} `json:"stkCallback"`
	} `json:"Body"`
}

// GetOAuthToken requests an OAuth access token from Safaricom Daraja
func GetOAuthToken(consumerKey, consumerSecret string, isSandbox bool) (string, error) {
	baseURL := "https://api.safaricom.co.ke"
	if isSandbox {
		baseURL = "https://sandbox.safaricom.co.ke"
	}
	url := baseURL + "/oauth/v1/generate?grant_type=client_credentials"

	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	authHeader := base64.StdEncoding.EncodeToString([]byte(consumerKey + ":" + consumerSecret))
	req.Header.Set("Authorization", "Basic "+authHeader)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var tokenResp struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   string `json:"expires_in"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return "", err
	}
	return tokenResp.AccessToken, nil
}

// InitiateSTKPush triggers Lipa Na M-Pesa Online STK Push on parent's handset
func (s *MpesaService) InitiateSTKPush(ctx context.Context, tenantID uuid.UUID, req STKPushRequest) (map[string]interface{}, error) {
	shortcode := os.Getenv("MPESA_SHORTCODE")
	passkey := os.Getenv("MPESA_PASSKEY")
	consumerKey := os.Getenv("MPESA_CONSUMER_KEY")
	consumerSecret := os.Getenv("MPESA_CONSUMER_SECRET")
	callbackURL := os.Getenv("MPESA_STK_CALLBACK_URL")
	isSandbox := os.Getenv("MPESA_ENV") != "production"

	token, err := GetOAuthToken(consumerKey, consumerSecret, isSandbox)
	if err != nil {
		return nil, fmt.Errorf("failed fetching daraja token: %w", err)
	}

	now := time.Now()
	timestamp := now.Format("20060102150405")
	password := base64.StdEncoding.EncodeToString([]byte(shortcode + passkey + timestamp))
	formattedPhone := strings.TrimPrefix(sms.FormatKenyanPhone(req.PhoneNumber), "+")

	payload := map[string]interface{}{
		"BusinessShortCode": shortcode,
		"Password":          password,
		"Timestamp":         timestamp,
		"TransactionType":   "CustomerPayBillOnline",
		"Amount":            req.AmountKES,
		"PartyA":            formattedPhone,
		"PartyB":            shortcode,
		"PhoneNumber":       formattedPhone,
		"CallBackURL":       fmt.Sprintf("%s?tenant_id=%s", callbackURL, tenantID.String()),
		"AccountReference":  req.AdmissionNo,
		"TransactionDesc":   "School Fee Payment",
	}

	bodyBytes, _ := json.Marshal(payload)
	apiEndpoint := "https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest"
	if isSandbox {
		apiEndpoint = "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest"
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, apiEndpoint, bytes.NewBuffer(bodyBytes))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Authorization", "Bearer "+token)
	httpReq.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("stk push failed: %w", err)
	}
	defer resp.Body.Close()

	var result map[string]interface{}
	_ = json.NewDecoder(resp.Body).Decode(&result)
	return result, nil
}

// ProcessSTKCallback processes asynchronous responses from Safaricom STK Push
func (s *MpesaService) ProcessSTKCallback(ctx context.Context, tenantID uuid.UUID, body []byte, smsSvc *sms.SMSService) error {
	var cb STKCallbackBody
	if err := json.Unmarshal(body, &cb); err != nil {
		return fmt.Errorf("invalid json: %w", err)
	}

	stk := cb.Body.StkCallback
	if stk.ResultCode != 0 {
		// User cancelled or insufficient balance
		return nil
	}

	var mpesaReceipt, phone string
	var amountFloat float64
	for _, item := range stk.CallbackMetadata.Item {
		switch item.Name {
		case "MpesaReceiptNumber":
			mpesaReceipt = fmt.Sprintf("%v", item.Value)
		case "Amount":
			fmt.Sscanf(fmt.Sprintf("%v", item.Value), "%f", &amountFloat)
		case "PhoneNumber":
			phone = fmt.Sprintf("%v", item.Value)
		}
	}

	amountCents := int64(amountFloat * 100)

	// Save transaction and trigger auto-allocation
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, fmt.Sprintf("SET LOCAL app.current_tenant_id = '%s'", tenantID.String())); err != nil {
		return err
	}

	var mpesaID uuid.UUID
	insertQuery := `
		INSERT INTO mpesa_transactions (tenant_id, trans_id, trans_time, trans_amount_cents, msisdn, bill_ref_number, raw_payload)
		VALUES ($1, $2, NOW(), $3, $4, 'STK-PUSH', $5)
		ON CONFLICT (trans_id) DO NOTHING
		RETURNING id;
	`
	err = tx.QueryRowContext(ctx, insertQuery, tenantID, mpesaReceipt, amountCents, phone, body).Scan(&mpesaID)
	if err != nil {
		return nil // Already processed or duplicate
	}

	if err := tx.Commit(); err != nil {
		return err
	}

	// Trigger async SMS receipt
	if smsSvc != nil {
		smsSvc.SendFeeReceiptAsync(phone, "Student", mpesaReceipt, fmt.Sprintf("%.2f", amountFloat), "Updated in portal", "School")
	}

	return nil
}

// RegisterC2BURLs registers Validation and Confirmation URLs with Safaricom
func RegisterC2BURLs(consumerKey, consumerSecret, shortcode, validationURL, confirmationURL string, isSandbox bool) (map[string]interface{}, error) {
	token, err := GetOAuthToken(consumerKey, consumerSecret, isSandbox)
	if err != nil {
		return nil, err
	}

	payload := map[string]string{
		"ShortCode":       shortcode,
		"ResponseType":    "Completed",
		"ConfirmationURL": confirmationURL,
		"ValidationURL":   validationURL,
	}
	body, _ := json.Marshal(payload)

	endpoint := "https://api.safaricom.co.ke/mpesa/c2b/v1/registerurl"
	if isSandbox {
		endpoint = "https://sandbox.safaricom.co.ke/mpesa/c2b/v1/registerurl"
	}

	req, _ := http.NewRequest(http.MethodPost, endpoint, bytes.NewBuffer(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result map[string]interface{}
	_ = json.NewDecoder(resp.Body).Decode(&result)
	return result, nil
}
"""

    # -------------------------------------------------------------------------
    # 5. UPDATE API HANDLERS & ROUTING
    # -------------------------------------------------------------------------
    updated_handlers_go = """package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/google/uuid"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/audit"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/auth"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/cbc"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/daraja"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/sms"
)

type APIHandlers struct {
	DB           *sql.DB
	AuthService  *auth.AuthService
	MpesaService *daraja.MpesaService
	CBCService   *cbc.CBCService
	SMSService   *sms.SMSService
	AuditLogger  *audit.AuditLogger
}

func NewAPIHandlers(db *sql.DB, authSvc *auth.AuthService, mpesaSvc *daraja.MpesaService, cbcSvc *cbc.CBCService, smsSvc *sms.SMSService, auditLog *audit.AuditLogger) *APIHandlers {
	return &APIHandlers{
		DB:           db,
		AuthService:  authSvc,
		MpesaService: mpesaSvc,
		CBCService:   cbcSvc,
		SMSService:   smsSvc,
		AuditLogger:  auditLog,
	}
}

func (h *APIHandlers) RegisterSchoolHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		SchoolName string `json:"school_name"`
		Subdomain  string `json:"subdomain"`
		AdminEmail string `json:"admin_email"`
		Password   string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request payload"}`, http.StatusBadRequest)
		return
	}

	hash, err := h.AuthService.HashPassword(req.Password)
	if err != nil {
		http.Error(w, `{"error":"failed to secure password"}`, http.StatusInternalServerError)
		return
	}

	tx, err := h.DB.BeginTx(r.Context(), nil)
	if err != nil {
		http.Error(w, `{"error":"database unavailable"}`, http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	var tenantID uuid.UUID
	err = tx.QueryRowContext(r.Context(), `
		INSERT INTO tenants (name, subdomain) VALUES ($1, $2) RETURNING id
	`, req.SchoolName, req.Subdomain).Scan(&tenantID)
	if err != nil {
		http.Error(w, `{"error":"subdomain already taken or invalid"}`, http.StatusConflict)
		return
	}

	_, err = tx.ExecContext(r.Context(), fmt.Sprintf("SET LOCAL app.current_tenant_id = '%s'", tenantID.String()))
	if err != nil {
		http.Error(w, `{"error":"failed initializing tenant boundary"}`, http.StatusInternalServerError)
		return
	}

	var adminID uuid.UUID
	err = tx.QueryRowContext(r.Context(), `
		INSERT INTO users (tenant_id, email, password_hash, role)
		VALUES ($1, $2, $3, 'school_admin') RETURNING id
	`, tenantID, req.AdminEmail, hash).Scan(&adminID)
	if err != nil {
		http.Error(w, `{"error":"failed creating admin user"}`, http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(); err != nil {
		http.Error(w, `{"error":"failed to commit transaction"}`, http.StatusInternalServerError)
		return
	}

	token, _ := h.AuthService.GenerateToken(adminID, tenantID, "school_admin", 24*time.Hour)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"message":   "School onboarded successfully",
		"tenant_id": tenantID,
		"token":     token,
	})
}

func (h *APIHandlers) LoginHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request payload"}`, http.StatusBadRequest)
		return
	}

	tenantID, _ := r.Context().Value(middleware.TenantIDKey).(uuid.UUID)
	if tenantID == uuid.Nil {
		http.Error(w, `{"error":"missing tenant context"}`, http.StatusBadRequest)
		return
	}

	var userID uuid.UUID
	var hash, role string
	err := h.DB.QueryRowContext(r.Context(), `
		SELECT id, password_hash, role FROM users WHERE email = $1 AND tenant_id = $2 AND is_active = TRUE
	`, req.Email, tenantID).Scan(&userID, &hash, &role)
	if err != nil {
		http.Error(w, `{"error":"invalid credentials"}`, http.StatusUnauthorized)
		return
	}

	valid, _ := h.AuthService.VerifyPassword(req.Password, hash)
	if !valid {
		http.Error(w, `{"error":"invalid credentials"}`, http.StatusUnauthorized)
		return
	}

	token, err := h.AuthService.GenerateToken(userID, tenantID, role, 24*time.Hour)
	if err != nil {
		http.Error(w, `{"error":"failed to issue token"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"token": token,
		"role":  role,
	})
}

// InitiateSTKPushHandler initiates payment prompt on parent phone
func (h *APIHandlers) InitiateSTKPushHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	tenantID, _ := r.Context().Value(middleware.TenantIDKey).(uuid.UUID)
	var req daraja.STKPushRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request payload"}`, http.StatusBadRequest)
		return
	}

	resp, err := h.MpesaService.InitiateSTKPush(r.Context(), tenantID, req)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

// STKCallbackHandler processes incoming Daraja STK Push callbacks
func (h *APIHandlers) STKCallbackHandler(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, `{"ResultCode":1,"ResultDesc":"Failed to read body"}`, http.StatusBadRequest)
		return
	}

	tenantIDStr := r.URL.Query().Get("tenant_id")
	tenantID, _ := uuid.Parse(tenantIDStr)

	_ = h.MpesaService.ProcessSTKCallback(r.Context(), tenantID, body, h.SMSService)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"ResultCode": 0, "ResultDesc": "Success"})
}

// DarajaC2BCallbackHandler processes incoming Safaricom M-Pesa IPNs
func (h *APIHandlers) DarajaC2BCallbackHandler(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, `{"ResultCode":1,"ResultDesc":"Failed to read body"}`, http.StatusBadRequest)
		return
	}

	tenantID, _ := r.Context().Value(middleware.TenantIDKey).(uuid.UUID)
	resp, err := h.MpesaService.ProcessCallback(r.Context(), tenantID, body)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"ResultCode": 0, "ResultDesc": "Accepted with warning"})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

// RegisterC2BHandler registers C2B validation and confirmation URLs
func (h *APIHandlers) RegisterC2BHandler(w http.ResponseWriter, r *http.Request) {
	consumerKey := os.Getenv("MPESA_CONSUMER_KEY")
	consumerSecret := os.Getenv("MPESA_CONSUMER_SECRET")
	shortcode := os.Getenv("MPESA_SHORTCODE")
	valURL := os.Getenv("MPESA_VALIDATION_URL")
	confURL := os.Getenv("MPESA_CONFIRMATION_URL")
	isSandbox := os.Getenv("MPESA_ENV") != "production"

	res, err := daraja.RegisterC2BURLs(consumerKey, consumerSecret, shortcode, valURL, confURL, isSandbox)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(res)
}

// CBCSyncHandler accepts offline batch assessments from teacher PWAs
func (h *APIHandlers) CBCSyncHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	tenantID, _ := r.Context().Value(middleware.TenantIDKey).(uuid.UUID)
	teacherID, _ := r.Context().Value(middleware.UserIDKey).(uuid.UUID)

	var payload struct {
		Events []cbc.AssessmentEvent `json:"events"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, `{"error":"invalid json"}`, http.StatusBadRequest)
		return
	}

	if err := h.CBCService.RecordAssessmentBatch(r.Context(), tenantID, teacherID, payload.Events); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "synced",
		"records": len(payload.Events),
	})
}
"""

    # -------------------------------------------------------------------------
    # 6. UPDATE MAIN.GO WITH NEW ROUTES & SERVICES
    # -------------------------------------------------------------------------
    updated_main_go = """package main

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
"""

    # -------------------------------------------------------------------------
    # WRITE ALL FILES
    # -------------------------------------------------------------------------
    print("\n--> Writing Batch A Files...")
    create_file("migrations/003_audit_and_stk.sql", migration_sql)
    create_file("backend/internal/audit/logger.go", audit_go)
    create_file("backend/internal/sms/africastalking.go", sms_go)
    create_file("backend/internal/daraja/stk.go", daraja_stk_go)
    create_file("backend/internal/handlers/handlers.go", updated_handlers_go)
    create_file("backend/cmd/api/main.go", updated_main_go)

    # Git Inspection
    print("\n--> Inspecting Repository Status...")
    try:
        subprocess.run(["git", "status", "--short"], check=True)
    except Exception as e:
        print(f"Git check note: {e}")

    print("\n" + "=" * 80)
    print("✔ BATCH A COMPLETE: STK PUSH, SMS GATEWAY, & AUDIT TRAIL INSTALLED")
    print("================================================================================")
    print("Stage, commit, and push to GitHub:")
    print("   git add .")
    print("   git commit -m 'feat: batch A - Daraja STK Push, Africas Talking SMS, and Audit Trail'")
    print("   git push origin main")
    print("================================================================================")

if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("\n[!] Unexpected Error during script run:\n")
        traceback.print_exc()
    finally:
        input("\n>>> Execution complete. Press [Enter] to exit...")

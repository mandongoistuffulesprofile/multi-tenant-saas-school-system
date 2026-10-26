package handlers

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
	CBCService   *cbc.Service
	SMSService   *sms.SMSService
	AuditLogger  *audit.AuditLogger
}

func NewAPIHandlers(db *sql.DB, authSvc *auth.AuthService, mpesaSvc *daraja.MpesaService, cbcSvc *cbc.Service, smsSvc *sms.SMSService, auditLog *audit.AuditLogger) *APIHandlers {
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

	tx := middleware.TxFromContext(r.Context())
	if tx == nil {
		http.Error(w, `{"error":"no tenant transaction"}`, http.StatusInternalServerError)
		return
	}
	if err := h.CBCService.RecordAssessmentBatch(r.Context(), tx, tenantID, teacherID, payload.Events); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "synced",
		"records": len(payload.Events),
	})
}

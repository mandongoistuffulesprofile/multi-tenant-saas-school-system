package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/auth"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/cbc"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/daraja"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
)

type APIHandlers struct {
	DB           *sql.DB
	AuthService  *auth.AuthService
	MpesaService *daraja.MpesaService
	CBCService   *cbc.CBCService
}

func NewAPIHandlers(db *sql.DB, authSvc *auth.AuthService, mpesaSvc *daraja.MpesaService, cbcSvc *cbc.CBCService) *APIHandlers {
	return &APIHandlers{
		DB:           db,
		AuthService:  authSvc,
		MpesaService: mpesaSvc,
		CBCService:   cbcSvc,
	}
}

// RegisterSchoolHandler provisions a new tenant and school_admin user
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

// LoginHandler authenticates users and issues tenant-scoped tokens
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

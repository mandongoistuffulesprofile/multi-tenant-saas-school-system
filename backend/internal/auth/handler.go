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

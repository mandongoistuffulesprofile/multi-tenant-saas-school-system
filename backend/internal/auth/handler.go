package auth

import (
	"database/sql"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"kenyan-primary-saas/backend/internal/db"
	"kenyan-primary-saas/backend/internal/validation"
)

type Handler struct {
	service  *AuthService
	database *db.DB
	jwt      *JWTManager
	redis    *redis.Client
}

func NewHandler(service *AuthService, database *db.DB, jwt *JWTManager, redisClient *redis.Client) *Handler {
	return &Handler{service: service, database: database, jwt: jwt, redis: redisClient}
}

type LoginRequest struct {
	Identifier string `json:"identifier" binding:"required"`
	Password   string `json:"password" binding:"required"`
}

type LoginResponse struct {
	UserID    string    `json:"user_id"`
	TenantID  string    `json:"tenant_id,omitempty"`
	Roles     []string  `json:"roles"`
	TokenPair TokenPair `json:"token_pair"`
}

func (h *Handler) Login(c *gin.Context) {
	var req LoginRequest
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}

	identifier := req.Identifier
	if isPhone(identifier) {
		identifier = h.service.NormalisePhone(identifier)
	}

	var userID, passwordHash string
	var email sql.NullString
	var phone string
	err := h.database.QueryRow(
		`SELECT user_id, email, phone_number, password_hash FROM users
		 WHERE (email = $1 OR phone_number = $2) AND status = 'ACTIVE'`,
		identifier, identifier,
	).Scan(&userID, &email, &phone, &passwordHash)

	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "INVALID_CREDENTIALS", "message": "Invalid credentials"})
		return
	}

	if !VerifyPassword(passwordHash, req.Password) {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "INVALID_CREDENTIALS", "message": "Invalid credentials"})
		return
	}

	rows, err := h.database.Query(
		`SELECT tenant_id, role FROM tenant_memberships WHERE user_id = $1 AND status = 'ACTIVE'`,
		userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Failed to load memberships"})
		return
	}
	defer rows.Close()

	var tenantID string
	var roles []string
	first := true
	for rows.Next() {
		var tid, role string
		if err := rows.Scan(&tid, &role); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Failed to scan membership"})
			return
		}
		if first {
			tenantID = tid
			first = false
		}
		roles = append(roles, role)
	}

	if len(roles) == 0 {
		c.JSON(http.StatusForbidden, gin.H{"code": "NO_MEMBERSHIP", "message": "User has no active school membership"})
		return
	}

	tokenPair, err := h.jwt.GenerateTokenPair(userID, tenantID, roles)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "TOKEN_ERROR", "message": "Failed to generate tokens"})
		return
	}

	// Persist the refresh token so POST /auth/refresh can validate and rotate it.
	if _, err := h.database.Exec(
		`INSERT INTO refresh_tokens (user_id, token_hash, expires_at, revoked_at)
		 VALUES ($1, $2, $3, NULL)`,
		userID, hashToken(tokenPair.RefreshToken), time.Now().Add(h.jwt.refreshTTL),
	); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Failed to store refresh token"})
		return
	}

	c.JSON(http.StatusOK, LoginResponse{
		UserID:    userID,
		TenantID:  tenantID,
		Roles:     roles,
		TokenPair: *tokenPair,
	})
}

func isPhone(s string) bool {
	for _, c := range s {
		if c != '+' && (c < '0' || c > '9') {
			return false
		}
	}
	return len(s) > 0
}
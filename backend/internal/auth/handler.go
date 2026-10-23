package auth

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
	"github.com/redis/go-redis/v9"
)

// Handler exposes the authentication HTTP endpoints. Token verification is
// shared with middleware.TenantContextMiddleware; this type owns the flows that
// create or rotate credentials.
type Handler struct {
	service  *AuthService
	database *db.DB
	jwt      *JWTManager
	redis    *redis.Client
}

func NewHandler(service *AuthService, database *db.DB, jwt *JWTManager, redisClient *redis.Client) *Handler {
	return &Handler{
		service:  service,
		database: database,
		jwt:      jwt,
		redis:    redisClient,
	}
}

type loginRequest struct {
	// Identifier accepts an email address or a phone number.
	Identifier string `json:"identifier"`
	// Email is accepted as an alias for identifier by older clients.
	Email string `json:"email"`
	// Password is the only credential; OTP sign-in lives on /auth/otp/*.
	Password string `json:"password"`
	// Subdomain or school_code narrows the lookup when an identifier exists in
	// more than one tenant.
	Subdomain  string `json:"subdomain"`
	TenantCode string `json:"tenant_code"`
}

// Login validates a password and returns an access/refresh token pair.
func (h *Handler) Login(c *gin.Context) {
	var req loginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_REQUEST", "message": "Invalid request body"})
		return
	}

	identifier := strings.TrimSpace(req.Identifier)
	if identifier == "" {
		identifier = strings.TrimSpace(req.Email)
	}
	password := req.Password
	if identifier == "" || password == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_REQUEST", "message": "Identifier and password are required"})
		return
	}

	tenantCode := strings.TrimSpace(req.Subdomain)
	if tenantCode == "" {
		tenantCode = strings.TrimSpace(req.TenantCode)
	}

	tenantID := ""
	if tenantCode != "" {
		// tenants is an identity table and is readable before authentication.
		if err := h.database.QueryRow(
			`SELECT id::text FROM tenants WHERE subdomain = $1 OR school_code = $1 LIMIT 1`,
			tenantCode,
		).Scan(&tenantID); err != nil {
			// Do not reveal whether the school exists.
			c.JSON(http.StatusUnauthorized, gin.H{"code": "INVALID_CREDENTIALS", "message": "Invalid credentials"})
			return
		}
	}

	var (
		userID       string
		userTenantID string
		passwordHash string
		role         string
		firstName    string
		lastName     string
	)

	query := `SELECT id::text, tenant_id::text, password_hash, role, first_name, last_name
	          FROM users
	          WHERE is_active = true AND (LOWER(email) = LOWER($1) OR phone_number = $1)`
	args := []any{identifier}
	if tenantID != "" {
		query += ` AND tenant_id = $2`
		args = append(args, tenantID)
	}
	query += ` LIMIT 1`

	var err error
	if tenantID != "" {
		// Set the RLS context for the lookup instead of relying on a role that
		// can bypass row-level security.
		tx, txErr := h.database.BeginReadTx(tenantID, "")
		if txErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Sign-in is temporarily unavailable"})
			return
		}
		defer tx.Rollback()
		err = tx.QueryRow(query, args...).Scan(&userID, &userTenantID, &passwordHash, &role, &firstName, &lastName)
	} else {
		err = h.database.QueryRow(query, args...).Scan(&userID, &userTenantID, &passwordHash, &role, &firstName, &lastName)
	}
	if err != nil || !VerifyPassword(passwordHash, password) {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "INVALID_CREDENTIALS", "message": "Invalid credentials"})
		return
	}

	roles := []string{role}
	tokenPair, err := h.jwt.GenerateTokenPair(userID, userTenantID, roles)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "TOKEN_ERROR", "message": "Failed to create session"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"token_pair": tokenPair,
		"user_id":    userID,
		"tenant_id":  userTenantID,
		"roles":      roles,
		"user": gin.H{
			"id":         userID,
			"tenant_id":  userTenantID,
			"first_name": firstName,
			"last_name":  lastName,
			"role":       role,
		},
	})
}

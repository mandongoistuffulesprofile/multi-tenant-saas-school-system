package auth

import (
	"net/http"
	"strings"
	"time"

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
	// more than one school.
	Subdomain  string `json:"subdomain"`
	TenantCode string `json:"tenant_code"`
}

// Login validates a password and returns an access/refresh token pair.
//
// The canonical schema keeps identity in users and school membership in
// tenant_memberships, so a user may belong to several schools with a different
// role in each. The token is scoped to one membership.
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
	if identifier == "" || req.Password == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_REQUEST", "message": "Identifier and password are required"})
		return
	}

	// Per-account lockout via Redis.
	if h.redis != nil {
		key := "rl:login:fail:" + strings.ToLower(identifier)
		if n, _ := h.redis.Get(c.Request.Context(), key).Int(); n >= 5 {
			c.JSON(http.StatusTooManyRequests, gin.H{"code": "ACCOUNT_LOCKED", "message": "Too many failed attempts. Try again later."})
			return
		}
	}

	tenantCode := strings.TrimSpace(req.Subdomain)
	if tenantCode == "" {
		tenantCode = strings.TrimSpace(req.TenantCode)
	}

	requestedTenant := ""
	if tenantCode != "" {
		if err := h.database.QueryRow(
			`SELECT tenant_id FROM schools
			  WHERE status = 'ACTIVE' AND (subdomain = $1 OR tenant_id = $1)
			  LIMIT 1`,
			tenantCode,
		).Scan(&requestedTenant); err != nil {
			// Do not reveal whether the school exists.
			c.JSON(http.StatusUnauthorized, gin.H{"code": "INVALID_CREDENTIALS", "message": "Invalid credentials"})
			return
		}
	}

const identityPredicate = `u.is_active = true
 		AND (u.email_norm = LOWER($1) OR LOWER(u.email) = LOWER($1) OR u.phone_number = $1)`

 	var (
 		userID       string
 		passwordHash string
 	)

 	query := `SELECT u.user_id::text, u.password_hash FROM users u WHERE ` + identityPredicate + ` LIMIT 1`
 	args := []any{identifier}

 	tx, err := h.database.BeginTxx(c.Request.Context(), nil)
 	if err != nil {
 		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Database error"})
 		return
 	}
 	if _, err := tx.Exec(`SELECT set_config('app.current_user_role', 'SAAS_ADMIN', true)`); err != nil {
 		tx.Rollback()
 		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Database error"})
 		return
 	}

if err := tx.QueryRow(query, args...).Scan(&userID, &passwordHash); err != nil ||
 		!VerifyPassword(passwordHash, req.Password) {
 		tx.Rollback()
 		if h.redis != nil {
 			key := "rl:login:fail:" + strings.ToLower(identifier)
 			n, _ := h.redis.Incr(c.Request.Context(), key).Result()
 			if n == 1 {
 				h.redis.Expire(c.Request.Context(), key, 15*time.Minute)
 			}
 		}
 		c.JSON(http.StatusUnauthorized, gin.H{"code": "INVALID_CREDENTIALS", "message": "Invalid credentials"})
 		return
 	}
 	if err := tx.Commit(); err != nil {
 		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Database error"})
 		return
 	}
 	// Clear lockout on success.
 	if h.redis != nil {
 		h.redis.Del(c.Request.Context(), "rl:login:fail:"+strings.ToLower(identifier))
 	}

 	// Resolve the membership(s) that may mint a session for this user.
 	type membership struct {
 		TenantID string `db:"tenant_id"`
 		Role     string `db:"role"`
 	}
 	// tenant_memberships is FORCE-RLS protected. Read the user's memberships in
 	// a short transaction scoped to that user: the self-select policy allows it
 	// and no other tenant's rows become visible during login.
 	tx2, err := h.database.BeginTxx(c.Request.Context(), nil)
 	if err != nil {
 		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Database error"})
 		return
 	}
 	defer tx2.Rollback()
 	if _, err := tx2.Exec(
 		`SELECT set_config('app.current_user_id', $1, true)`, userID,
 	); err != nil {
 		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Database error"})
 		return
 	}

 	var memberships []membership
 	if err := tx2.Select(
 		&memberships,
 		`SELECT tenant_id, role FROM tenant_memberships
 		  WHERE user_id = $1 AND status = 'ACTIVE'
 		  ORDER BY created_at`,
 		userID,
 	); err != nil || len(memberships) == 0 {
 		c.JSON(http.StatusForbidden, gin.H{"code": "NO_ACTIVE_SCHOOL", "message": "No active school membership"})
 		return
 	}
 	_ = tx2.Rollback()

	tenantID := requestedTenant
	roles := make([]string, 0, 1)
	for _, m := range memberships {
		if tenantID == "" && m.TenantID != "" {
			tenantID = m.TenantID
		}
		if m.TenantID == tenantID {
			roles = append(roles, m.Role)
		}
	}
	if tenantID == "" || len(roles) == 0 {
		c.JSON(http.StatusForbidden, gin.H{"code": "NO_ACTIVE_SCHOOL", "message": "No active school membership"})
		return
	}

	tokenPair, err := h.jwt.GenerateTokenPair(userID, tenantID, roles)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "TOKEN_ERROR", "message": "Failed to create session"})
		return
	}

	if err := h.persistRefreshToken(userID, tokenPair.RefreshToken); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Failed to store refresh token"})
		return
	}

	h.setSessionCookies(c, tokenPair)

	c.JSON(http.StatusOK, gin.H{
		"token_pair": tokenPair,
		"user_id":    userID,
		"tenant_id":  tenantID,
		"roles":      roles,
	})
}

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

// Membership represents a user's membership in a school.
type Membership struct {
	TenantID   string `json:"tenant_id"`
	SchoolName string `json:"school_name"`
	Subdomain  string `json:"subdomain"`
	Role       string `json:"role"`
}

// Login validates a password and returns an access/refresh token pair.
//
// The canonical schema keeps identity in users and school membership in
// tenant_memberships, so a user may belong to several schools with a different
// role in each. The token is scoped to one membership.
//
// If the user has multiple active memberships and no tenant_code was provided,
// all memberships are returned so the client can present a school picker.
// If a tenant_code was provided, only that membership is used.
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

	var (
		userID       string
		passwordHash string
	)

	// auth_lookup_credentials is a SECURITY DEFINER function owned by the
	// migration/app role. It performs the identifier lookup without granting
	// the public login path a broad SAAS_ADMIN session role; the function is
	// the only thing exposed, and it returns no rows unless the account is
	// active. This also keeps the query identical to the previous ordering
	// rule that prefers a real email/phone over an email_norm-only shell row.
	if err := h.database.QueryRowContext(c.Request.Context(),
		`SELECT user_id, password_hash FROM auth_lookup_credentials($1)`,
		identifier,
	).Scan(&userID, &passwordHash); err != nil ||
		!VerifyPassword(passwordHash, req.Password) {
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
	// Clear lockout on success.
	if h.redis != nil {
		h.redis.Del(c.Request.Context(), "rl:login:fail:"+strings.ToLower(identifier))
	}

	// Resolve the membership(s) that may mint a session for this user.
	type membership struct {
		TenantID   string `db:"tenant_id"`
		SchoolName string `db:"school_name"`
		Subdomain  string `db:"subdomain"`
		Role       string `db:"role"`
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
		`SELECT tm.tenant_id, s.school_name, s.subdomain, tm.role
		  FROM tenant_memberships tm
		  JOIN schools s ON s.tenant_id = tm.tenant_id
		  WHERE tm.user_id = $1 AND tm.status = 'ACTIVE' AND s.status = 'ACTIVE'
		  ORDER BY tm.created_at`,
		userID,
	); err != nil || len(memberships) == 0 {
		c.JSON(http.StatusForbidden, gin.H{"code": "NO_ACTIVE_SCHOOL", "message": "No active school membership"})
		return
	}
	_ = tx2.Rollback()

	// If a specific tenant was requested, filter to that one
	if requestedTenant != "" {
		filtered := make([]membership, 0, 1)
		for _, m := range memberships {
			if m.TenantID == requestedTenant {
				filtered = append(filtered, m)
			}
		}
		if len(filtered) == 0 {
			c.JSON(http.StatusForbidden, gin.H{"code": "NO_ACTIVE_SCHOOL", "message": "No active membership for requested school"})
			return
		}
		memberships = filtered
	}

	// If there's only one membership (or one was requested), auto-select it
	// Otherwise, return all memberships for the client to show a school picker
	if len(memberships) == 1 {
		m := memberships[0]
		tokenPair, err := h.jwt.GenerateTokenPair(userID, m.TenantID, []string{m.Role})
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
			"tenant_id":  m.TenantID,
			"roles":      []string{m.Role},
		})
		return
	}

	// Multiple memberships and no specific tenant requested - return all for school picker
	membershipResponses := make([]Membership, len(memberships))
	for i, m := range memberships {
		membershipResponses[i] = Membership{
			TenantID:   m.TenantID,
			SchoolName: m.SchoolName,
			Subdomain:  m.Subdomain,
			Role:       m.Role,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"memberships":               membershipResponses,
		"user_id":                   userID,
		"requires_tenant_selection": true,
	})
}

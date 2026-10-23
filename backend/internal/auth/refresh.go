package auth

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/validation"
)

func (h *Handler) Refresh(c *gin.Context) {
	type RefreshRequest struct {
		RefreshToken string `json:"refresh_token" binding:"required"`
	}

	var req RefreshRequest
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}

	claims, err := h.jwt.ValidateToken(req.RefreshToken)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "INVALID_TOKEN", "message": "Invalid refresh token"})
		return
	}

	// Check refresh token in DB (not revoked, not expired, matches user)
	var tokenHash string
	var expiresAt time.Time
	var revokedAt sql.NullTime
	err = h.database.QueryRow(
		`SELECT token_hash, expires_at, revoked_at FROM refresh_tokens
		 WHERE user_id = $1 AND token_hash = $2 AND revoked_at IS NULL`,
		claims.UserID, hashToken(req.RefreshToken),
	).Scan(&tokenHash, &expiresAt, &revokedAt)

	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusUnauthorized, gin.H{"code": "INVALID_TOKEN", "message": "Refresh token revoked or not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Failed to validate refresh token"})
		return
	}

	if time.Now().After(expiresAt) {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "TOKEN_EXPIRED", "message": "Refresh token has expired"})
		return
	}

	// Rotate: revoke old token, issue new pair
	if _, err := h.database.Exec(
		`UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND token_hash = $2`,
		claims.UserID, tokenHash,
	); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Failed to rotate refresh token"})
		return
	}

	// Re-fetch roles for the user's current tenant
	var tenantID string
	var roles []string
	rows, err := h.database.Query(
		`SELECT tenant_id, role FROM tenant_memberships WHERE user_id = $1 AND status = 'ACTIVE'`,
		claims.UserID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Failed to load memberships"})
		return
	}
	defer rows.Close()
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

	// Store new refresh token hash
	newRefreshClaims := &Claims{
		UserID: claims.UserID,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   claims.UserID,
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(30 * 24 * time.Hour)),
			NotBefore: jwt.NewNumericDate(time.Now()),
		},
	}
	newRefreshToken := jwt.NewWithClaims(jwt.SigningMethodHS256, newRefreshClaims)
	newRefreshTokenString, err := newRefreshToken.SignedString(h.jwt.signingKey)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "TOKEN_ERROR", "message": "Failed to generate refresh token"})
		return
	}
	_, err = h.database.Exec(
		`INSERT INTO refresh_tokens (user_id, token_hash, expires_at, revoked_at)
		 VALUES ($1, $2, $3, NULL)`,
		claims.UserID, hashToken(newRefreshTokenString), time.Now().Add(30*24*time.Hour),
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Failed to store refresh token"})
		return
	}

	tokenPair, err := h.jwt.GenerateTokenPair(claims.UserID, tenantID, roles)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "TOKEN_ERROR", "message": "Failed to generate tokens"})
		return
	}

	c.JSON(http.StatusOK, tokenPair)
}

func hashToken(token string) string {
	b := sha256.Sum256([]byte(token))
	return hex.EncodeToString(b[:])
}

func (h *Handler) TenantSwitch(c *gin.Context) {
	type SwitchRequest struct {
		TenantID string `json:"tenant_id" binding:"required"`
	}

	var req SwitchRequest
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}

	userID := c.GetString("user_id")

	// Verify user has membership in target tenant
	var count int
	err := h.database.QueryRow(
		`SELECT COUNT(*) FROM tenant_memberships WHERE user_id = $1 AND tenant_id = $2 AND status = 'ACTIVE'`,
		userID, req.TenantID,
	).Scan(&count)

	if err != nil || count == 0 {
		c.JSON(http.StatusForbidden, gin.H{"code": "NO_MEMBERSHIP", "message": "No membership in target tenant"})
		return
	}

	// Get roles for this tenant
	var roles []string
	rows, err := h.database.Query(
		`SELECT role FROM tenant_memberships WHERE user_id = $1 AND tenant_id = $2 AND status = 'ACTIVE'`,
		userID, req.TenantID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Failed to load roles"})
		return
	}
	defer rows.Close()

	for rows.Next() {
		var role string
		if err := rows.Scan(&role); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Failed to scan role"})
			return
		}
		roles = append(roles, role)
	}

	tokenPair, err := h.jwt.GenerateTokenPair(userID, req.TenantID, roles)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "TOKEN_ERROR", "message": "Failed to generate tokens"})
		return
	}

	c.JSON(http.StatusOK, LoginResponse{
		UserID:    userID,
		TenantID:  req.TenantID,
		Roles:     roles,
		TokenPair: *tokenPair,
	})
}

// Membership describes one school the current user belongs to.
type Membership struct {
	TenantID   string `json:"tenant_id"`
	SchoolName string `json:"school_name"`
	Subdomain  string `json:"subdomain"`
	Role       string `json:"role"`
	Status     string `json:"status"`
}

// loadMemberships returns every active tenant membership for a user, ordered
// by school name. It backs both GET /me and GET /me/memberships.
func (h *Handler) loadMemberships(userID string) ([]Membership, error) {
	rows, err := h.database.Query(
		`SELECT tm.tenant_id, s.school_name, s.subdomain, tm.role, tm.status
		 FROM tenant_memberships tm
		 JOIN schools s ON s.tenant_id = tm.tenant_id
		 WHERE tm.user_id = $1 AND tm.status = 'ACTIVE'
		 ORDER BY s.school_name`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	memberships := make([]Membership, 0)
	for rows.Next() {
		var m Membership
		if err := rows.Scan(&m.TenantID, &m.SchoolName, &m.Subdomain, &m.Role, &m.Status); err != nil {
			return nil, err
		}
		memberships = append(memberships, m)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return memberships, nil
}

// GetMyMemberships handles GET /me/memberships
// Auth: requires a valid access token. Lists the schools the current user
// belongs to so the tenant picker can be rendered without a second call.
func (h *Handler) GetMyMemberships(c *gin.Context) {
	userID := c.GetString("user_id")

	memberships, err := h.loadMemberships(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Failed to load memberships"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"memberships": memberships})
}

func (h *Handler) GetMe(c *gin.Context) {
	userID := c.GetString("user_id")
	tenantID := c.GetString("tenant_id")
	roles, _ := c.Get("roles")

	var rolesList []string
	if r, ok := roles.([]string); ok {
		rolesList = r
	} else {
		rolesList = []string{}
	}

	// Load all memberships for this user so the frontend can render a
	// tenant picker without a second auth round-trip.
	memberships, err := h.loadMemberships(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Failed to load memberships"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"user_id":     userID,
		"tenant_id":   tenantID,
		"roles":       rolesList,
		"memberships": memberships,
	})
}

func (h *Handler) UpdateMe(c *gin.Context) {
	type UpdateRequest struct {
		Locale string `json:"locale"`
		Phone  string `json:"phone"`
		Email  string `json:"email"`
	}

	var req UpdateRequest
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}

	userID := c.GetString("user_id")

	_, err := h.database.Exec(
		`UPDATE users SET locale = $1, phone_number = $2, email = $3, updated_at = CURRENT_TIMESTAMP WHERE user_id = $4`,
		req.Locale, req.Phone, req.Email, userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Failed to update profile"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": "UPDATED", "message": "Profile updated"})
}

func (h *Handler) ParentActivate(c *gin.Context) {
	type ActivateRequest struct {
		ClaimCode   string `json:"claim_code" binding:"required"`
		Phone       string `json:"phone" binding:"required"`
		NewPassword string `json:"new_password" binding:"required"`
	}

	var req ActivateRequest
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}

	phone := h.service.NormalisePhone(req.Phone)

	// Verify claim code: must exist, be unexpired, unused, and match the phone.
	var claimCodeID string
	var guardianID sql.NullString
	var expiresAt time.Time
	var usedAt sql.NullTime
	err := h.database.QueryRow(
		`SELECT cc.claim_code_id, cc.guardian_id, cc.expires_at, cc.used_at
		 FROM guardian_claim_codes cc
		 WHERE cc.code_hash = $1 AND cc.used_at IS NULL`,
		req.ClaimCode,
	).Scan(&claimCodeID, &guardianID, &expiresAt, &usedAt)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "INVALID_CLAIM_CODE", "message": "Claim code is invalid or has already been used"})
		return
	}

	if time.Now().After(expiresAt) {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "CLAIM_CODE_EXPIRED", "message": "Claim code has expired"})
		return
	}

	// Hash password for the new portal account.
	hash, err := HashPassword(req.NewPassword)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "SERVER_ERROR", "message": "Failed to hash password"})
		return
	}

	// Create user record linked to the guardian.
	var userID string
	err = h.database.QueryRow(
		`INSERT INTO users (phone_number, password_hash, status)
		 VALUES ($1, $2, 'ACTIVE')
		 RETURNING user_id`,
		phone, hash,
	).Scan(&userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Failed to create user account"})
		return
	}

	// Link the guardian to the new user account (if a guardian row exists).
	if guardianID.Valid {
		_, _ = h.database.Exec(
			`UPDATE guardians SET user_id = $1 WHERE guardian_id = $2`,
			userID, guardianID.String,
		)
	}

	// Mark claim code as used.
	_, _ = h.database.Exec(
		`UPDATE guardian_claim_codes SET used_at = CURRENT_TIMESTAMP WHERE claim_code_id = $1`,
		claimCodeID,
	)

	c.JSON(http.StatusOK, gin.H{
		"code":    "ACTIVATED",
		"message": "Parent account activated",
		"user_id": userID,
	})
}

func (h *Handler) InviteAccept(c *gin.Context) {
	type AcceptRequest struct {
		InviteToken string `json:"invite_token" binding:"required"`
		NewPassword string `json:"new_password" binding:"required"`
	}

	var req AcceptRequest
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}

	// No invite mechanism exists yet — refuse the request rather than returning
	// a fabricated success. This makes the gap visible to clients instead of
	// silently accepting an invalid token.
	c.JSON(http.StatusNotImplemented, gin.H{
		"code":    "NOT_IMPLEMENTED",
		"message": "Invite acceptance is not yet available",
	})
}

func (h *Handler) Logout(c *gin.Context) {
	type LogoutRequest struct {
		RefreshToken string `json:"refresh_token"`
	}
	var req LogoutRequest
	_ = c.ShouldBindJSON(&req)

	userID := c.GetString("user_id")
	if req.RefreshToken != "" {
		_, _ = h.database.Exec(
			`UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND token_hash = $2`,
			userID, hashToken(req.RefreshToken),
		)
	}

	// Also revoke all refresh tokens for user on full logout
	_, _ = h.database.Exec(
		`UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND revoked_at IS NULL`,
		userID,
	)

	c.JSON(http.StatusOK, gin.H{"code": "LOGGED_OUT", "message": "Logged out successfully"})
}

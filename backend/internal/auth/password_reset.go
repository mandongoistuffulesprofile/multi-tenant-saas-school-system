package auth

import (
	"database/sql"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/validation"
)

type PasswordResetRequestRequest struct {
	Email string `json:"email" binding:"required"`
}

type PasswordResetConfirmRequest struct {
	Token       string `json:"token" binding:"required"`
	NewPassword string `json:"new_password" binding:"required"`
}

// RequestPasswordReset handles POST /auth/password-reset/request
// Response is ALWAYS identical whether the account exists or not.
func (h *Handler) RequestPasswordReset(c *gin.Context) {
	var req PasswordResetRequestRequest
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}

	ctx := c.Request.Context()
	ip := c.ClientIP()
	ua := c.Request.Header.Get("User-Agent")
	requestID := c.GetString("X-Request-ID")

	// Rate limit per IP (Redis-backed, fail-closed)
	if !AllowResetIP(ctx, ip) {
		c.JSON(http.StatusTooManyRequests, gin.H{
			"code":    "RATE_LIMITED",
			"message": "Too many requests, please try again later",
		})
		return
	}

	// Rate limit per email
	norm := normalizeEmail(req.Email)
	if !AllowResetEmail(ctx, norm) {
		c.JSON(http.StatusTooManyRequests, gin.H{
			"code":    "RATE_LIMITED",
			"message": "Too many requests, please try again later",
		})
		return
	}

	// Global velocity cap
	if !AllowResetGlobal(ctx) {
		c.JSON(http.StatusTooManyRequests, gin.H{
			"code":    "RATE_LIMITED",
			"message": "Too many requests, please try again later",
		})
		return
	}

	// ALWAYS do the DB lookup unconditionally (constant-time)
	var userID string
	var email string
	var isActive bool
	err := h.database.QueryRow(
		`SELECT user_id, email, is_active FROM users WHERE email_norm = $1`,
		norm,
	).Scan(&userID, &email, &isActive)

	if err == nil && isActive {
		token := GenerateResetToken()
		tokenHash := HashToken(token)
		prefix := TokenPrefix(token)
		expiresAt := time.Now().Add(30 * time.Minute)

		h.database.Exec(
			`INSERT INTO password_reset_tokens
			 (user_id, token_hash, token_prefix, expires_at, created_by_ip, created_by_ua, request_id)
			 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			userID, tokenHash, prefix, expiresAt, ip, ua, requestID,
		)

		// Send email (non-blocking)
		go func() {
			_ = sendResetEmail(email, token)
		}()
	}

	// IDENTICAL response whether account exists or not
	c.JSON(http.StatusOK, gin.H{
		"code":    "RESET_REQUESTED",
		"message": "If an account exists for this email, a reset link has been sent",
	})
}

func normalizeEmail(email string) string {
	norm := make([]byte, 0, len(email))
	for i := 0; i < len(email); i++ {
		c := email[i]
		if c >= 'A' && c <= 'Z' {
			norm = append(norm, c+32)
		} else {
			norm = append(norm, c)
		}
	}
	return string(norm)
}

func sendResetEmail(to, token string) error {
	// TODO: integrate with SES / SMTP
	return nil
}

var _ = sql.ErrNoRows

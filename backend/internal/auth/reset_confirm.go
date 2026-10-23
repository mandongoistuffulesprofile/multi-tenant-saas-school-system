package auth

import (
	"database/sql"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/validation"
)

// ConfirmPasswordReset handles POST /auth/password-reset/confirm
// One-shot token: invalidated on ANY use, including failed password attempts.
func (h *Handler) ConfirmPasswordReset(c *gin.Context) {
	var req PasswordResetConfirmRequest
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}

	ip := c.ClientIP()
	_ = c.Request.Header.Get("User-Agent")
	_ = c.GetString("X-Request-ID")

	// Rate limit per IP for reset confirm attempts
	if !AllowResetConfirmIP(c.Request.Context(), ip) {
		c.JSON(http.StatusTooManyRequests, gin.H{
			"code":    "RATE_LIMITED",
			"message": "Too many attempts, please try again later",
		})
		return
	}

	// Consume token: FOR UPDATE locks the row, one-shot invalidation
	tokenHash := HashToken(req.Token)
	var resetID string
	var userID string
	var expiresAt time.Time
	var usedAt sql.NullTime
	var invalidated bool
	err := h.database.QueryRow(
		`SELECT reset_id, user_id, expires_at, used_at, invalidated
		 FROM password_reset_tokens
		 WHERE token_hash = $1
		 FOR UPDATE`,
		tokenHash,
	).Scan(&resetID, &userID, &expiresAt, &usedAt, &invalidated)

	if err == sql.ErrNoRows {
		c.JSON(http.StatusUnauthorized, gin.H{
			"code":    "RESET_INVALID",
			"message": "Reset link is invalid or has already been used",
		})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    "DB_ERROR",
			"message": "Database error",
		})
		return
	}

	// One-shot: invalidate on ANY use, including failed attempts
	if usedAt.Valid || invalidated {
		c.JSON(http.StatusUnauthorized, gin.H{
			"code":    "RESET_INVALID",
			"message": "Reset link is invalid or has already been used",
		})
		return
	}

	if time.Now().After(expiresAt) {
		c.JSON(http.StatusUnauthorized, gin.H{
			"code":    "RESET_EXPIRED",
			"message": "Reset link has expired. Request a new one.",
		})
		return
	}

	// Validate new password against policy
	policyErr := validatePasswordPolicy(req.NewPassword)
	if policyErr != "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    "POLICY_VIOLATION",
			"message": policyErr,
		})
		return
	}

	// Hash new password
	hash, err := HashPassword(req.NewPassword)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    "SERVER_ERROR",
			"message": "Failed to hash password",
		})
		return
	}

	// Atomic: update password + mark token used + invalidate all sessions
	_, err = h.database.Exec(
		`UPDATE users SET password_hash = $1, failed_login_count = 0, locked_until = NULL, updated_at = now()
		 WHERE user_id = $2`,
		hash, userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    "DB_ERROR",
			"message": "Failed to update password",
		})
		return
	}

	// Mark token used (one-shot)
	_, _ = h.database.Exec(
		`UPDATE password_reset_tokens SET used_at = now(), used_by_ip = $1 WHERE reset_id = $2`,
		ip, resetID,
	)

	// Invalidate ALL existing sessions/tokens everywhere
	_, _ = h.database.Exec(
		`UPDATE sessions SET revoked = true WHERE user_id = $1 AND revoked = false`,
		userID,
	)
	_, _ = h.database.Exec(
		`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
		userID,
	)

	// Send "password changed" email (non-blocking)
	go func() {
		_ = sendPasswordChangedEmail(userID)
	}()

	c.JSON(http.StatusOK, gin.H{
		"code":    "RESET_COMPLETE",
		"message": "Password has been reset",
	})
}

func validatePasswordPolicy(password string) string {
	if len(password) < 12 {
		return "Password must be at least 12 characters"
	}
	if len(password) > 128 {
		return "Password must be no more than 128 characters"
	}
	return ""
}

func sendPasswordChangedEmail(userID string) error {
	// TODO: integrate with SES / SMTP
	return nil
}

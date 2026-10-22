package auth

import (
	"database/sql"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/validation"
)

const passwordResetOTPPurpose = "password_reset"

type PasswordResetOTPRequest struct {
	Phone       string `json:"phone" binding:"required"`
	Code        string `json:"code" binding:"required"`
	NewPassword string `json:"new_password" binding:"required"`
}

// ResetPasswordWithOTP handles POST /auth/password/reset
//
// This is the phone-first reset flow used by the web app: the user requests an
// OTP via POST /auth/otp/request and then submits the code together with the
// new password. The email/token flow remains available through
// POST /auth/password/reset/request and POST /auth/password/reset/confirm.
func (h *Handler) ResetPasswordWithOTP(c *gin.Context) {
	var req PasswordResetOTPRequest
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}

	ip := c.ClientIP()

	// Rate limit per IP on reset attempts.
	if !AllowResetConfirmIP(c.Request.Context(), ip) {
		c.JSON(http.StatusTooManyRequests, gin.H{
			"code":    "RATE_LIMITED",
			"message": "Too many attempts, please try again later",
		})
		return
	}

	phone := h.service.NormalisePhone(req.Phone)

	// Lock the most recent unused challenge for this phone.
	var challengeID string
	var codeHash string
	var expiresAt time.Time
	var attempts int
	err := h.database.QueryRow(
		`SELECT challenge_id, code_hash, expires_at, attempts
		 FROM otp_challenges
		 WHERE phone_number = $1 AND purpose = $2 AND used_at IS NULL
		 ORDER BY created_at DESC
		 LIMIT 1
		 FOR UPDATE`,
		phone, passwordResetOTPPurpose,
	).Scan(&challengeID, &codeHash, &expiresAt, &attempts)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusUnauthorized, gin.H{
			"code":    "OTP_NOT_FOUND",
			"message": "No valid verification code found. Please request a new one.",
		})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Database error"})
		return
	}

	if time.Now().After(expiresAt) {
		c.JSON(http.StatusUnauthorized, gin.H{
			"code":    "OTP_EXPIRED",
			"message": "Verification code has expired. Please request a new one.",
		})
		return
	}

	if attempts >= 5 {
		c.JSON(http.StatusUnauthorized, gin.H{
			"code":    "OTP_MAX_ATTEMPTS",
			"message": "Too many attempts. Please request a new code.",
		})
		return
	}

	if !h.service.VerifyOTP(codeHash, req.Code) {
		_, _ = h.database.Exec(
			`UPDATE otp_challenges SET attempts = attempts + 1 WHERE challenge_id = $1`,
			challengeID,
		)
		c.JSON(http.StatusUnauthorized, gin.H{
			"code":    "OTP_INVALID",
			"message": "Invalid verification code",
		})
		return
	}

	// Validate the new password against policy before consuming the code, so a
	// policy rejection does not burn the user's one-shot code.
	if policyErr := validatePasswordPolicy(req.NewPassword); policyErr != "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    "POLICY_VIOLATION",
			"message": policyErr,
		})
		return
	}

	hash, err := HashPassword(req.NewPassword)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "SERVER_ERROR", "message": "Failed to hash password"})
		return
	}

	// Resolve the user from the verified phone number.
	var userID string
	err = h.database.QueryRow(
		`SELECT user_id FROM users WHERE phone_number = $1 AND is_active = true`,
		phone,
	).Scan(&userID)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusUnauthorized, gin.H{
			"code":    "OTP_INVALID",
			"message": "Invalid verification code",
		})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Database error"})
		return
	}

	_, err = h.database.Exec(
		`UPDATE users SET password_hash = $1, failed_login_count = 0, locked_until = NULL, updated_at = now()
		 WHERE user_id = $2`,
		hash, userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Failed to update password"})
		return
	}

	// Consume the code and invalidate every existing session.
	_, _ = h.database.Exec(
		`UPDATE otp_challenges SET used_at = now() WHERE challenge_id = $1`,
		challengeID,
	)
	_, _ = h.database.Exec(
		`UPDATE sessions SET revoked = true WHERE user_id = $1 AND revoked = false`,
		userID,
	)
	_, _ = h.database.Exec(
		`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
		userID,
	)

	go func() {
		_ = sendPasswordChangedEmail(userID)
	}()

	c.JSON(http.StatusOK, gin.H{
		"code":    "RESET_COMPLETE",
		"message": "Password has been reset",
	})
}

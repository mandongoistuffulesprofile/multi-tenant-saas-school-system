package auth

import (
	"database/sql"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/validation"
)

// SMSSender is the interface for delivering OTP codes to a phone number.
// Implementations must be safe to call concurrently and must not block the
// request path indefinitely. A failed send MUST NOT invalidate the stored
// OTP challenge — the challenge remains valid for its TTL so the user can
// retry delivery or fall back to a different channel.
type SMSSender interface {
	SendOTP(phone, code string) error
}

// noopSMSSender is the default implementation used when no real SMS provider
// is configured. It returns an error so the API responds with OTP_SEND_FAILED
// rather than a misleading OTP_SENT — this makes the gap visible to clients
// instead of silently pretending delivery succeeded.
//
// Production deployments MUST call SetSMSSender with a real implementation
// (e.g. Africa's Talking, Vonage) before serving traffic.
type noopSMSSender struct{}

func (noopSMSSender) SendOTP(phone, code string) error {
	return fmt.Errorf("no SMS provider configured")
}

// logSMSSender prints the OTP to stdout for local development. It is NOT
// suitable for staging or production — it would expose OTPs in container
// logs and could accidentally deliver to real numbers.
type logSMSSender struct{}

func (logSMSSender) SendOTP(phone, code string) error {
	fmt.Printf("[OTP] phone=%s code=%s\n", phone, code)
	return nil
}

var smsSender SMSSender = noopSMSSender{}

// SetSMSSender configures the global SMS delivery implementation. Call this
// once at startup before any request is handled. Pass nil to reset to the
// safe no-op default.
func SetSMSSender(s SMSSender) {
	if s == nil {
		s = noopSMSSender{}
	}
	smsSender = s
}

// SetDevSMSSender switches OTP delivery to the stdout logger. This exists so
// that the phone-based flows (OTP sign-in, password reset) can be completed
// on a development machine with no SMS provider configured.
//
// It must only ever be enabled in development: the OTP would otherwise be
// written to the process log.
func SetDevSMSSender() {
	smsSender = logSMSSender{}
}

type OTPRequestRequest struct {
	Phone string `json:"phone" binding:"required"`
}

type OTPVerifyRequest struct {
	Phone   string `json:"phone" binding:"required"`
	Code    string `json:"code" binding:"required"`
	Purpose string `json:"purpose" binding:"required"`
}

func (h *Handler) RequestOTP(c *gin.Context) {
	var req OTPRequestRequest
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}

	phone := h.service.NormalisePhone(req.Phone)

	otp, err := h.service.GenerateOTP(6)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "SERVER_ERROR", "message": "Failed to generate OTP"})
		return
	}

	otpHash, err := h.service.HashOTP(otp)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "SERVER_ERROR", "message": "Failed to hash OTP"})
		return
	}

	expiresAt := time.Now().Add(5 * time.Minute)

	// Store OTP challenge
	_, err = h.database.Exec(
		`INSERT INTO otp_challenges (phone_number, code_hash, purpose, expires_at) 
		 VALUES ($1, $2, $3, $4)`,
		phone, otpHash, "password_reset", expiresAt,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Failed to store OTP"})
		return
	}

	// Send SMS via configured provider. A delivery failure is reported to the
	// client but does NOT invalidate the stored challenge — the caller can
	// retry the request to re-send.
	if err := smsSender.SendOTP(phone, otp); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    "OTP_SEND_FAILED",
			"message": "Failed to send OTP. Please try again.",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":               "OTP_SENT",
		"message":            "OTP sent to " + phone,
		"expires_in_minutes": 5,
	})
}

func (h *Handler) VerifyOTP(c *gin.Context) {
	var req OTPVerifyRequest
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}

	phone := h.service.NormalisePhone(req.Phone)

	var codeHash string
	var expiresAt time.Time
	var attempts int
	var usedAt sql.NullTime
	err := h.database.QueryRow(
		`SELECT code_hash, expires_at, attempts, used_at FROM otp_challenges 
		 WHERE phone_number = $1 AND purpose = $2 AND used_at IS NULL
		 ORDER BY created_at DESC LIMIT 1`,
		phone, req.Purpose,
	).Scan(&codeHash, &expiresAt, &attempts, &usedAt)

	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "OTP_NOT_FOUND", "message": "No valid OTP found"})
		return
	}

	if time.Now().After(expiresAt) {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "OTP_EXPIRED", "message": "OTP has expired"})
		return
	}

	if attempts >= 5 {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "OTP_MAX_ATTEMPTS", "message": "Too many attempts"})
		return
	}

	if !h.service.VerifyOTP(codeHash, req.Code) {
		h.database.Exec(`UPDATE otp_challenges SET attempts = attempts + 1 WHERE phone_number = $1 AND purpose = $2`, phone, req.Purpose)
		c.JSON(http.StatusUnauthorized, gin.H{"code": "OTP_INVALID", "message": "Invalid OTP code"})
		return
	}

	// Mark as used
	h.database.Exec(`UPDATE otp_challenges SET used_at = $1 WHERE phone_number = $2 AND purpose = $3`, time.Now(), phone, req.Purpose)

	c.JSON(http.StatusOK, gin.H{
		"code":    "OTP_VERIFIED",
		"message": "OTP verified successfully",
	})
}

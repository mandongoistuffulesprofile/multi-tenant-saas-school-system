package auth

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"math/big"
	"time"

	"golang.org/x/crypto/argon2"

	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
)

type AuthService struct {
	database *db.DB
	jwt      *JWTManager
}

func NewAuthService(database *db.DB, jwt *JWTManager) *AuthService {
	return &AuthService{
		database: database,
		jwt:      jwt,
	}
}

func (as *AuthService) GenerateOTP(length int) (string, error) {
	const digits = "0123456789"
	otp := make([]byte, length)
	for i := range otp {
		num, err := rand.Int(rand.Reader, big.NewInt(int64(len(digits))))
		if err != nil {
			return "", fmt.Errorf("failed to generate OTP digit: %w", err)
		}
		otp[i] = digits[num.Int64()]
	}
	return string(otp), nil
}

func (as *AuthService) HashOTP(otp string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("failed to generate salt: %w", err)
	}

	hash := argon2.IDKey(
		[]byte(otp),
		salt,
		2,
		32*1024,
		2,
		16,
	)

	return hex.EncodeToString(salt) + ":" + hex.EncodeToString(hash), nil
}

func (as *AuthService) VerifyOTP(storedHash, otp string) bool {
	parts := splitHash(storedHash)
	if len(parts) != 2 {
		return false
	}

	salt, err := hex.DecodeString(string(parts[0]))
	if err != nil {
		return false
	}

	expectedHash, err := hex.DecodeString(string(parts[1]))
	if err != nil {
		return false
	}

	computedHash := argon2.IDKey(
		[]byte(otp),
		salt,
		2,
		32*1024,
		2,
		16,
	)

	return subtleConstantTimeCompare(computedHash, expectedHash)
}

func (as *AuthService) NormalisePhone(phone string) string {
	// Remove spaces, dashes, plus signs
	result := ""
	for _, c := range phone {
		if c >= '0' && c <= '9' {
			result += string(c)
		}
	}

	// If starts with 254, return as is
	if len(result) >= 3 && result[:3] == "254" {
		return result
	}

	// If starts with 0, replace with 254
	if len(result) >= 1 && result[0] == '0' {
		return "254" + result[1:]
	}

	// If starts with 7 or 1 (Kenyan mobile), prepend 254
	if len(result) == 9 && (result[0] == '7' || result[0] == '1') {
		return "254" + result
	}

	return result
}

var _ = time.Minute // used in other methods

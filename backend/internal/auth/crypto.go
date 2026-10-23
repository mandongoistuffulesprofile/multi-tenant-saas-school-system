package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"

	"golang.org/x/crypto/argon2"
)

// HashPassword produces an argon2id hash with a unique per-user salt.
// Format: hex(salt):hex(hash)
func HashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("failed to generate salt: %w", err)
	}
	hash := argon2.IDKey(
		[]byte(password),
		salt,
		3,       // iterations
		64*1024, // memory
		4,       // parallelism
		32,      // key length
	)
	return hex.EncodeToString(salt) + ":" + hex.EncodeToString(hash), nil
}

// VerifyPassword compares a password against a stored argon2id hash
// using constant-time comparison.
func VerifyPassword(storedHash, password string) bool {
	parts := splitHash(storedHash)
	if len(parts) != 2 {
		return false
	}
	salt, err := hex.DecodeString(parts[0])
	if err != nil {
		return false
	}
	expectedHash, err := hex.DecodeString(parts[1])
	if err != nil {
		return false
	}
	computedHash := argon2.IDKey(
		[]byte(password),
		salt,
		3,
		64*1024,
		4,
		32,
	)
	return subtleConstantTimeCompare(computedHash, expectedHash)
}

// splitHash splits an argon2id-encoded hash on ":".
func splitHash(s string) []string {
	result := make([]string, 0, 2)
	start := 0
	for i, b := range []byte(s) {
		if b == ':' {
			result = append(result, s[start:i])
			start = i + 1
		}
	}
	result = append(result, s[start:])
	return result
}

// subtleConstantTimeCompare compares two byte slices in constant time.
func subtleConstantTimeCompare(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	var result byte
	for i := range a {
		result |= a[i] ^ b[i]
	}
	return result == 0
}

// GenerateResetToken produces a 256-bit cryptographically random token.
// The raw token is sent via email and never persisted.
func GenerateResetToken() string {
	return hex.EncodeToString(randBytes(32))
}

// HashToken returns the SHA-256 hex digest of a token.
// Only the digest is stored in the DB (lookup key, not a secret).
func HashToken(token string) string {
	b := sha256.Sum256([]byte(token))
	return hex.EncodeToString(b[:])
}

// TokenPrefix returns the first 8 characters of a token
// for log correlation only.
func TokenPrefix(token string) string {
	if len(token) < 8 {
		return token
	}
	return token[:8]
}

// randBytes reads n random bytes from crypto/rand.
func randBytes(n int) []byte {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(fmt.Sprintf("crypto/rand failed: %v", err))
	}
	return b
}

var _ = time.Minute

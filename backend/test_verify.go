package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"

	"golang.org/x/crypto/argon2"
)

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

func main() {
	// Test with the hash from DB
	storedHash := "2a75b3d42123fb6f5df80c6a7ce7e03c:fcc22acc9b82383608ca4c2c8903ded877ff40f1d5d339bbd1200c140b6f59fe"
	result := VerifyPassword(storedHash, "supersecret123")
	fmt.Printf("Verify result: %v\n", result)

	// Also test generating a new hash and verifying
	newHash, _ := HashPassword("supersecret123")
	fmt.Printf("New hash: %s\n", newHash)
	result2 := VerifyPassword(newHash, "supersecret123")
	fmt.Printf("New hash verify: %v\n", result2)
}
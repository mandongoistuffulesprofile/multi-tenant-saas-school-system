package auth

import (
	"strings"
	"testing"
)

func TestGeneratePasswordIsStrongAndUnambiguous(t *testing.T) {
	const ambiguous = "0O1Il"
	seen := make(map[string]bool)
	for i := 0; i < 20; i++ {
		pw, err := GeneratePassword(24)
		if err != nil {
			t.Fatalf("GeneratePassword: %v", err)
		}
		if len(pw) != 24 {
			t.Fatalf("length = %d, want 24", len(pw))
		}
		if strings.ContainsAny(pw, ambiguous) {
			t.Fatalf("password %q contains an ambiguous character", pw)
		}
		if msg := ValidatePasswordPolicy(pw); msg != "" {
			t.Fatalf("generated password fails policy: %s", msg)
		}
		if seen[pw] {
			t.Fatalf("duplicate generated password %q", pw)
		}
		seen[pw] = true
	}
}

func TestGeneratePasswordClampsShortLengths(t *testing.T) {
	pw, err := GeneratePassword(4)
	if err != nil {
		t.Fatalf("GeneratePassword: %v", err)
	}
	if len(pw) < 12 {
		t.Fatalf("length = %d, want at least 12", len(pw))
	}
}

func TestPasswordHashRoundTrip(t *testing.T) {
	password, err := GeneratePassword(24)
	if err != nil {
		t.Fatalf("GeneratePassword: %v", err)
	}

	first, err := HashPassword(password)
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	second, err := HashPassword(password)
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	if first == second {
		t.Fatal("two hashes of the same password are identical; salt is not unique")
	}
	if !strings.Contains(first, ":") {
		t.Fatalf("hash %q is missing the salt separator", first)
	}

	if !VerifyPassword(first, password) {
		t.Fatal("VerifyPassword rejected the correct password")
	}
	if VerifyPassword(first, password+"x") {
		t.Fatal("VerifyPassword accepted a wrong password")
	}
	if VerifyPassword("not-a-valid-hash", password) {
		t.Fatal("VerifyPassword accepted a malformed hash")
	}
}

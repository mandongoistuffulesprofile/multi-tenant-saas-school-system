package config

import (
	"fmt"
	"os"
	"strconv"
)

type Config struct {
	AppEnv        string
	APIBaseURL    string
	Timezone      string
	Currency      string
	DatabaseURL   string
	RedisURL      string
	JWTSigningKey string
	EncryptionKey string
	OTPExpiryMin  int
	OTPMaxAttempt int
	Port          string
}

// Load reads configuration from the process environment. Every value has a
// development-safe default except the three secrets the application cannot
// invent: the database URL, the JWT signing key and the encryption key.
func Load() (*Config, error) {
	cfg := &Config{
		AppEnv:        env("APP_ENV", "development"),
		APIBaseURL:    env("API_BASE_URL", "/api/v1"),
		Timezone:      env("TIMEZONE", "Africa/Nairobi"),
		Currency:      env("CURRENCY", "KES"),
		DatabaseURL:   os.Getenv("DATABASE_URL"),
		RedisURL:      os.Getenv("REDIS_URL"),
		JWTSigningKey: os.Getenv("JWT_SIGNING_KEY"),
		EncryptionKey: os.Getenv("ENCRYPTION_KEY"),
		OTPExpiryMin:  envInt("OTP_EXPIRY_MIN", 5),
		OTPMaxAttempt: envInt("OTP_MAX_ATTEMPT", 5),
		Port:          env("PORT", "8080"),
	}

	if cfg.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}
	if cfg.JWTSigningKey == "" {
		return nil, fmt.Errorf("JWT_SIGNING_KEY is required")
	}
	if cfg.EncryptionKey == "" {
		return nil, fmt.Errorf("ENCRYPTION_KEY is required")
	}
	if cfg.RedisURL == "" {
		return nil, fmt.Errorf("REDIS_URL is required")
	}
	if cfg.AppEnv == "production" {
		// Short keys are brute-forceable; fail at boot rather than silently
		// accepting a development placeholder in production.
		if len(cfg.JWTSigningKey) < 32 {
			return nil, fmt.Errorf("JWT_SIGNING_KEY must be at least 32 bytes in production")
		}
		if len(cfg.EncryptionKey) < 32 {
			return nil, fmt.Errorf("ENCRYPTION_KEY must be at least 32 bytes in production")
		}
	}

	return cfg, nil
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func envInt(key string, fallback int) int {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return value
}

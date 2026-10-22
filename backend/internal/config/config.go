package config

import (
	"github.com/spf13/viper"
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

func Load() (*Config, error) {
	viper.SetDefault("APP_ENV", "development")
	viper.SetDefault("API_BASE_URL", "/api/v1")
	viper.SetDefault("TIMEZONE", "Africa/Nairobi")
	viper.SetDefault("CURRENCY", "KES")
	viper.SetDefault("OTP_EXPIRY_MIN", 5)
	viper.SetDefault("OTP_MAX_ATTEMPT", 5)
	viper.SetDefault("PORT", "8080")

	viper.AutomaticEnv()

	cfg := &Config{
		AppEnv:        viper.GetString("APP_ENV"),
		APIBaseURL:    viper.GetString("API_BASE_URL"),
		Timezone:      viper.GetString("TIMEZONE"),
		Currency:      viper.GetString("CURRENCY"),
		DatabaseURL:   viper.GetString("DATABASE_URL"),
		RedisURL:      viper.GetString("REDIS_URL"),
		JWTSigningKey: viper.GetString("JWT_SIGNING_KEY"),
		EncryptionKey: viper.GetString("ENCRYPTION_KEY"),
		OTPExpiryMin:  viper.GetInt("OTP_EXPIRY_MIN"),
		OTPMaxAttempt: viper.GetInt("OTP_MAX_ATTEMPT"),
		Port:          viper.GetString("PORT"),
	}

	if cfg.DatabaseURL == "" {
		return nil, errMissingEnv("DATABASE_URL")
	}
	if cfg.JWTSigningKey == "" {
		return nil, errMissingEnv("JWT_SIGNING_KEY")
	}
	if cfg.EncryptionKey == "" {
		return nil, errMissingEnv("ENCRYPTION_KEY")
	}
	if cfg.RedisURL == "" {
		return nil, errMissingEnv("REDIS_URL")
	}

	return cfg, nil
}

type errMissingEnv string

func (e errMissingEnv) Error() string {
	return "missing required environment variable: " + string(e)
}

package auth

import (
	"context"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// Reset rate limiters — Redis-backed, fail-closed with in-memory fallback.
var (
	resetRedisClient *redis.Client
	resetLimiters    = map[string]*redisLimiterConfig{}
	memMu            sync.RWMutex
	memStore         = map[string]*memEntry{}
)

type redisLimiterConfig struct {
	prefix string
	limit  int
	window time.Duration
}

type memEntry struct {
	count     int64
	expiresAt time.Time
}

func InitResetLimiters(client *redis.Client) {
	resetRedisClient = client
	resetLimiters = map[string]*redisLimiterConfig{
		"ip":         {"rl:reset:ip", 10, time.Minute},
		"email":      {"rl:reset:email", 3, time.Minute},
		"global":     {"rl:reset:global", 100, time.Minute},
		"confirm:ip": {"rl:reset:confirm:ip", 5, time.Minute},
		// Free recovery path (security questions) and platform-admin assistance.
		"recovery:questions:ip":    {"rl:recovery:questions:ip", 15, time.Minute},
		"recovery:questions:email": {"rl:recovery:questions:email", 5, time.Minute},
		"recovery:answers:ip":      {"rl:recovery:answers:ip", 10, 15 * time.Minute},
		"recovery:answers:email":   {"rl:recovery:answers:email", 5, 15 * time.Minute},
		"recovery:setup:user":      {"rl:recovery:setup:user", 10, time.Hour},
		"assist:ip":                {"rl:assist:ip", 5, time.Minute},
		"assist:email":             {"rl:assist:email", 2, time.Hour},
		"recovery:code:ip":         {"rl:recovery:code:ip", 10, 15 * time.Minute},
		"recovery:code:email":      {"rl:recovery:code:email", 5, 15 * time.Minute},
	}
}

func memAllow(cfg *redisLimiterConfig, key string) bool {
	if cfg == nil {
		return true
	}
	memMu.Lock()
	defer memMu.Unlock()
	now := time.Now()
	fullKey := cfg.prefix + ":mem:" + key
	e, ok := memStore[fullKey]
	if !ok || now.After(e.expiresAt) {
		memStore[fullKey] = &memEntry{count: 1, expiresAt: now.Add(cfg.window)}
		return true
	}
	e.count++
	if e.count > int64(cfg.limit) {
		return false
	}
	return true
}

func redisAllowWithFallback(ctx context.Context, cfg *redisLimiterConfig, key string) bool {
	if resetRedisClient == nil || cfg == nil {
		return memAllow(cfg, key)
	}
	fullKey := cfg.prefix + ":" + key
	ttlMs := int64(cfg.window.Milliseconds())

	script := redis.NewScript(`
		local count = redis.call('INCR', KEYS[1])
		if count == 1 then
			redis.call('EXPIRE', KEYS[1], ARGV[1])
		end
		return count
	`)
	count, err := script.Run(ctx, resetRedisClient, []string{fullKey}, ttlMs).Int64()
	if err != nil {
		return memAllow(cfg, key)
	}
	if count > int64(cfg.limit) {
		return false
	}
	return true
}

// AllowResetIP rate-limits reset requests by IP.
func AllowResetIP(ctx context.Context, ip string) bool {
	return redisAllowWithFallback(ctx, resetLimiters["ip"], "ip:"+ip)
}

// AllowResetEmail rate-limits reset requests by normalized email.
func AllowResetEmail(ctx context.Context, email string) bool {
	return redisAllowWithFallback(ctx, resetLimiters["email"], "email:"+email)
}

// AllowResetGlobal is a system-wide velocity cap.
func AllowResetGlobal(ctx context.Context) bool {
	return redisAllowWithFallback(ctx, resetLimiters["global"], "global")
}

// AllowResetConfirmIP rate-limits reset confirmation attempts by IP.
func AllowResetConfirmIP(ctx context.Context, ip string) bool {
	return redisAllowWithFallback(ctx, resetLimiters["confirm:ip"], "confirm:ip:"+ip)
}

// AllowRecoveryQuestionsIP rate-limits public security-question lookups by IP.
func AllowRecoveryQuestionsIP(ctx context.Context, ip string) bool {
	return redisAllowWithFallback(ctx, resetLimiters["recovery:questions:ip"], "ip:"+ip)
}

// AllowRecoveryQuestionsEmail rate-limits security-question lookups per account.
func AllowRecoveryQuestionsEmail(ctx context.Context, identifier string) bool {
	return redisAllowWithFallback(ctx, resetLimiters["recovery:questions:email"], "email:"+identifier)
}

// AllowRecoveryAnswersIP rate-limits answer submissions by IP.
func AllowRecoveryAnswersIP(ctx context.Context, ip string) bool {
	return redisAllowWithFallback(ctx, resetLimiters["recovery:answers:ip"], "ip:"+ip)
}

// AllowRecoveryAnswersEmail rate-limits answer submissions per account.
func AllowRecoveryAnswersEmail(ctx context.Context, identifier string) bool {
	return redisAllowWithFallback(ctx, resetLimiters["recovery:answers:email"], "email:"+identifier)
}

// AllowRecoverySetup rate-limits authenticated recovery-question changes.
func AllowRecoverySetup(ctx context.Context, userID string) bool {
	return redisAllowWithFallback(ctx, resetLimiters["recovery:setup:user"], "user:"+userID)
}

// AllowAssistanceIP rate-limits help requests by IP.
func AllowAssistanceIP(ctx context.Context, ip string) bool {
	return redisAllowWithFallback(ctx, resetLimiters["assist:ip"], "ip:"+ip)
}

// AllowAssistanceEmail rate-limits help requests per account.
func AllowAssistanceEmail(ctx context.Context, identifier string) bool {
	return redisAllowWithFallback(ctx, resetLimiters["assist:email"], "email:"+identifier)
}

// AllowRecoveryCodeIP rate-limits support-code redemption by IP.
func AllowRecoveryCodeIP(ctx context.Context, ip string) bool {
	return redisAllowWithFallback(ctx, resetLimiters["recovery:code:ip"], "ip:"+ip)
}

// AllowRecoveryCodeEmail rate-limits support-code redemption per account.
func AllowRecoveryCodeEmail(ctx context.Context, identifier string) bool {
	return redisAllowWithFallback(ctx, resetLimiters["recovery:code:email"], "email:"+identifier)
}

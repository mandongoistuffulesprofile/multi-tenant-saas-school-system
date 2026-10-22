package auth

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"
)

// Reset rate limiters — Redis-backed, fail-closed.
// Each is a thin wrapper around a redis.Client + Lua script.
// Deliberately self-contained (no import of middleware) to avoid import cycles.

var (
	resetRedisClient *redis.Client
	resetLimiters    = map[string]*redisLimiterConfig{}
)

type redisLimiterConfig struct {
	prefix string
	limit  int
	window time.Duration
}

func InitResetLimiters(client *redis.Client) {
	resetRedisClient = client
	resetLimiters = map[string]*redisLimiterConfig{
		"ip":         {"rl:reset:ip", 10, time.Minute},
		"email":      {"rl:reset:email", 3, time.Minute},
		"global":     {"rl:reset:global", 100, time.Minute},
		"confirm:ip": {"rl:reset:confirm:ip", 5, time.Minute},
	}
}

func redisAllow(ctx context.Context, cfg *redisLimiterConfig, key string) bool {
	if resetRedisClient == nil || cfg == nil {
		return false // fail closed — not initialised
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
		return false // fail closed
	}
	return count <= int64(cfg.limit)
}

// AllowResetIP rate-limits reset requests by IP.
func AllowResetIP(ctx context.Context, ip string) bool {
	return redisAllow(ctx, resetLimiters["ip"], "ip:"+ip)
}

// AllowResetEmail rate-limits reset requests by normalized email.
func AllowResetEmail(ctx context.Context, email string) bool {
	return redisAllow(ctx, resetLimiters["email"], "email:"+email)
}

// AllowResetGlobal is a system-wide velocity cap.
func AllowResetGlobal(ctx context.Context) bool {
	return redisAllow(ctx, resetLimiters["global"], "global")
}

// AllowResetConfirmIP rate-limits reset confirmation attempts by IP.
func AllowResetConfirmIP(ctx context.Context, ip string) bool {
	return redisAllow(ctx, resetLimiters["confirm:ip"], "confirm:ip:"+ip)
}
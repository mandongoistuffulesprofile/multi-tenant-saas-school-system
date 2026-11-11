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

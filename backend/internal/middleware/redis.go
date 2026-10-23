package middleware

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

// RedisClient wraps go-redis with project defaults.
type RedisClient struct {
	*redis.Client
}

// NewRedisClient creates a Redis client with connection pooling and timeout defaults.
func NewRedisClient(url string) (*RedisClient, error) {
	opts, err := redis.ParseURL(url)
	if err != nil {
		return nil, fmt.Errorf("invalid redis url: %w", err)
	}

	if opts.PoolSize == 0 {
		opts.PoolSize = 10
	}
	if opts.PoolTimeout == 0 {
		opts.PoolTimeout = 30 * time.Second
	}
	if opts.DialTimeout == 0 {
		opts.DialTimeout = 3 * time.Second
	}
	if opts.ReadTimeout == 0 {
		opts.ReadTimeout = 3 * time.Second
	}
	if opts.WriteTimeout == 0 {
		opts.WriteTimeout = 3 * time.Second
	}

	client := redis.NewClient(opts)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("redis ping failed: %w", err)
	}

	return &RedisClient{Client: client}, nil
}

// Close shuts down the Redis client.
func (r *RedisClient) Close() error {
	return r.Client.Close()
}

// RedisRateLimiter is a Redis-backed fixed-window rate limiter.
// Fail-CLOSED: if Redis is unreachable, Allow() returns false (deny traffic).
// This is intentional — an outage must never become an auth bypass.
type RedisRateLimiter struct {
	client    *redis.Client
	keyPrefix string
	limit     int
	window    time.Duration
}

// NewRedisRateLimiter creates a Redis-backed rate limiter.
func NewRedisRateLimiter(client *redis.Client, keyPrefix string, limit int, window time.Duration) *RedisRateLimiter {
	return &RedisRateLimiter{
		client:    client,
		keyPrefix: keyPrefix,
		limit:     limit,
		window:    window,
	}
}

// Allow returns true if the request is allowed, false otherwise.
// Uses INCR + EXPIRE in a single Lua script for atomicity.
// retryAfterMs returns milliseconds until the window resets.
func (rl *RedisRateLimiter) Allow(ctx context.Context, key string) (bool, int64) {
	fullKey := rl.keyPrefix + ":" + key
	ttlMs := int64(rl.window.Milliseconds())

	script := redis.NewScript(`
		local count = redis.call('INCR', KEYS[1])
		if count == 1 then
			redis.call('EXPIRE', KEYS[1], ARGV[1])
		end
		return count
	`)

	count, err := script.Run(ctx, rl.client, []string{fullKey}, ttlMs).Int64()
	if err != nil {
		// Fail CLOSED — Redis down means deny.
		return false, rl.window.Milliseconds()
	}

	if count > int64(rl.limit) {
		ttl, err := rl.client.TTL(ctx, fullKey).Result()
		if err != nil || ttl < 0 {
			ttl = rl.window
		}
		return false, int64(ttl / time.Millisecond)
	}

	return true, 0
}

// Reset clears the counter for a key (used after successful login).
func (rl *RedisRateLimiter) Reset(ctx context.Context, key string) {
	_ = rl.client.Del(ctx, rl.keyPrefix+":"+key).Err()
}

// RedisRateLimitMiddleware is a gin middleware that rate-limits using a RedisRateLimiter.
// Key is extracted via keyFunc. On Redis outage the limiter fails closed (Allow returns false).
func RedisRateLimitMiddleware(rl *RedisRateLimiter, keyFunc func(*gin.Context) string) gin.HandlerFunc {
	return func(c *gin.Context) {
		key := keyFunc(c)
		allowed, retryAfterMs := rl.Allow(c.Request.Context(), key)

		c.Header("X-RateLimit-Limit", fmt.Sprintf("%d", rl.limit))
		c.Header("X-RateLimit-Remaining", "0")

		if !allowed {
			c.Header("Retry-After", fmt.Sprintf("%d", retryAfterMs/1000))
			c.JSON(http.StatusTooManyRequests, gin.H{
				"code":       "RATE_LIMITED",
				"message":    "Too many requests, please try again later",
				"request_id": c.GetString("X-Request-ID"),
			})
			c.Abort()
			return
		}
		c.Next()
	}
}

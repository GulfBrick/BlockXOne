package middleware

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"
)

var observabilityPaths = map[string]struct{}{
	"/healthz":         {},
	"/health/detailed": {},
	"/metrics":         {},
}

// sensitiveAuthPaths are endpoints that handle credentials, signatures,
// or authentication tokens. They share the stricter auth rate-limit bucket.
var sensitiveAuthPaths = map[string]struct{}{
	"/v1/wallets/connect": {},
}

// RateLimiter returns a Gin middleware for Redis-backed rate limiting.
// It applies default per-IP fixed-window limits and skips observability routes.
func RateLimiter(redisURL string) gin.HandlerFunc {
	return RateLimiterWithPolicies(redisURL, 60, 5, time.Minute)
}

// RateLimiterWithConfig returns a Gin middleware for Redis-backed fixed-window rate limiting.
// It applies the same limit to every non-observability request path.
func RateLimiterWithConfig(redisURL string, limit int, window time.Duration) gin.HandlerFunc {
	return rateLimiter(redisURL, window, func(_ string) (string, int) {
		return "api", limit
	})
}

// RateLimiterWithPolicies returns a Gin middleware with separate limits for
// auth and general API routes. Auth routes include /v1/auth/* and wallet
// connect, which handles signature-based authentication.
//
// Production-safe defaults: apiLimit=60/min, authLimit=10/min.
func RateLimiterWithPolicies(redisURL string, apiLimit, authLimit int, window time.Duration) gin.HandlerFunc {
	if apiLimit <= 0 {
		apiLimit = 60
	}
	if authLimit <= 0 {
		authLimit = 10 // stricter default for auth: 10 attempts per window
	}

	return rateLimiter(redisURL, window, func(path string) (string, int) {
		if strings.HasPrefix(path, "/v1/auth/") {
			return "auth", authLimit
		}
		if _, ok := sensitiveAuthPaths[path]; ok {
			return "auth", authLimit
		}
		return "api", apiLimit
	})
}

func rateLimiter(redisURL string, window time.Duration, limitForPath func(path string) (bucket string, limit int)) gin.HandlerFunc {
	if window <= 0 {
		window = time.Minute
	}

	client := newRateLimitClient(redisURL)
	if client == nil {
		return func(c *gin.Context) {
			c.Next()
		}
	}

	return func(c *gin.Context) {
		if _, skip := observabilityPaths[c.Request.URL.Path]; skip || c.Request.Method == http.MethodOptions {
			c.Next()
			return
		}

		bucket, limit := limitForPath(c.Request.URL.Path)
		if limit <= 0 {
			c.Next()
			return
		}

		clientIP := c.ClientIP()
		key := fmt.Sprintf("ratelimit:%s:%s", bucket, clientIP)
		ctx := c.Request.Context()

		current, err := client.Get(ctx, key).Int64()
		if err != nil && err != redis.Nil {
			log.Warn().Err(err).Str("key", key).Msg("redis unavailable, skipping rate limit check")
			c.Next()
			return
		}

		remaining := int64(limit) - current
		if remaining < 0 {
			remaining = 0
		}

		// Always set rate-limit headers so clients can self-regulate.
		c.Header("X-RateLimit-Limit", strconv.Itoa(limit))
		c.Header("X-RateLimit-Remaining", strconv.FormatInt(remaining, 10))
		c.Header("X-RateLimit-Reset", strconv.FormatInt(int64(window.Seconds()), 10))

		if current >= int64(limit) {
			c.Header("Retry-After", strconv.FormatInt(int64(window.Seconds()), 10))
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error":       "rate limit exceeded",
				"retry_after": int(window.Seconds()),
			})
			return
		}

		pipe := client.Pipeline()
		pipe.Incr(ctx, key)
		pipe.Expire(ctx, key, window)
		if _, err := pipe.Exec(ctx); err != nil {
			log.Warn().Err(err).Str("key", key).Msg("redis unavailable, skipping rate limit update")
			c.Next()
			return
		}

		c.Next()
	}
}

func newRateLimitClient(redisURL string) *redis.Client {
	if redisURL == "" {
		log.Warn().Msg("rate limiting disabled: REDIS_URL is empty")
		return nil
	}

	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		log.Warn().Err(err).Msg("rate limiting disabled: invalid REDIS_URL")
		return nil
	}

	client := redis.NewClient(opts)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		log.Warn().Err(err).Msg("rate limiting disabled: Redis is unavailable")
		_ = client.Close()
		return nil
	}

	return client
}

# BlockXOne Security Middleware Usage Guide

This directory contains production-grade security middleware for the BlockXOne Go/Gin API.

## Files Overview

### 1. ratelimit.go (112 lines)
Redis-backed rate limiting using sliding window algorithm.

**Exported Functions:**
- `RateLimiter(redisURL string) gin.HandlerFunc` - Default rate limiting (60 req/min)
- `RateLimiterWithConfig(redisURL string, limit int, window time.Duration) gin.HandlerFunc` - Configurable limits
- `RateLimiterWithPolicies(redisURL string, apiLimit int, authLimit int, window time.Duration) gin.HandlerFunc` - Separate API/auth limits with observability-path bypass

**Usage Example:**
```go
import "blockxone/internal/middleware"

router := gin.New()

// Default: 60 requests per minute per IP
router.Use(middleware.RateLimiter(cfg.RedisURL))

// Custom: 5 requests per minute for auth endpoints
authRoutes := router.Group("/auth")
authRoutes.Use(middleware.RateLimiterWithConfig(cfg.RedisURL, 5, time.Minute))

// Custom: 30 requests per minute for admin endpoints
adminRoutes := router.Group("/admin")
adminRoutes.Use(middleware.RateLimiterWithConfig(cfg.RedisURL, 30, time.Minute))

// Runtime-wide defaults from config
router.Use(middleware.RateLimiterWithPolicies(cfg.RedisURL, cfg.RateLimitAPI, cfg.RateLimitAuth, time.Minute))
```

### 2. security_headers.go (44 lines)
Sets production-grade security headers.

**Exported Functions:**
- `SecurityHeaders() gin.HandlerFunc` - Applies all security headers

**Security Headers Applied:**
- Content-Security-Policy (strict, no inline scripts)
- X-Content-Type-Options: nosniff
- X-Frame-Options: DENY
- X-XSS-Protection: 1; mode=block
- Strict-Transport-Security: max-age=31536000 (1 year, with preload) on HTTPS requests
- Referrer-Policy: strict-origin-when-cross-origin
- Permissions-Policy: disables camera, microphone, geolocation, payment, USB, etc.

**Usage Example:**
```go
router := gin.New()
router.Use(middleware.SecurityHeaders())
```

### 3. request_validator.go (77 lines)
Validates incoming requests with max body size and Content-Type enforcement.

**Exported Functions:**
- `RequestValidator(maxBodySize int64) gin.HandlerFunc` - Full request validation
- `RequestID() gin.HandlerFunc` - Request ID injection only

**Features:**
- Max request body size enforcement (default 1MB)
- Content-Type validation for POST/PUT/PATCH (must be application/json)
- Automatic UUID generation for X-Request-ID header if not present
- Accessible via `c.Get("request_id")` in handlers

**Usage Example:**
```go
router := gin.New()

// Full validation with 2MB max body size
router.Use(middleware.RequestValidator(2 << 20))

// Or just inject request IDs
router.Use(middleware.RequestID())
```

### 4. audit.go (106 lines)
Logs all state-changing requests (POST, PUT, PATCH, DELETE) to audit_log table.

**Exported Functions:**
- `AuditLogger(pool *pgxpool.Pool) gin.HandlerFunc` - Audit logging middleware

**Logged Information:**
- Method and path (action)
- Actor user ID (from auth context, if available)
- Client IP address
- User-Agent header
- HTTP status code
- Request duration
- Request ID

**Usage Example:**
```go
import "blockxone/internal/middleware"

router := gin.New()
router.Use(middleware.AuditLogger(app.DB.Pool))
```

**Database Schema Expected:**
```sql
CREATE TABLE audit_log (
    id UUID PRIMARY KEY,
    actor_user_id VARCHAR,
    action VARCHAR NOT NULL,
    entity_type VARCHAR,
    entity_id UUID,
    before_json JSONB,
    after_json JSONB,
    ip INET,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 5. cors.go (81 lines)
Production CORS middleware with dev/prod mode support.

**Exported Functions:**
- `CORS(appEnv string, allowedOrigins []string) gin.HandlerFunc` - CORS middleware

**Features:**
- Configurable allowed origins
- Auto-allows localhost origins in dev mode
- Proper preflight (OPTIONS) handling
- Supports credentials
- Exposes custom headers (X-Request-ID, X-Total-Count, etc.)
- Allows dev auth headers (`X-Dev-*`) during browser preflight

**Usage Example:**
```go
import "blockxone/internal/middleware"

router := gin.New()

// Production: strict origins
router.Use(middleware.CORS("production", []string{
    "https://app.example.com",
    "https://www.example.com",
}))

// Development: auto-allows localhost
router.Use(middleware.CORS("dev", []string{
    "https://api.example.com",
}))
```

## Middleware Stack Order

Recommended middleware registration order for optimal security and performance:

```go
router := gin.New()

// 1. Security headers (first, applies to all responses)
router.Use(middleware.SecurityHeaders())

// 2. Metrics
router.Use(monitoring.PrometheusMiddleware())

// 3. CORS (before request validation)
router.Use(middleware.CORS(cfg.AppEnv, corsOrigins))

// 4. Request validation and ID injection
router.Use(middleware.RequestValidator(1 << 20)) // 1MB

// 5. Rate limiting (protects backend resources, skips health/metrics)
router.Use(middleware.RateLimiterWithPolicies(cfg.RedisURL, cfg.RateLimitAPI, cfg.RateLimitAuth, time.Minute))

// 6. Audit logging (logs final state-changing requests)
router.Use(middleware.AuditLogger(app.DB.Pool))

// 7. Authentication and other handlers
// ... rest of middleware and route handlers
```

## Environment Variables

### Rate Limiting
- `REDIS_URL`: Redis connection URL (e.g., "redis://localhost:6379/0")

### CORS
- `APP_ENV`: Application environment ("dev" or "production")
- Configure allowed origins as a parameter to CORS()

### Request Validation
- Configure max body size as a parameter to RequestValidator()
- Default: 1MB (1 << 20 bytes)

## Dependencies

Make sure these are in your go.mod:
```go
require (
    github.com/gin-gonic/gin v1.10.0
    github.com/redis/go-redis/v9 v9.x.x
    github.com/jackc/pgx/v5 v5.6.0
    github.com/google/uuid v1.x.x
    github.com/rs/zerolog v1.x.x
)
```

## Production Checklist

- [ ] Set `APP_ENV=production`
- [ ] Configure CORS origins (not allowing wildcard "*")
- [ ] Set Redis URL with proper authentication
- [ ] Configure rate limits appropriate for your API
- [ ] Verify HSTS header is set correctly
- [ ] Test audit logging to database
- [ ] Configure proper Content-Security-Policy for your frontend
- [ ] Monitor rate limit metrics in Redis
- [ ] Review security headers with OWASP guidelines

## Security Notes

1. **Rate Limiting**: Uses Redis with per-IP fixed windows. Observability paths bypass it, and Redis failures fail open so monitoring and core API availability are not taken down by the limiter itself.
2. **Audit Logging**: Runs asynchronously to not block requests. Database writes are logged if they fail.
3. **Security Headers**: CSP allows only same-origin scripts. HSTS is only emitted for HTTPS requests or HTTPS-aware proxies.
4. **CORS**: Development mode auto-allows localhost. Never use dev mode in production.
5. **Request Validation**: Enforces JSON media types for data-bearing methods, including `application/json; charset=utf-8`.

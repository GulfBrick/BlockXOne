package middleware

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"blockxone/internal/audit"
	"blockxone/internal/auth"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"
)

// AuditLogger returns a Gin middleware that logs all state-changing requests (POST, PUT, PATCH, DELETE)
// to the audit_log table. It captures:
// - actor (user ID from auth context, if available)
// - action (method + path)
// - IP address
// - user-agent
// - HTTP status code
// - request duration
// - request ID (from RequestID middleware)
func AuditLogger(pool *pgxpool.Pool) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Only audit state-changing methods
		method := c.Request.Method
		if method != http.MethodPost && method != http.MethodPut && method != http.MethodPatch && method != http.MethodDelete {
			c.Next()
			return
		}

		// Capture start time for duration calculation
		startTime := time.Now()

		// Get request context
		requestID := extractRequestID(c)
		clientIP := c.ClientIP()
		userAgent := c.GetHeader("User-Agent")
		path := c.Request.URL.Path
		action := fmt.Sprintf("%s %s", method, path)

		// Extract actor (user ID) from request context if available
		var actorUserID string
		if principal := auth.FromContext(c); principal != nil {
			actorUserID = principal.UserID
		}

		// Process request
		c.Next()

		// Capture response status
		statusCode := c.Writer.Status()
		duration := time.Since(startTime)

		// Log to structured logger
		logEntry := log.Info().
			Str("request_id", requestID).
			Str("action", action).
			Str("method", method).
			Str("path", path).
			Str("ip", clientIP).
			Str("user_agent", userAgent).
			Int("status_code", statusCode).
			Dur("duration_ms", duration)

		if actorUserID != "" {
			logEntry.Str("actor_user_id", actorUserID)
		}

		logEntry.Msg("audit log: state-changing request")

		// Log to database asynchronously to avoid blocking request
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()

			err := audit.Log(ctx, pool, actorUserID, action, "", "", nil, nil, clientIP)
			if err != nil {
				log.Error().
					Err(err).
					Str("request_id", requestID).
					Str("action", action).
					Msg("failed to write audit log")
			}
		}()
	}
}

// extractRequestID attempts to get the request ID from the gin context.
// It checks the context value set by RequestID middleware, or generates a fallback.
func extractRequestID(c *gin.Context) string {
	if reqID, exists := c.Get("request_id"); exists {
		if id, ok := reqID.(string); ok && id != "" {
			return id
		}
	}
	// Fallback to X-Request-ID header
	if id := c.GetHeader("X-Request-ID"); id != "" {
		return id
	}
	return "unknown"
}

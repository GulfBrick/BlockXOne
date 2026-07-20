package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog/log"
)

// CORS returns a Gin middleware for production-grade CORS handling.
// It supports:
// - Configurable allowed origins via allowedOrigins parameter
// - Dev mode: automatically allows localhost origins
// - Production mode: only allows explicitly configured origins
// - Proper preflight (OPTIONS) handling
// - Standard CORS headers and credentials support
func CORS(appEnv string, allowedOrigins []string) gin.HandlerFunc {
	// Add localhost origins in dev mode
	if appEnv == "dev" {
		devOrigins := []string{
			"http://localhost:3000",
			"http://localhost:5173",
			"http://localhost:8000",
			"http://localhost:8080",
			"http://127.0.0.1:3000",
			"http://127.0.0.1:5173",
			"http://127.0.0.1:8000",
			"http://127.0.0.1:8080",
		}
		allowedOrigins = append(allowedOrigins, devOrigins...)
	}

	// Create origin map for O(1) lookups
	originMap := make(map[string]bool, len(allowedOrigins))
	for _, origin := range allowedOrigins {
		originMap[strings.ToLower(strings.TrimSpace(origin))] = true
	}

	log.Info().
		Str("env", appEnv).
		Int("allowed_origins_count", len(originMap)).
		Msg("CORS middleware initialized")

	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		c.Header("Vary", "Origin, Access-Control-Request-Method, Access-Control-Request-Headers")

		// Check if origin is allowed
		allowed := originMap[strings.ToLower(origin)]

		if !allowed && origin != "" {
			log.Warn().
				Str("origin", origin).
				Msg("CORS request from disallowed origin rejected")
		}

		// Handle preflight requests
		if c.Request.Method == http.MethodOptions {
			if !allowed {
				c.AbortWithStatus(http.StatusForbidden)
				return
			}
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-ID, X-Dev-User-Id, X-Dev-Email, X-Dev-Org-Id, X-Dev-Roles")
			c.Header("Access-Control-Max-Age", "86400") // 24 hours
			c.Header("Access-Control-Allow-Credentials", "true")
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		// Handle actual requests
		if allowed {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Access-Control-Allow-Credentials", "true")
			c.Header("Access-Control-Expose-Headers", "Content-Type, X-Request-ID, X-Total-Count, X-Page, X-Page-Size")
		}

		c.Next()
	}
}

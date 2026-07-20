package middleware

import (
	"strings"

	"github.com/gin-gonic/gin"
)

// SecurityHeaders returns a Gin middleware that sets production-grade security headers.
// It includes:
// - Content-Security-Policy (strict, no inline scripts)
// - X-Content-Type-Options: nosniff
// - X-Frame-Options: DENY
// - X-XSS-Protection: 1; mode=block
// - Strict-Transport-Security (HSTS) with max-age=31536000
// - Referrer-Policy: strict-origin-when-cross-origin
// - Permissions-Policy: camera=(), microphone=(), geolocation=()
func SecurityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Content-Security-Policy: strict policy blocking inline scripts and external resources
		c.Header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")

		// Prevent MIME type sniffing
		c.Header("X-Content-Type-Options", "nosniff")

		// Prevent clickjacking attacks
		c.Header("X-Frame-Options", "DENY")

		// Enable XSS protection in older browsers
		c.Header("X-XSS-Protection", "1; mode=block")

		// Only advertise HSTS on HTTPS requests or behind an HTTPS-aware proxy.
		if c.Request.TLS != nil || strings.EqualFold(c.GetHeader("X-Forwarded-Proto"), "https") {
			c.Header("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload")
		}

		// Referrer Policy: only send referrer for same-origin requests
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")

		// Permissions Policy: disable access to sensitive APIs
		c.Header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()")

		// Remove server identification headers for security through obscurity
		c.Header("Server", "")

		c.Next()
	}
}

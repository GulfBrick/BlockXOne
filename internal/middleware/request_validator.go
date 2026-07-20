package middleware

import (
	"mime"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
)

// RequestValidator returns a Gin middleware that validates incoming requests.
// It enforces:
// - Maximum request body size (default 1MB)
// - Content-Type enforcement for POST/PUT/PATCH (must be application/json)
// - Request ID injection (generates UUID if not present)
func RequestValidator(maxBodySize int64) gin.HandlerFunc {
	if maxBodySize <= 0 {
		maxBodySize = 1 << 20 // 1MB default
	}

	return func(c *gin.Context) {
		// Inject request ID
		requestID := c.GetString("request_id")
		if requestID == "" {
			requestID = c.GetHeader("X-Request-ID")
		}
		if requestID == "" {
			requestID = uuid.New().String()
		}
		c.Set("request_id", requestID)
		c.Header("X-Request-ID", requestID)

		// Validate request body size for methods that accept bodies
		if c.Request.Method == http.MethodPost || c.Request.Method == http.MethodPut || c.Request.Method == http.MethodPatch {
			// Set max body size limit
			c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBodySize)

			// Validate Content-Type is application/json for data-bearing methods
			if c.Request.ContentLength == 0 {
				c.Next()
				return
			}

			contentType := c.GetHeader("Content-Type")
			if contentType != "" {
				mediaType, _, err := mime.ParseMediaType(contentType)
				if err != nil || (mediaType != "application/json" && !strings.HasSuffix(mediaType, "+json")) {
					log.Warn().
						Str("request_id", requestID).
						Str("method", c.Request.Method).
						Str("content_type", contentType).
						Msg("invalid content type for request")
					c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{
						"error": "content type must be application/json",
					})
					return
				}
			}
		}

		c.Next()

		// Log large body warnings
		if c.Request.ContentLength > maxBodySize {
			log.Warn().
				Str("request_id", requestID).
				Int64("content_length", c.Request.ContentLength).
				Int64("max_size", maxBodySize).
				Msg("request body exceeds size limit")
		}
	}
}

// RequestID returns a Gin middleware that injects a unique request ID into each request.
// If X-Request-ID header is present, it uses that; otherwise generates a UUID.
// The request ID is accessible via c.Get("request_id") and returned in X-Request-ID response header.
func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		requestID := c.GetHeader("X-Request-ID")
		if requestID == "" {
			requestID = uuid.New().String()
		}
		c.Set("request_id", requestID)
		c.Header("X-Request-ID", requestID)
		c.Next()
	}
}

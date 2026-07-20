package logging

import (
	"context"
	"os"
	"regexp"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

// RequestIDKey is the context key for request ID
const RequestIDKey = "request_id"

// UserIDKey is the context key for user ID
const UserIDKey = "user_id"

// OrgIDKey is the context key for organization ID
const OrgIDKey = "org_id"

// SensitiveFields patterns to mask in logs
var sensitivePatterns = []*regexp.Regexp{
	regexp.MustCompile(`[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}`), // emails
	regexp.MustCompile(`0x[a-fA-F0-9]{40}`),                              // wallet addresses
	regexp.MustCompile(`"password"\s*:\s*"[^"]*"`),                       // passwords
	regexp.MustCompile(`"api_key"\s*:\s*"[^"]*"`),                        // API keys
	regexp.MustCompile(`"secret"\s*:\s*"[^"]*"`),                         // secrets
	regexp.MustCompile(`"token"\s*:\s*"[^"]*"`),                          // tokens
}

// MaskSensitiveData masks sensitive information in strings
func MaskSensitiveData(data string) string {
	masked := data
	for _, pattern := range sensitivePatterns {
		masked = pattern.ReplaceAllString(masked, "[REDACTED]")
	}
	return masked
}

// WithRequestContext adds request context to logger
func WithRequestContext(c *gin.Context) zerolog.Logger {
	logger := log.With()

	// Add request ID
	if requestID := c.GetString(RequestIDKey); requestID != "" {
		logger = logger.Str("request_id", requestID)
	}

	// Add user ID from context
	if userID := c.GetString(UserIDKey); userID != "" {
		logger = logger.Str("user_id", userID)
	}

	// Add organization ID from context
	if orgID := c.GetString(OrgIDKey); orgID != "" {
		logger = logger.Str("org_id", orgID)
	}

	// Add request information
	logger = logger.
		Str("method", c.Request.Method).
		Str("path", c.Request.URL.Path).
		Str("ip", c.ClientIP())

	return logger.Logger()
}

// WithContext adds context to logger
func WithContext(ctx context.Context) zerolog.Logger {
	logger := log.With()

	// Add request ID
	if requestID := ctx.Value(RequestIDKey); requestID != nil {
		logger = logger.Str("request_id", requestID.(string))
	}

	// Add user ID
	if userID := ctx.Value(UserIDKey); userID != nil {
		logger = logger.Str("user_id", userID.(string))
	}

	// Add organization ID
	if orgID := ctx.Value(OrgIDKey); orgID != nil {
		logger = logger.Str("org_id", orgID.(string))
	}

	return logger.Logger()
}

// ConfigureOutput configures the logging output based on environment
func ConfigureOutput(appEnv string) {
	if appEnv == "dev" {
		// Pretty console output for development
		log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stdout})
	} else {
		// JSON output for production
		log.Logger = log.Output(os.Stdout)
	}
}

// SetLogLevel sets the global log level
func SetLogLevel(level string) {
	var zlevel zerolog.Level
	switch level {
	case "debug":
		zlevel = zerolog.DebugLevel
	case "info":
		zlevel = zerolog.InfoLevel
	case "warn":
		zlevel = zerolog.WarnLevel
	case "error":
		zlevel = zerolog.ErrorLevel
	default:
		zlevel = zerolog.InfoLevel
	}
	zerolog.SetGlobalLevel(zlevel)
}

// LogRequest logs incoming request
func LogRequest(c *gin.Context) {
	logger := WithRequestContext(c)
	logger.Info().
		Str("method", c.Request.Method).
		Str("path", c.Request.URL.Path).
		Msg("Incoming request")
}

// LogResponse logs response information
func LogResponse(c *gin.Context, duration float64) {
	logger := WithRequestContext(c)
	statusCode := c.Writer.Status()

	// Determine log level based on status
	logFunc := logger.Info()
	if statusCode >= 500 {
		logFunc = logger.Error()
	} else if statusCode >= 400 {
		logFunc = logger.Warn()
	}

	logFunc.
		Int("status", statusCode).
		Float64("duration_ms", duration).
		Int("size", c.Writer.Size()).
		Msg("Response sent")
}

// LogError logs an error with context
func LogError(c *gin.Context, err error, message string) {
	logger := WithRequestContext(c)
	logger.Error().
		Err(err).
		Msg(message)
}

// LogAudit logs audit events
func LogAudit(c *gin.Context, action string, resourceType string, resourceID string, details map[string]interface{}) {
	logger := WithRequestContext(c)
	logger.Info().
		Str("action", action).
		Str("resource_type", resourceType).
		Str("resource_id", resourceID).
		Interface("details", details).
		Msg("Audit event")
}

// LogSecurityEvent logs security-related events
func LogSecurityEvent(c *gin.Context, event string, details map[string]interface{}) {
	logger := WithRequestContext(c)
	logger.Warn().
		Str("security_event", event).
		Interface("details", details).
		Msg("Security event detected")
}

package monitoring

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
)

// AlertLevel represents the severity level of an alert
type AlertLevel string

const (
	AlertLevelInfo     AlertLevel = "INFO"
	AlertLevelWarning  AlertLevel = "WARNING"
	AlertLevelCritical AlertLevel = "CRITICAL"
)

// AlertType represents the type of alert
type AlertType string

const (
	AlertTypeHighErrorRate     AlertType = "HighErrorRate"
	AlertTypeSlowResponse      AlertType = "SlowResponse"
	AlertTypeDatabaseDown      AlertType = "DatabaseDown"
	AlertTypeChainRPCDown      AlertType = "ChainRPCDown"
	AlertTypeKYCProviderDown   AlertType = "KYCProviderDown"
	AlertTypeHighMemory        AlertType = "HighMemory"
	AlertTypeHighCPU           AlertType = "HighCPU"
	AlertTypeConnectionPoolLow AlertType = "ConnectionPoolLow"
)

// Alert represents a single alert
type Alert struct {
	ID        string                 `json:"id"`
	Timestamp time.Time              `json:"timestamp"`
	Level     AlertLevel             `json:"level"`
	Type      AlertType              `json:"type"`
	Service   string                 `json:"service"`
	Message   string                 `json:"message"`
	Tags      map[string]string      `json:"tags,omitempty"`
	Context   map[string]interface{} `json:"context,omitempty"`
}

// AlertManager manages and sends alerts
type AlertManager struct {
	webhookURL  string
	lastAlerts  map[string]time.Time
	cooldownDur time.Duration
	mu          sync.RWMutex
	httpClient  *http.Client
}

// NewAlertManager creates a new alert manager
func NewAlertManager(webhookURL string) *AlertManager {
	return &AlertManager{
		webhookURL:  webhookURL,
		lastAlerts:  make(map[string]time.Time),
		cooldownDur: 5 * time.Minute,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// SetCooldown sets the cooldown duration to prevent alert storms
func (am *AlertManager) SetCooldown(d time.Duration) {
	am.mu.Lock()
	defer am.mu.Unlock()
	am.cooldownDur = d
}

// Alert sends an alert
func (am *AlertManager) Alert(level AlertLevel, alertType AlertType, message string) error {
	return am.AlertWithContext(level, alertType, message, nil, nil)
}

// AlertWithContext sends an alert with additional context
func (am *AlertManager) AlertWithContext(level AlertLevel, alertType AlertType, message string,
	tags map[string]string, context map[string]interface{}) error {

	alertID := string(alertType)

	// Check cooldown
	am.mu.RLock()
	lastTime, exists := am.lastAlerts[alertID]
	am.mu.RUnlock()

	if exists && time.Since(lastTime) < am.cooldownDur {
		// Still in cooldown period
		return nil
	}

	alert := &Alert{
		ID:        generateAlertID(),
		Timestamp: time.Now().UTC(),
		Level:     level,
		Type:      alertType,
		Service:   "blockxone-api",
		Message:   message,
		Tags:      tags,
		Context:   context,
	}

	// Log locally first
	loggerEvent := log.Info()
	switch level {
	case AlertLevelWarning:
		loggerEvent = log.Warn()
	case AlertLevelCritical:
		loggerEvent = log.Error()
	}
	loggerEvent.
		Str("alert_id", alert.ID).
		Str("type", string(alert.Type)).
		Str("message", alert.Message).
		Interface("tags", alert.Tags).
		Interface("context", alert.Context).
		Msg("Alert triggered")

	// Send to webhook if configured
	if am.webhookURL != "" {
		if err := am.sendWebhook(alert); err != nil {
			log.Warn().Err(err).Msg("Failed to send alert webhook")
		}
	}

	// Update cooldown
	am.mu.Lock()
	am.lastAlerts[alertID] = time.Now()
	am.mu.Unlock()

	return nil
}

// sendWebhook sends the alert to the configured webhook
func (am *AlertManager) sendWebhook(alert *Alert) (err error) {
	payload, err := json.Marshal(alert)
	if err != nil {
		return err
	}

	resp, err := am.httpClient.Post(
		am.webhookURL,
		"application/json",
		bytes.NewBuffer(payload),
	)
	if err != nil {
		return err
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			err = errors.Join(err, fmt.Errorf("close alert webhook response body: %w", closeErr))
		}
	}()

	if resp.StatusCode >= 400 {
		return ErrWebhookFailed
	}

	return nil
}

// AlertHighErrorRate sends a high error rate alert
func (am *AlertManager) AlertHighErrorRate(errorRate float64, threshold float64) error {
	return am.AlertWithContext(
		AlertLevelWarning,
		AlertTypeHighErrorRate,
		"High error rate detected",
		map[string]string{
			"threshold": formatFloat(threshold),
			"current":   formatFloat(errorRate),
		},
		map[string]interface{}{
			"error_rate": errorRate,
			"threshold":  threshold,
		},
	)
}

// AlertSlowResponse sends a slow response alert
func (am *AlertManager) AlertSlowResponse(latency time.Duration, threshold time.Duration) error {
	return am.AlertWithContext(
		AlertLevelWarning,
		AlertTypeSlowResponse,
		"Slow API response detected",
		map[string]string{
			"threshold": threshold.String(),
			"current":   latency.String(),
		},
		map[string]interface{}{
			"latency":   latency.String(),
			"threshold": threshold.String(),
		},
	)
}

// AlertDatabaseDown sends a database down alert
func (am *AlertManager) AlertDatabaseDown(err error) error {
	return am.AlertWithContext(
		AlertLevelCritical,
		AlertTypeDatabaseDown,
		"Database connection failed",
		nil,
		map[string]interface{}{
			"error": err.Error(),
		},
	)
}

// AlertChainRPCDown sends a chain RPC down alert
func (am *AlertManager) AlertChainRPCDown(err error) error {
	return am.AlertWithContext(
		AlertLevelCritical,
		AlertTypeChainRPCDown,
		"Blockchain RPC connection failed",
		nil,
		map[string]interface{}{
			"error": err.Error(),
		},
	)
}

// AlertKYCProviderDown sends a KYC provider down alert
func (am *AlertManager) AlertKYCProviderDown(provider string, err error) error {
	return am.AlertWithContext(
		AlertLevelCritical,
		AlertTypeKYCProviderDown,
		"KYC provider connection failed",
		map[string]string{
			"provider": provider,
		},
		map[string]interface{}{
			"error": err.Error(),
		},
	)
}

// AlertConnectionPoolExhaustion sends a connection pool exhaustion alert
func (am *AlertManager) AlertConnectionPoolExhaustion(used, total int) error {
	percentage := float64(used) / float64(total) * 100
	return am.AlertWithContext(
		AlertLevelWarning,
		AlertTypeConnectionPoolLow,
		"Database connection pool near exhaustion",
		map[string]string{
			"used":  formatInt(used),
			"total": formatInt(total),
		},
		map[string]interface{}{
			"used_connections":  used,
			"total_connections": total,
			"usage_percentage":  percentage,
		},
	)
}

// Helper functions
func generateAlertID() string {
	return time.Now().UTC().Format("20060102150405") + "-" + randomString(8)
}

func formatFloat(f float64) string {
	return formatFloatWithPrecision(f, 2)
}

func formatFloatWithPrecision(f float64, precision int) string {
	return "0.00" // Placeholder - use fmt.Sprintf in production
}

func formatInt(i int) string {
	return "0" // Placeholder - use strconv in production
}

func randomString(length int) string {
	return "abcdef" // Placeholder - generate random in production
}

// Error definitions
var (
	ErrWebhookFailed = &AlertError{message: "webhook request failed"}
)

// AlertError represents an alert-related error
type AlertError struct {
	message string
}

func (e *AlertError) Error() string {
	return e.message
}

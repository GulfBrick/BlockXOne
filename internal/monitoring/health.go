package monitoring

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nats-io/nats.go"
	"github.com/redis/go-redis/v9"
)

// HealthStatus represents the health status of the system
type HealthStatus struct {
	Status         string                 `json:"status"`
	Timestamp      time.Time              `json:"timestamp"`
	Uptime         string                 `json:"uptime"`
	Version        string                 `json:"version"`
	BuildInfo      string                 `json:"build_info"`
	Dependencies   map[string]DepStatus   `json:"dependencies"`
	DetailedChecks map[string]interface{} `json:"detailed_checks,omitempty"`
}

// DepStatus represents the status of a dependency
type DepStatus struct {
	Status  string `json:"status"`
	Message string `json:"message,omitempty"`
}

var (
	startTime = time.Now()
	version   = "1.0.0"
	buildInfo = "development"
)

// SetVersion sets the version information
func SetVersion(v, build string) {
	version = v
	buildInfo = build
}

// SimpleHealthHandler returns a simple health check handler
func SimpleHealthHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":    "ok",
			"timestamp": time.Now().UTC().Format(time.RFC3339),
			"service":   "blockxone-api",
		})
	}
}

// DetailedHealthHandler returns a detailed health check handler
func DetailedHealthHandler(dbPool *pgxpool.Pool, redisURL, natsURL, chainRPC string) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
		defer cancel()

		health := &HealthStatus{
			Status:         "healthy",
			Timestamp:      time.Now().UTC(),
			Uptime:         time.Since(startTime).String(),
			Version:        version,
			BuildInfo:      buildInfo,
			Dependencies:   make(map[string]DepStatus),
			DetailedChecks: make(map[string]interface{}),
		}

		// Check PostgreSQL
		if dbPool != nil {
			if err := dbPool.Ping(ctx); err != nil {
				health.Dependencies["postgresql"] = DepStatus{
					Status:  "down",
					Message: err.Error(),
				}
				health.Status = "degraded"
			} else {
				stats := dbPool.Stat()
				health.Dependencies["postgresql"] = DepStatus{Status: "up"}
				health.DetailedChecks["postgresql_connections"] = map[string]interface{}{
					"acquired":      stats.AcquiredConns(),
					"idle":          stats.IdleConns(),
					"total":         stats.TotalConns(),
					"wait_count":    stats.EmptyAcquireCount(),
					"wait_duration": stats.AcquireDuration().String(),
				}
			}
		}

		// Check Redis connectivity
		if redisURL != "" {
			if ok, message := checkRedisHealth(ctx, redisURL); ok {
				health.Dependencies["redis"] = DepStatus{Status: "up"}
			} else {
				health.Dependencies["redis"] = DepStatus{
					Status:  "down",
					Message: message,
				}
				health.Status = "degraded"
			}
		}

		// Check NATS connectivity
		if natsURL != "" {
			if ok, message := checkNATSHealth(ctx, natsURL); ok {
				health.Dependencies["nats"] = DepStatus{Status: "up"}
			} else {
				health.Dependencies["nats"] = DepStatus{
					Status:  "down",
					Message: message,
				}
				health.Status = "degraded"
			}
		}

		// Check blockchain RPC
		if chainRPC != "" {
			if ok, message := checkChainRPCHealth(ctx, chainRPC); ok {
				health.Dependencies["blockchain_rpc"] = DepStatus{Status: "up"}
			} else {
				health.Dependencies["blockchain_rpc"] = DepStatus{
					Status:  "down",
					Message: message,
				}
				health.Status = "degraded"
			}
		}

		statusCode := http.StatusOK
		if health.Status == "degraded" {
			statusCode = http.StatusServiceUnavailable
		}

		c.JSON(statusCode, health)
	}
}

// checkRedisHealth checks if Redis is accessible
func checkRedisHealth(ctx context.Context, redisURL string) (ok bool, message string) {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return false, fmt.Sprintf("invalid redis url: %v", err)
	}

	client := redis.NewClient(opts)
	defer func() {
		if closeErr := client.Close(); closeErr != nil {
			ok = false
			closeMessage := fmt.Sprintf("close Redis health-check client: %v", closeErr)
			if message == "" {
				message = closeMessage
			} else {
				message += "; " + closeMessage
			}
		}
	}()

	if err := client.Ping(ctx).Err(); err != nil {
		return false, err.Error()
	}

	return true, ""
}

// checkNATSHealth checks if NATS is accessible
func checkNATSHealth(ctx context.Context, natsURL string) (bool, string) {
	timeout := 3 * time.Second
	if deadline, ok := ctx.Deadline(); ok {
		remaining := time.Until(deadline)
		if remaining > 0 && remaining < timeout {
			timeout = remaining
		}
	}

	nc, err := nats.Connect(natsURL, nats.Timeout(timeout), nats.NoReconnect())
	if err != nil {
		return false, err.Error()
	}
	defer nc.Close()

	if err := nc.FlushTimeout(timeout); err != nil {
		return false, err.Error()
	}

	return true, ""
}

// checkChainRPCHealth checks if blockchain RPC is accessible
func checkChainRPCHealth(ctx context.Context, chainRPC string) (ok bool, message string) {
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		chainRPC,
		bytes.NewBufferString(`{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}`),
	)
	if err != nil {
		return false, err.Error()
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return false, err.Error()
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			ok = false
			closeMessage := fmt.Sprintf("close blockchain RPC health-check response body: %v", closeErr)
			if message == "" {
				message = closeMessage
			} else {
				message += "; " + closeMessage
			}
		}
	}()

	if resp.StatusCode != http.StatusOK {
		return false, fmt.Sprintf("unexpected status %d", resp.StatusCode)
	}

	var payload struct {
		Result string `json:"result"`
		Error  *struct {
			Message string `json:"message"`
		} `json:"error,omitempty"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return false, err.Error()
	}
	if payload.Error != nil {
		return false, payload.Error.Message
	}
	if payload.Result == "" {
		return false, "empty eth_chainId result"
	}

	return true, ""
}

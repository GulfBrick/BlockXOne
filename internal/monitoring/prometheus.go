package monitoring

import (
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Prometheus metrics for BlockXOne
var (
	// HTTP metrics
	httpRequestDurationHistogram = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "blockxone_http_request_duration_seconds",
			Help:    "HTTP request duration in seconds",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"method", "path", "status"},
	)

	httpRequestsTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "blockxone_http_requests_total",
			Help: "Total HTTP requests",
		},
		[]string{"method", "path", "status"},
	)

	activeConnections = prometheus.NewGauge(
		prometheus.GaugeOpts{
			Name: "blockxone_active_connections",
			Help: "Number of active connections",
		},
	)

	// Database metrics
	dbQueryDurationHistogram = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "blockxone_db_query_duration_seconds",
			Help:    "Database query duration in seconds",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"operation", "table"},
	)

	// Business metrics
	tokensMintedTotal = prometheus.NewCounter(
		prometheus.CounterOpts{
			Name: "blockxone_tokens_minted_total",
			Help: "Total number of tokens minted",
		},
	)

	offeringsCreatedTotal = prometheus.NewCounter(
		prometheus.CounterOpts{
			Name: "blockxone_offerings_created_total",
			Help: "Total number of offerings created",
		},
	)

	kycVerificationsTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "blockxone_kyc_verifications_total",
			Help: "Total number of KYC verifications",
		},
		[]string{"status"},
	)

	tradesExecutedTotal = prometheus.NewCounter(
		prometheus.CounterOpts{
			Name: "blockxone_trades_executed_total",
			Help: "Total number of trades executed",
		},
	)
)

func init() {
	// Register all metrics
	prometheus.MustRegister(
		httpRequestDurationHistogram,
		httpRequestsTotal,
		activeConnections,
		dbQueryDurationHistogram,
		tokensMintedTotal,
		offeringsCreatedTotal,
		kycVerificationsTotal,
		tradesExecutedTotal,
	)
}

// PrometheusMiddleware returns a Gin middleware for Prometheus metrics collection
func PrometheusMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		method := c.Request.Method

		// Track active connections
		activeConnections.Inc()
		defer activeConnections.Dec()

		c.Next()

		duration := time.Since(start).Seconds()
		path := c.FullPath()
		if path == "" {
			path = c.Request.URL.Path
		}
		status := strconv.Itoa(c.Writer.Status())

		// Record metrics
		httpRequestDurationHistogram.WithLabelValues(method, path, status).Observe(duration)
		httpRequestsTotal.WithLabelValues(method, path, status).Inc()
	}
}

// MetricsHandler returns the Prometheus metrics handler for Gin
func MetricsHandler() gin.HandlerFunc {
	h := promhttp.Handler()
	return func(c *gin.Context) {
		h.ServeHTTP(c.Writer, c.Request)
	}
}

// RecordDBQueryDuration records a database query duration
func RecordDBQueryDuration(operation, table string, duration time.Duration) {
	dbQueryDurationHistogram.WithLabelValues(operation, table).Observe(duration.Seconds())
}

// IncrementTokensMinted increments the tokens minted counter
func IncrementTokensMinted(count int64) {
	for i := int64(0); i < count; i++ {
		tokensMintedTotal.Inc()
	}
}

// IncrementOfferingsCreated increments the offerings created counter
func IncrementOfferingsCreated(count int64) {
	for i := int64(0); i < count; i++ {
		offeringsCreatedTotal.Inc()
	}
}

// IncrementKYCVerification increments the KYC verification counter
func IncrementKYCVerification(status string) {
	kycVerificationsTotal.WithLabelValues(status).Inc()
}

// IncrementTradesExecuted increments the trades executed counter
func IncrementTradesExecuted(count int64) {
	for i := int64(0); i < count; i++ {
		tradesExecutedTotal.Inc()
	}
}

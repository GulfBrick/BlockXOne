package monitoring

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestPrometheusMiddlewareUsesRoutePatternAndNumericStatus(t *testing.T) {
	gin.SetMode(gin.TestMode)

	router := gin.New()
	router.Use(PrometheusMiddleware())
	router.GET("/orders/:id", func(c *gin.Context) {
		c.Status(http.StatusCreated)
	})
	router.GET("/metrics", MetricsHandler())

	req := httptest.NewRequest(http.MethodGet, "/orders/42", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	metricsReq := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	metricsResp := httptest.NewRecorder()
	router.ServeHTTP(metricsResp, metricsReq)

	body := metricsResp.Body.String()
	if !strings.Contains(body, `path="/orders/:id",status="201"`) {
		t.Fatalf("expected metrics output to use route pattern and numeric status, got %s", body)
	}
}

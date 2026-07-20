package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestCORSPreflightAllowsDevHeaders(t *testing.T) {
	gin.SetMode(gin.TestMode)

	router := gin.New()
	router.Use(CORS("dev", []string{"http://localhost:3000"}))
	router.OPTIONS("/v1/auth/login", func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	req := httptest.NewRequest(http.MethodOptions, "/v1/auth/login", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	req.Header.Set("Access-Control-Request-Method", http.MethodPost)
	req.Header.Set("Access-Control-Request-Headers", "X-Dev-User-Id, Content-Type")

	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusNoContent {
		t.Fatalf("expected preflight to succeed, got %d", resp.Code)
	}
	if allowHeaders := resp.Header().Get("Access-Control-Allow-Headers"); !strings.Contains(allowHeaders, "X-Dev-User-Id") {
		t.Fatalf("expected preflight headers to allow dev auth headers, got %q", allowHeaders)
	}
}

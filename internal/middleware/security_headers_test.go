package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestSecurityHeadersOnlySetHSTSForHTTPS(t *testing.T) {
	gin.SetMode(gin.TestMode)

	router := gin.New()
	router.Use(SecurityHeaders())
	router.GET("/status", func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	httpReq := httptest.NewRequest(http.MethodGet, "/status", nil)
	httpResp := httptest.NewRecorder()
	router.ServeHTTP(httpResp, httpReq)
	if got := httpResp.Header().Get("Strict-Transport-Security"); got != "" {
		t.Fatalf("expected no HSTS header on plain HTTP request, got %q", got)
	}

	httpsReq := httptest.NewRequest(http.MethodGet, "/status", nil)
	httpsReq.Header.Set("X-Forwarded-Proto", "https")
	httpsResp := httptest.NewRecorder()
	router.ServeHTTP(httpsResp, httpsReq)
	if got := httpsResp.Header().Get("Strict-Transport-Security"); got == "" {
		t.Fatal("expected HSTS header when request is marked as HTTPS")
	}
}

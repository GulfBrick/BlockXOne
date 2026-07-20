package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestRequestValidatorAllowsJSONCharset(t *testing.T) {
	gin.SetMode(gin.TestMode)

	router := gin.New()
	router.Use(RequestID())
	router.Use(RequestValidator(1 << 20))
	router.POST("/submit", func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	req := httptest.NewRequest(http.MethodPost, "/submit", strings.NewReader(`{"ok":true}`))
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	req.Header.Set("X-Request-ID", "req-123")

	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusNoContent {
		t.Fatalf("expected request to pass validation, got %d with body %s", resp.Code, resp.Body.String())
	}
	if got := resp.Header().Get("X-Request-ID"); got != "req-123" {
		t.Fatalf("expected request ID header to round-trip, got %q", got)
	}
}

func TestRequestValidatorRejectsNonJSONContentType(t *testing.T) {
	gin.SetMode(gin.TestMode)

	router := gin.New()
	router.Use(RequestValidator(1 << 20))
	router.POST("/submit", func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	req := httptest.NewRequest(http.MethodPost, "/submit", strings.NewReader("hello"))
	req.Header.Set("Content-Type", "text/plain")

	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusBadRequest {
		t.Fatalf("expected non-JSON request to be rejected, got %d", resp.Code)
	}
}

func TestRequestValidatorAllowsEmptyBodyPost(t *testing.T) {
	gin.SetMode(gin.TestMode)

	router := gin.New()
	router.Use(RequestValidator(1 << 20))
	router.POST("/submit", func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	req := httptest.NewRequest(http.MethodPost, "/submit", nil)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusNoContent {
		t.Fatalf("expected empty-body POST to pass validation, got %d with body %s", resp.Code, resp.Body.String())
	}
}

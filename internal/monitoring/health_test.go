package monitoring

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestCheckChainRPCHealthSuccess(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":"0x89"}`))
	}))
	defer server.Close()

	ok, message := checkChainRPCHealth(context.Background(), server.URL)
	if !ok {
		t.Fatalf("expected chain RPC health check to succeed, got message %q", message)
	}
}

func TestDetailedHealthHandlerDegradesOnChainFailure(t *testing.T) {
	gin.SetMode(gin.TestMode)

	router := gin.New()
	router.GET("/health/detailed", DetailedHealthHandler(nil, "", "", "http://127.0.0.1:1"))

	req := httptest.NewRequest(http.MethodGet, "/health/detailed", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected degraded health check to return 503, got %d", resp.Code)
	}
}

package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"blockxone/internal/app"
	"blockxone/internal/config"

	"github.com/gin-gonic/gin"
)

func TestReleaseOneRouteGuardBlocksBeforeHandler(t *testing.T) {
	gin.SetMode(gin.TestMode)

	for _, tt := range []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/console"},
		{http.MethodGet, "/v1/debug/subscriptions"},
		{http.MethodPost, "/v1/onramp/quote"},
		{http.MethodPost, "/v1/offramp/payout"},
		{http.MethodPost, "/v1/marketplace/match"},
		{http.MethodPost, "/v1/wallets/connect"},
		{http.MethodPost, "/v1/admin/users"},
		{http.MethodDelete, "/v1/admin/users/00000000-0000-0000-0000-000000000000"},
		{http.MethodPost, "/v1/offerings/id/publish"},
		{http.MethodPost, "/v1/payments/notify"},
		{http.MethodPost, "/v1/reconciliation/run"},
		{http.MethodGet, "/v1/statements"},
		{http.MethodPost, "/v1/payouts/execute"},
	} {
		t.Run(tt.method+" "+tt.path, func(t *testing.T) {
			called := false
			r := gin.New()
			r.Use(releaseOneRouteGuard("production"))
			r.Handle(tt.method, tt.path, func(c *gin.Context) {
				called = true
				c.Status(http.StatusNoContent)
			})

			resp := httptest.NewRecorder()
			r.ServeHTTP(resp, httptest.NewRequest(tt.method, tt.path, nil))
			if resp.Code != http.StatusNotFound {
				t.Fatalf("expected 404, got %d: %s", resp.Code, resp.Body.String())
			}
			if called {
				t.Fatal("blocked handler executed")
			}
		})
	}
}

func TestRegisterRoutesAppliesProductionContainmentToRealEndpoints(t *testing.T) {
	gin.SetMode(gin.TestMode)

	r := gin.New()
	RegisterRoutes(r, &app.App{Cfg: config.Config{AppEnv: "production", EnableMarketplace: true}})

	for _, tt := range []struct {
		method string
		path   string
	}{
		{http.MethodPost, "/v1/marketplace/match"},
		{http.MethodPost, "/v1/payments/notify"},
		{http.MethodPost, "/v1/wallets/connect"},
		{http.MethodPost, "/v1/admin/users"},
		{http.MethodDelete, "/v1/admin/users/00000000-0000-0000-0000-000000000000"},
		{http.MethodPost, "/v1/offerings/00000000-0000-0000-0000-000000000000/subscribe"},
		{http.MethodGet, "/v1/debug/subscriptions"},
	} {
		resp := httptest.NewRecorder()
		r.ServeHTTP(resp, httptest.NewRequest(tt.method, tt.path, nil))
		if resp.Code != http.StatusNotFound {
			t.Errorf("%s %s: expected 404, got %d: %s", tt.method, tt.path, resp.Code, resp.Body.String())
		}
	}
}

func TestPublicConsoleRegistrationIsEnvironmentBound(t *testing.T) {
	gin.SetMode(gin.TestMode)

	production := gin.New()
	RegisterPublicRoutesForEnvironment(production, "production")
	called := false
	production.POST("/v1/payments/notify", func(c *gin.Context) {
		called = true
		c.Status(http.StatusNoContent)
	})

	productionResp := httptest.NewRecorder()
	production.ServeHTTP(productionResp, httptest.NewRequest(http.MethodGet, "/console", nil))
	if productionResp.Code != http.StatusNotFound {
		t.Fatalf("production console: expected 404, got %d", productionResp.Code)
	}

	blockedResp := httptest.NewRecorder()
	production.ServeHTTP(blockedResp, httptest.NewRequest(http.MethodPost, "/v1/payments/notify", nil))
	if blockedResp.Code != http.StatusNotFound || called {
		t.Fatalf("production global containment missing: status=%d called=%v", blockedResp.Code, called)
	}

	development := gin.New()
	RegisterPublicRoutesForEnvironment(development, "dev")
	developmentResp := httptest.NewRecorder()
	development.ServeHTTP(developmentResp, httptest.NewRequest(http.MethodGet, "/console", nil))
	if developmentResp.Code != http.StatusOK {
		t.Fatalf("development console: expected 200, got %d", developmentResp.Code)
	}
}

func TestReleaseOneRouteGuardPreservesDevelopment(t *testing.T) {
	gin.SetMode(gin.TestMode)

	called := false
	r := gin.New()
	r.Use(releaseOneRouteGuard("dev"))
	r.POST("/v1/marketplace/match", func(c *gin.Context) {
		called = true
		c.Status(http.StatusNoContent)
	})

	resp := httptest.NewRecorder()
	r.ServeHTTP(resp, httptest.NewRequest(http.MethodPost, "/v1/marketplace/match", nil))
	if resp.Code != http.StatusNoContent || !called {
		t.Fatalf("development behavior changed: status=%d called=%v", resp.Code, called)
	}
}

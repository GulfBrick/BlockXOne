package releasepolicy

import (
	"net/http"
	"testing"
)

func TestProductionBlocksReleaseOneExcludedRoutes(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		method     string
		path       string
		capability Capability
	}{
		{"dev console", http.MethodGet, "/console", CapabilityDevConsole},
		{"dev console child", http.MethodGet, "/console/tools", CapabilityDevConsole},
		{"debug subscriptions", http.MethodGet, "/v1/debug/subscriptions", CapabilityDebugAPI},
		{"onramp quote", http.MethodPost, "/v1/onramp/quote", CapabilityOnRamp},
		{"offramp payout", http.MethodPost, "/v1/offramp/payout", CapabilityOffRamp},
		{"marketplace list", http.MethodGet, "/v1/marketplace/listings", CapabilityMarketplace},
		{"marketplace match", http.MethodPost, "/v1/marketplace/match", CapabilityMarketplace},
		{"public signup", http.MethodPost, "/v1/auth/signup", CapabilityPublicOnboarding},
		{"public wallet onboarding", http.MethodPost, "/v1/wallets/connect", CapabilityPublicOnboarding},
		{"admin user create", http.MethodPost, "/v1/admin/users", CapabilityAdminMutation},
		{"admin user delete", http.MethodDelete, "/v1/admin/users/id", CapabilityAdminMutation},
		{"offering create", http.MethodPost, "/v1/offerings", CapabilityOfferingMutation},
		{"offering edit", http.MethodPut, "/v1/offerings/id", CapabilityOfferingMutation},
		{"offering deploy", http.MethodPost, "/v1/offerings/id/deploy", CapabilityOfferingMutation},
		{"offering publish", http.MethodPost, "/v1/offerings/id/publish", CapabilityOfferingMutation},
		{"offering subscribe", http.MethodPost, "/v1/offerings/id/subscribe", CapabilityOfferingMutation},
		{"kyc submit", http.MethodPost, "/v1/kyc/cases/id/submit", CapabilityKYCMutation},
		{"compliance approve", http.MethodPost, "/v1/compliance/cases/id/approve", CapabilityKYCMutation},
		{"wallet approval", http.MethodPost, "/v1/wallets/id/approve", CapabilityWalletApproval},
		{"payment notification", http.MethodPost, "/v1/payments/notify", CapabilityPaymentNotify},
		{"reconciliation stub", http.MethodPost, "/v1/reconciliation/run", CapabilityReconciliation},
		{"statement stub", http.MethodGet, "/v1/statements", CapabilityStatements},
		{"subscription approval", http.MethodPost, "/v1/subscriptions/id/approve", CapabilitySubscriptionAction},
		{"whitelist execution", http.MethodPost, "/v1/whitelist-requests/id/execute", CapabilityTokenOperation},
		{"mint", http.MethodPost, "/v1/token-batches/mint", CapabilityTokenOperation},
		{"redemption", http.MethodPost, "/v1/redemptions/request", CapabilityCorporateAction},
		{"payout execution", http.MethodPost, "/v1/payouts/execute", CapabilityCorporateAction},
		{"slash normalization", http.MethodPost, "//v1//marketplace//match/", CapabilityMarketplace},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, blocked := BlockedCapability(" production ", tt.method, tt.path)
			if !blocked {
				t.Fatalf("expected %s %s to be blocked", tt.method, tt.path)
			}
			if got != tt.capability {
				t.Fatalf("expected capability %q, got %q", tt.capability, got)
			}
		})
	}
}

func TestProductionAllowsReadOnlyAndImplementedBaseRoutes(t *testing.T) {
	t.Parallel()

	for _, tt := range []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/healthz"},
		{http.MethodGet, "/v1/offerings"},
		{http.MethodGet, "/v1/offerings/id"},
		{http.MethodPost, "/v1/auth/login"},
		{http.MethodGet, "/v1/portfolio"},
	} {
		if capability, blocked := BlockedCapability("production", tt.method, tt.path); blocked {
			t.Errorf("did not expect %s %s to be blocked as %q", tt.method, tt.path, capability)
		}
	}
}

func TestDevelopmentPreservesLocalBehavior(t *testing.T) {
	t.Parallel()

	for _, appEnv := range []string{"dev", "DEV", " dev "} {
		if capability, blocked := BlockedCapability(appEnv, http.MethodPost, "/v1/marketplace/match"); blocked {
			t.Errorf("development route unexpectedly blocked as %q for env %q", capability, appEnv)
		}
	}
}

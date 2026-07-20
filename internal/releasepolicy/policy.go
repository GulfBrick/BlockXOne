package releasepolicy

import (
	"net/http"
	"path"
	"strings"
)

// Capability identifies a production-disabled surface in the release-one
// containment policy. Capabilities are intentionally coarse: later phases may
// replace individual denials with evidence-gated implementations, but Phase 0
// fails closed.
type Capability string

const (
	CapabilityDevConsole         Capability = "dev_console"
	CapabilityDebugAPI           Capability = "debug_api"
	CapabilityOnRamp             Capability = "on_ramp"
	CapabilityOffRamp            Capability = "off_ramp"
	CapabilityMarketplace        Capability = "marketplace"
	CapabilityPublicOnboarding   Capability = "public_onboarding"
	CapabilityAdminMutation      Capability = "admin_mutation"
	CapabilityOfferingMutation   Capability = "offering_mutation"
	CapabilityKYCMutation        Capability = "kyc_mutation"
	CapabilityWalletApproval     Capability = "wallet_approval"
	CapabilityPaymentNotify      Capability = "payment_notify"
	CapabilityReconciliation     Capability = "reconciliation"
	CapabilityStatements         Capability = "statements"
	CapabilitySubscriptionAction Capability = "subscription_action"
	CapabilityTokenOperation     Capability = "token_operation"
	CapabilityCorporateAction    Capability = "corporate_action"
)

// IsProduction reports whether the strict release-one perimeter applies. Other
// runtime validation is responsible for rejecting unknown environment labels.
func IsProduction(appEnv string) bool {
	return strings.EqualFold(strings.TrimSpace(appEnv), "production")
}

// BlockedCapability returns the release-one capability blocked for a request.
// The path is cleaned so duplicate slashes and trailing slashes cannot bypass
// exact checks. Query parameters are not part of URL.Path and cannot affect the
// decision.
func BlockedCapability(appEnv, method, requestPath string) (Capability, bool) {
	if !IsProduction(appEnv) {
		return "", false
	}

	method = strings.ToUpper(strings.TrimSpace(method))
	requestPath = cleanRequestPath(requestPath)

	if requestPath == "/console" || strings.HasPrefix(requestPath, "/console/") {
		return CapabilityDevConsole, true
	}
	if requestPath == "/v1/debug" || strings.HasPrefix(requestPath, "/v1/debug/") {
		return CapabilityDebugAPI, true
	}
	if requestPath == "/v1/onramp" || strings.HasPrefix(requestPath, "/v1/onramp/") {
		return CapabilityOnRamp, true
	}
	if requestPath == "/v1/offramp" || strings.HasPrefix(requestPath, "/v1/offramp/") {
		return CapabilityOffRamp, true
	}
	if requestPath == "/v1/marketplace" || strings.HasPrefix(requestPath, "/v1/marketplace/") {
		return CapabilityMarketplace, true
	}

	// Release one is invite/approval based. The current signup and wallet-connect
	// handlers can create a retail US investor and therefore remain dev-only.
	if method == http.MethodPost && (requestPath == "/v1/auth/signup" || requestPath == "/v1/wallets/connect") {
		return CapabilityPublicOnboarding, true
	}

	// The current administrative user handlers can create accounts and assign
	// privileged roles, including SuperAdmin. Keep every admin mutation outside
	// the production perimeter until privileged-identity workflows have their
	// own authorisation, approval and audit evidence.
	if method != http.MethodGet && (requestPath == "/v1/admin" || strings.HasPrefix(requestPath, "/v1/admin/")) {
		return CapabilityAdminMutation, true
	}

	// Current offering mutation handlers accept arbitrary instruments, chains,
	// currencies and contract addresses. Read-only approved offering discovery
	// remains available; mutations are held until the golden-instrument gate.
	if method != http.MethodGet && (requestPath == "/v1/offerings" || strings.HasPrefix(requestPath, "/v1/offerings/")) {
		return CapabilityOfferingMutation, true
	}

	// KYC and wallet approval currently mutate local workflow state without an
	// authoritative production provider contract.
	if method != http.MethodGet && (requestPath == "/v1/kyc/cases" || strings.HasPrefix(requestPath, "/v1/kyc/cases/") ||
		requestPath == "/v1/compliance/cases" || strings.HasPrefix(requestPath, "/v1/compliance/cases/")) {
		return CapabilityKYCMutation, true
	}
	if method != http.MethodGet && requestPath != "/v1/wallets/connect" &&
		(requestPath == "/v1/wallets" || strings.HasPrefix(requestPath, "/v1/wallets/")) {
		return CapabilityWalletApproval, true
	}

	if method != http.MethodGet && requestPath == "/v1/payments/notify" {
		return CapabilityPaymentNotify, true
	}
	if method != http.MethodGet && requestPath == "/v1/reconciliation/run" {
		return CapabilityReconciliation, true
	}
	if requestPath == "/v1/statements" || strings.HasPrefix(requestPath, "/v1/statements/") {
		return CapabilityStatements, true
	}

	if method != http.MethodGet && (requestPath == "/v1/subscriptions" || strings.HasPrefix(requestPath, "/v1/subscriptions/")) {
		return CapabilitySubscriptionAction, true
	}
	if method != http.MethodGet && (requestPath == "/v1/whitelist-requests" || strings.HasPrefix(requestPath, "/v1/whitelist-requests/") ||
		requestPath == "/v1/token-batches" || strings.HasPrefix(requestPath, "/v1/token-batches/")) {
		return CapabilityTokenOperation, true
	}
	if method != http.MethodGet && (requestPath == "/v1/distributions" || strings.HasPrefix(requestPath, "/v1/distributions/") ||
		requestPath == "/v1/redemptions" || strings.HasPrefix(requestPath, "/v1/redemptions/") ||
		requestPath == "/v1/payouts" || strings.HasPrefix(requestPath, "/v1/payouts/")) {
		return CapabilityCorporateAction, true
	}

	return "", false
}

func cleanRequestPath(requestPath string) string {
	requestPath = strings.TrimSpace(requestPath)
	if requestPath == "" {
		return "/"
	}
	cleaned := path.Clean("/" + strings.TrimPrefix(requestPath, "/"))
	if cleaned == "." {
		return "/"
	}
	return cleaned
}

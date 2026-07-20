package policy

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

// mockPool simulates database responses for policy decision tests.
type mockPool struct {
	latestKYCStatus string
	walletApproved  bool
	queryErr        error

	// New fields for compliance checks
	screening   *ScreeningResult
	profile     *InvestorProfile
	rulesJSON   *OfferingRules
	noProfile   bool // if true, investor_profile query returns pgx.ErrNoRows
	noScreening bool // if true, screening query returns pgx.ErrNoRows
}

func (m *mockPool) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	if strings.Contains(sql, "FROM wallets") {
		return mockRow{value: m.walletApproved, err: m.queryErr}
	}
	if strings.Contains(sql, "FROM screening_results") || strings.Contains(sql, "screening_results") {
		if m.noScreening || m.screening == nil {
			return mockRow{err: pgx.ErrNoRows}
		}
		return mockScreeningRow{sr: m.screening}
	}
	if strings.Contains(sql, "FROM investor_profile") || strings.Contains(sql, "investor_profile") {
		if m.noProfile || m.profile == nil {
			return mockRow{err: pgx.ErrNoRows}
		}
		return mockProfileRow{ip: m.profile}
	}
	if strings.Contains(sql, "rules_json") || strings.Contains(sql, "FROM offerings") {
		if m.rulesJSON == nil {
			raw, _ := json.Marshal(OfferingRules{})
			return mockRow{value: raw, err: m.queryErr}
		}
		raw, _ := json.Marshal(m.rulesJSON)
		return mockRow{value: raw, err: m.queryErr}
	}
	// Default: KYC status
	return mockRow{value: m.latestKYCStatus, err: m.queryErr}
}

type mockRow struct {
	value any
	err   error
}

func (r mockRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	if len(dest) == 0 {
		return nil
	}
	switch ptr := dest[0].(type) {
	case *bool:
		value, _ := r.value.(bool)
		*ptr = value
	case *string:
		value, _ := r.value.(string)
		*ptr = value
	case *[]byte:
		switch v := r.value.(type) {
		case []byte:
			*ptr = v
		case string:
			*ptr = []byte(v)
		}
	}
	return nil
}

type mockScreeningRow struct {
	sr *ScreeningResult
}

func (r mockScreeningRow) Scan(dest ...any) error {
	if len(dest) >= 3 {
		if p, ok := dest[0].(*bool); ok {
			*p = r.sr.PEP
		}
		if p, ok := dest[1].(*bool); ok {
			*p = r.sr.Sanctions
		}
		if p, ok := dest[2].(*int); ok {
			*p = r.sr.Matches
		}
	}
	return nil
}

type mockProfileRow struct {
	ip *InvestorProfile
}

func (r mockProfileRow) Scan(dest ...any) error {
	if len(dest) >= 4 {
		if p, ok := dest[0].(*string); ok {
			*p = r.ip.InvestorStatus
		}
		if p, ok := dest[1].(*bool); ok {
			*p = r.ip.Accredited
		}
		if p, ok := dest[2].(*bool); ok {
			*p = r.ip.Qualified
		}
		if p, ok := dest[3].(*string); ok {
			*p = r.ip.Jurisdiction
		}
	}
	return nil
}

// --- CanSubscribe tests ------------------------------------------------------

func TestCanSubscribe_AllClear(t *testing.T) {
	ctx := context.Background()
	pool := &mockPool{
		latestKYCStatus: "APPROVED",
		walletApproved:  true,
		noScreening:     true,
		noProfile:       true,
	}
	decision, err := CanSubscribe(ctx, pool, "user-123", "offering-1", 137)
	if err != nil {
		t.Fatalf("CanSubscribe failed: %v", err)
	}
	if !decision.Allowed {
		t.Errorf("expected allowed, got reasons: %v", decision.Reasons)
	}
}

func TestCanSubscribe_KYCNotApproved(t *testing.T) {
	ctx := context.Background()
	pool := &mockPool{latestKYCStatus: "REJECTED", walletApproved: true, noScreening: true}
	decision, err := CanSubscribe(ctx, pool, "user-123", "offering-1", 137)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if decision.Allowed {
		t.Error("should not be allowed with rejected KYC")
	}
	assertHasReason(t, decision.Reasons, "KYC not approved")
}

func TestCanSubscribe_WalletNotApproved(t *testing.T) {
	ctx := context.Background()
	pool := &mockPool{latestKYCStatus: "APPROVED", walletApproved: false, noScreening: true}
	decision, err := CanSubscribe(ctx, pool, "user-123", "offering-1", 137)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if decision.Allowed {
		t.Error("should not be allowed without approved wallet")
	}
	assertHasReason(t, decision.Reasons, "No approved wallet for chain")
}

func TestCanSubscribe_SanctionsHit(t *testing.T) {
	ctx := context.Background()
	pool := &mockPool{
		latestKYCStatus: "APPROVED",
		walletApproved:  true,
		screening:       &ScreeningResult{PEP: false, Sanctions: true, Matches: 1},
	}
	decision, err := CanSubscribe(ctx, pool, "user-123", "offering-1", 137)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if decision.Allowed {
		t.Error("should NOT be allowed with sanctions hit")
	}
	assertHasReason(t, decision.Reasons, "Sanctions match detected")
}

func TestCanSubscribe_PEPBlocks(t *testing.T) {
	ctx := context.Background()
	pool := &mockPool{
		latestKYCStatus: "APPROVED",
		walletApproved:  true,
		screening:       &ScreeningResult{PEP: true, Sanctions: false},
	}
	decision, err := CanSubscribe(ctx, pool, "user-123", "offering-1", 137)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if decision.Allowed {
		t.Error("PEP should block subscription pending enhanced due diligence")
	}
	assertHasReason(t, decision.Reasons, "PEP status requires enhanced due diligence")
}

func TestCanSubscribe_AccreditedOnlyBlocked(t *testing.T) {
	ctx := context.Background()
	pool := &mockPool{
		latestKYCStatus: "APPROVED",
		walletApproved:  true,
		noScreening:     true,
		profile:         &InvestorProfile{Accredited: false, Jurisdiction: "ZA"},
		rulesJSON:       &OfferingRules{AccreditedOnly: true},
	}
	decision, err := CanSubscribe(ctx, pool, "user-123", "offering-1", 137)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if decision.Allowed {
		t.Error("non-accredited investor should be blocked on accredited-only offering")
	}
	assertHasReason(t, decision.Reasons, "Offering restricted to accredited investors")
}

func TestCanSubscribe_AccreditedOnlyAllowed(t *testing.T) {
	ctx := context.Background()
	pool := &mockPool{
		latestKYCStatus: "APPROVED",
		walletApproved:  true,
		noScreening:     true,
		profile:         &InvestorProfile{Accredited: true, Jurisdiction: "ZA"},
		rulesJSON:       &OfferingRules{AccreditedOnly: true},
	}
	decision, err := CanSubscribe(ctx, pool, "user-123", "offering-1", 137)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !decision.Allowed {
		t.Errorf("accredited investor should be allowed, got reasons: %v", decision.Reasons)
	}
}

func TestCanSubscribe_JurisdictionBlocked(t *testing.T) {
	ctx := context.Background()
	pool := &mockPool{
		latestKYCStatus: "APPROVED",
		walletApproved:  true,
		noScreening:     true,
		profile:         &InvestorProfile{Accredited: false, Jurisdiction: "US"},
		rulesJSON:       &OfferingRules{AllowedJurisdictions: []string{"ZA", "GB", "DE"}},
	}
	decision, err := CanSubscribe(ctx, pool, "user-123", "offering-1", 137)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if decision.Allowed {
		t.Error("US jurisdiction should be blocked when only ZA/GB/DE allowed")
	}
	assertHasReason(t, decision.Reasons, "Investor jurisdiction not allowed for this offering")
}

func TestCanSubscribe_JurisdictionAllowed(t *testing.T) {
	ctx := context.Background()
	pool := &mockPool{
		latestKYCStatus: "APPROVED",
		walletApproved:  true,
		noScreening:     true,
		profile:         &InvestorProfile{Accredited: false, Jurisdiction: "ZA"},
		rulesJSON:       &OfferingRules{AllowedJurisdictions: []string{"ZA", "GB", "DE"}},
	}
	decision, err := CanSubscribe(ctx, pool, "user-123", "offering-1", 137)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !decision.Allowed {
		t.Errorf("ZA jurisdiction should be allowed, got reasons: %v", decision.Reasons)
	}
}

func TestCanSubscribe_NoProfileWithJurisdictionGate(t *testing.T) {
	ctx := context.Background()
	pool := &mockPool{
		latestKYCStatus: "APPROVED",
		walletApproved:  true,
		noScreening:     true,
		noProfile:       true,
		rulesJSON:       &OfferingRules{AllowedJurisdictions: []string{"ZA"}},
	}
	decision, err := CanSubscribe(ctx, pool, "user-123", "offering-1", 137)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if decision.Allowed {
		t.Error("should block when no investor profile exists but jurisdiction is required")
	}
	assertHasReason(t, decision.Reasons, "Investor jurisdiction not set")
}

func TestCanSubscribe_MultipleFailures(t *testing.T) {
	ctx := context.Background()
	pool := &mockPool{
		latestKYCStatus: "REJECTED",
		walletApproved:  false,
		screening:       &ScreeningResult{PEP: false, Sanctions: true},
		profile:         &InvestorProfile{Accredited: false, Jurisdiction: "US"},
		rulesJSON:       &OfferingRules{AccreditedOnly: true, AllowedJurisdictions: []string{"ZA"}},
	}
	decision, err := CanSubscribe(ctx, pool, "user-123", "offering-1", 137)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if decision.Allowed {
		t.Error("should not be allowed with multiple failures")
	}
	// Should have at least 4 reasons: KYC, wallet, sanctions, accredited, jurisdiction
	if len(decision.Reasons) < 4 {
		t.Errorf("expected at least 4 reasons, got %d: %v", len(decision.Reasons), decision.Reasons)
	}
}

// --- CanTrade tests ----------------------------------------------------------

func TestCanTrade_AllClear(t *testing.T) {
	ctx := context.Background()
	pool := &mockPool{
		latestKYCStatus: "APPROVED",
		walletApproved:  true,
		noScreening:     true,
	}
	decision, err := CanTrade(ctx, pool, "user-456", "offering-1", 137)
	if err != nil {
		t.Fatalf("CanTrade failed: %v", err)
	}
	if !decision.Allowed {
		t.Errorf("should be allowed, got reasons: %v", decision.Reasons)
	}
}

func TestCanTrade_BlockedBySanctions(t *testing.T) {
	ctx := context.Background()
	pool := &mockPool{
		latestKYCStatus: "APPROVED",
		walletApproved:  true,
		screening:       &ScreeningResult{Sanctions: true},
	}
	decision, err := CanTrade(ctx, pool, "user-456", "offering-1", 137)
	if err != nil {
		t.Fatalf("CanTrade failed: %v", err)
	}
	if decision.Allowed {
		t.Error("should NOT be allowed when sanctioned")
	}
}

// --- CanApproveWallet tests --------------------------------------------------

func TestCanApproveWallet_KYCApproved_NoScreening(t *testing.T) {
	ctx := context.Background()
	pool := &mockPool{latestKYCStatus: "APPROVED", noScreening: true}
	decision, err := CanApproveWallet(ctx, pool, "user-111")
	if err != nil {
		t.Fatalf("CanApproveWallet failed: %v", err)
	}
	if !decision.Allowed {
		t.Errorf("expected allowed, got reasons: %v", decision.Reasons)
	}
}

func TestCanApproveWallet_KYCNotApproved(t *testing.T) {
	ctx := context.Background()
	pool := &mockPool{latestKYCStatus: "REJECTED", noScreening: true}
	decision, err := CanApproveWallet(ctx, pool, "user-111")
	if err != nil {
		t.Fatalf("CanApproveWallet failed: %v", err)
	}
	if decision.Allowed {
		t.Error("should not be allowed with rejected KYC")
	}
	assertHasReason(t, decision.Reasons, "KYC not approved")
}

func TestCanApproveWallet_SanctionsBlock(t *testing.T) {
	ctx := context.Background()
	pool := &mockPool{
		latestKYCStatus: "APPROVED",
		screening:       &ScreeningResult{Sanctions: true},
	}
	decision, err := CanApproveWallet(ctx, pool, "user-111")
	if err != nil {
		t.Fatalf("CanApproveWallet failed: %v", err)
	}
	if decision.Allowed {
		t.Error("should not be allowed with sanctions hit")
	}
	assertHasReason(t, decision.Reasons, "Sanctions match detected")
}

// --- Helpers -----------------------------------------------------------------

func assertHasReason(t *testing.T, reasons []string, expected string) {
	t.Helper()
	for _, r := range reasons {
		if r == expected {
			return
		}
	}
	t.Errorf("expected reason %q not found in %v", expected, reasons)
}

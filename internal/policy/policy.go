package policy

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
)

var ErrNotEligible = errors.New("not eligible")

type Decision struct {
	Allowed bool     `json:"allowed"`
	Reasons []string `json:"reasons"`
}

type QueryRower interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// OfferingRules is the typed representation of offerings.rules_json.
// Issuers set these when creating or configuring an offering.
type OfferingRules struct {
	AccreditedOnly       bool     `json:"accredited_only"`
	AllowedJurisdictions []string `json:"allowed_jurisdictions"` // ISO 3166-1 alpha-2 codes; empty = all
	ComplianceRegistry   string   `json:"compliance_registry"`
	MinInvestment        string   `json:"min_investment,omitempty"`
	MaxInvestment        string   `json:"max_investment,omitempty"`
}

// InvestorProfile mirrors the investor_profile table.
type InvestorProfile struct {
	InvestorStatus string `json:"investor_status"`
	Accredited     bool   `json:"accredited_flag"`
	Qualified      bool   `json:"qualified_flag"`
	Jurisdiction   string `json:"jurisdiction"`
}

// ScreeningResult mirrors the latest screening_results for a user.
type ScreeningResult struct {
	PEP       bool `json:"pep"`
	Sanctions bool `json:"sanctions"`
	Matches   int  `json:"matches"`
}

// --- Lookup helpers ----------------------------------------------------------

func latestKYCStatus(ctx context.Context, pool QueryRower, userID string) (string, error) {
	var status string
	row := pool.QueryRow(ctx, `
		SELECT COALESCE((
			SELECT status::text
			FROM kyc_cases
			WHERE user_id=$1 AND status IN ('SUBMITTED','APPROVED','REJECTED')
			ORDER BY COALESCE(submitted_at, updated_at, created_at) DESC, created_at DESC
			LIMIT 1
		), '')
	`, userID)
	if err := row.Scan(&status); err != nil {
		return "", err
	}
	return status, nil
}

func loadInvestorProfile(ctx context.Context, pool QueryRower, userID string) (*InvestorProfile, error) {
	var ip InvestorProfile
	row := pool.QueryRow(ctx, `
		SELECT COALESCE(investor_status, ''), accredited_flag, qualified_flag, COALESCE(jurisdiction, '')
		FROM investor_profile
		WHERE user_id=$1
	`, userID)
	err := row.Scan(&ip.InvestorStatus, &ip.Accredited, &ip.Qualified, &ip.Jurisdiction)
	if err == pgx.ErrNoRows {
		return nil, nil // no profile exists
	}
	if err != nil {
		return nil, err
	}
	return &ip, nil
}

func loadOfferingRules(ctx context.Context, pool QueryRower, offeringID string) (*OfferingRules, error) {
	var raw []byte
	row := pool.QueryRow(ctx, `
		SELECT COALESCE(rules_json, '{}'::jsonb) FROM offerings WHERE id=$1
	`, offeringID)
	if err := row.Scan(&raw); err != nil {
		return nil, err
	}
	var rules OfferingRules
	if err := json.Unmarshal(raw, &rules); err != nil {
		return nil, err
	}
	return &rules, nil
}

func latestScreening(ctx context.Context, pool QueryRower, userID string) (*ScreeningResult, error) {
	var sr ScreeningResult
	row := pool.QueryRow(ctx, `
		SELECT COALESCE(s.pep, false), COALESCE(s.sanctions, false), COALESCE(s.matches, 0)
		FROM screening_results s
		JOIN kyc_cases k ON k.id = s.case_id
		WHERE k.user_id = $1
		ORDER BY s.created_at DESC
		LIMIT 1
	`, userID)
	err := row.Scan(&sr.PEP, &sr.Sanctions, &sr.Matches)
	if err == pgx.ErrNoRows {
		return nil, nil // no screening yet
	}
	if err != nil {
		return nil, err
	}
	return &sr, nil
}

// --- Policy decisions --------------------------------------------------------

// CanSubscribe checks whether a user is eligible to subscribe to a specific
// offering. This is the primary compliance gate and enforces:
//  1. KYC approved
//  2. Approved wallet on the offering's chain
//  3. No sanctions hits
//  4. Accredited investor (if offering requires it)
//  5. Jurisdiction allowed (if offering restricts it)
func CanSubscribe(ctx context.Context, pool QueryRower, userID string, offeringID string, chainID int64) (Decision, error) {
	reasons := []string{}

	// 1. KYC
	kycStatus, err := latestKYCStatus(ctx, pool, userID)
	if err != nil {
		return Decision{}, err
	}
	kycApproved := kycStatus == "APPROVED"
	if !kycApproved {
		reasons = append(reasons, "KYC not approved")
	}

	// 2. Wallet
	var walletApproved bool
	row := pool.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM wallets
			WHERE user_id=$1 AND chain_id=$2 AND status='APPROVED'
		)
	`, userID, chainID)
	if err := row.Scan(&walletApproved); err != nil {
		return Decision{}, err
	}
	if !walletApproved {
		reasons = append(reasons, "No approved wallet for chain")
	}

	// 3. Sanctions screening
	screening, err := latestScreening(ctx, pool, userID)
	if err != nil {
		return Decision{}, err
	}
	if screening != nil && screening.Sanctions {
		reasons = append(reasons, "Sanctions match detected")
	}
	if screening != nil && screening.PEP {
		// PEP status doesn't auto-block but requires enhanced due diligence.
		// For MVP, we flag it as a reason so the issuer can review.
		reasons = append(reasons, "PEP status requires enhanced due diligence")
	}

	// 4 & 5. Offering-level rules (accredited + jurisdiction)
	rules, err := loadOfferingRules(ctx, pool, offeringID)
	if err != nil {
		return Decision{}, err
	}

	profile, err := loadInvestorProfile(ctx, pool, userID)
	if err != nil {
		return Decision{}, err
	}

	// 4. Accredited investor check
	if rules.AccreditedOnly {
		if profile == nil || !profile.Accredited {
			reasons = append(reasons, "Offering restricted to accredited investors")
		}
	}

	// 5. Jurisdiction gating
	if len(rules.AllowedJurisdictions) > 0 {
		if profile == nil || profile.Jurisdiction == "" {
			reasons = append(reasons, "Investor jurisdiction not set")
		} else {
			allowed := false
			for _, j := range rules.AllowedJurisdictions {
				if j == profile.Jurisdiction {
					allowed = true
					break
				}
			}
			if !allowed {
				reasons = append(reasons, "Investor jurisdiction not allowed for this offering")
			}
		}
	}

	// Final decision: ALL checks must pass
	sanctionsClear := screening == nil || !screening.Sanctions
	pepClear := screening == nil || !screening.PEP
	allowed := kycApproved && walletApproved && sanctionsClear && pepClear
	if rules.AccreditedOnly && (profile == nil || !profile.Accredited) {
		allowed = false
	}
	if len(rules.AllowedJurisdictions) > 0 {
		if profile == nil || profile.Jurisdiction == "" {
			allowed = false
		} else {
			jurisdictionOK := false
			for _, j := range rules.AllowedJurisdictions {
				if j == profile.Jurisdiction {
					jurisdictionOK = true
					break
				}
			}
			if !jurisdictionOK {
				allowed = false
			}
		}
	}

	return Decision{Allowed: allowed, Reasons: reasons}, nil
}

// CanTrade checks whether a user can trade tokens on the secondary market
// for a specific offering. Same compliance requirements as subscription.
func CanTrade(ctx context.Context, pool QueryRower, userID string, offeringID string, chainID int64) (Decision, error) {
	return CanSubscribe(ctx, pool, userID, offeringID, chainID)
}

// CanApproveWallet checks whether a user's wallet can be approved.
// Requires KYC approval and clean sanctions screening.
func CanApproveWallet(ctx context.Context, pool QueryRower, userID string) (Decision, error) {
	reasons := []string{}

	kycStatus, err := latestKYCStatus(ctx, pool, userID)
	if err != nil {
		return Decision{}, err
	}
	kycApproved := kycStatus == "APPROVED"
	if !kycApproved {
		reasons = append(reasons, "KYC not approved")
	}

	// Also check sanctions before approving a wallet
	screening, err := latestScreening(ctx, pool, userID)
	if err != nil {
		return Decision{}, err
	}
	sanctionsClear := screening == nil || !screening.Sanctions
	if !sanctionsClear {
		reasons = append(reasons, "Sanctions match detected")
	}

	return Decision{Allowed: kycApproved && sanctionsClear, Reasons: reasons}, nil
}

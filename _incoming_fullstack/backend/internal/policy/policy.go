package policy

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNotEligible = errors.New("not eligible")

type Decision struct {
	Allowed bool     `json:"allowed"`
	Reasons []string `json:"reasons"`
}

func CanSubscribe(ctx context.Context, pool *pgxpool.Pool, userID string, chainID int64) (Decision, error) {
	reasons := []string{}

	// KYC approved?
	var kycApproved bool
	row := pool.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM kyc_cases
			WHERE user_id=$1 AND status='APPROVED'
		)
	`, userID)
	if err := row.Scan(&kycApproved); err != nil {
		return Decision{}, err
	}
	if !kycApproved {
		reasons = append(reasons, "KYC not approved")
	}

	// Wallet approved?
	var walletApproved bool
	row = pool.QueryRow(ctx, `
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

	allowed := kycApproved && walletApproved
	return Decision{Allowed: allowed, Reasons: reasons}, nil
}

func CanTrade(ctx context.Context, pool *pgxpool.Pool, userID string, chainID int64) (Decision, error) {
	// For MVP, reuse subscribe rules.
	return CanSubscribe(ctx, pool, userID, chainID)
}

func CanApproveWallet(ctx context.Context, pool *pgxpool.Pool, userID string) (Decision, error) {
	reasons := []string{}

	var kycApproved bool
	row := pool.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM kyc_cases
			WHERE user_id=$1 AND status='APPROVED'
		)
	`, userID)
	if err := row.Scan(&kycApproved); err != nil {
		return Decision{}, err
	}
	if !kycApproved {
		reasons = append(reasons, "KYC not approved")
	}
	return Decision{Allowed: kycApproved, Reasons: reasons}, nil
}

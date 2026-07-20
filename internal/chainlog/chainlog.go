// Package chainlog provides structured logging of all on-chain operations
// to the chain_operations table for regulatory reporting and auditing.
package chainlog

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Operation types — matches the chain_operations.operation column.
const (
	OpPause               = "PAUSE"
	OpUnpause             = "UNPAUSE"
	OpMint                = "MINT"
	OpBurn                = "BURN"
	OpFreeze              = "FREEZE"
	OpUnfreeze            = "UNFREEZE"
	OpForceTransfer       = "FORCE_TRANSFER"
	OpRecoverTokens       = "RECOVER_TOKENS"
	OpDeployERC3643       = "DEPLOY_ERC3643"
	OpIdentityRegister    = "IDENTITY_REGISTER"
	OpIdentityDelete      = "IDENTITY_DELETE"
	OpComplianceModuleAdd = "COMPLIANCE_MODULE_ADD"
	OpComplianceModuleRem = "COMPLIANCE_MODULE_REMOVE"
	OpDeployLegacy        = "DEPLOY_LEGACY"
	OpWhitelist           = "WHITELIST"
)

// Entry represents a single chain operation log entry.
type Entry struct {
	OfferingID       string
	Operation        string
	TxHash           string
	ActorUserID      string
	TargetAddress    string // primary address (investor, module, etc.)
	SecondaryAddress string // second address (recovery, to-address, etc.)
	Amount           string
	Metadata         map[string]interface{}
	Status           string // CONFIRMED, PENDING, FAILED — defaults to CONFIRMED
}

// Record inserts a chain operation log entry. Returns nil if pool is nil (unit tests).
func Record(ctx context.Context, pool *pgxpool.Pool, e Entry) error {
	if pool == nil {
		return nil
	}

	status := e.Status
	if status == "" {
		status = "CONFIRMED"
	}

	var metaJSON []byte
	if len(e.Metadata) > 0 {
		var err error
		metaJSON, err = json.Marshal(e.Metadata)
		if err != nil {
			return err
		}
	}

	_, err := pool.Exec(ctx, `
		INSERT INTO chain_operations(offering_id, operation, tx_hash, actor_user_id, target_address, secondary_address, amount, metadata, status)
		VALUES($1::uuid, $2, NULLIF($3,''), NULLIF($4,'')::uuid, NULLIF($5,''), NULLIF($6,''), NULLIF($7,''), COALESCE(NULLIF($8,'')::jsonb, '{}'), $9)
	`, e.OfferingID, e.Operation, e.TxHash, e.ActorUserID, e.TargetAddress, e.SecondaryAddress, e.Amount, string(metaJSON), status)
	return err
}

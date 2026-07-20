package chain

// EVM adapter (production-ready implementation) — ERC-3643 aligned.
//
// Key safety properties:
// - Private keys are never held directly — delegated to a Signer interface.
//   Use EnvSigner for dev, KMSSigner for production (HSM-backed).
// - Nonce management is thread-safe via NonceManager to prevent race conditions
//   under concurrent mints/burns/transfers.
// - All operations validate addresses and amounts before submitting on-chain.
// - ABIs match the actual Solidity contracts:
//   BXOSecurityTokenFactory.deployToken, BXOSecurityToken (freeze/unfreeze),
//   IdentityRegistry.registerIdentity, ModularCompliance.addModule.

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"strings"

	"blockxone/internal/config"
	"blockxone/internal/db"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/rs/zerolog/log"
)

type EVMAdapter struct {
	rpcURL  string
	chainID *big.Int
	signer  Signer
	nonces  *NonceManager
	client  *ethclient.Client
	db      *db.DB
	factory common.Address
}

// =============================================================================
// ABIs — matched to actual Solidity contracts
// =============================================================================

// BXOSecurityToken ABI — matches contracts/src/token/BXOSecurityToken.sol
var securityTokenABI = mustParseABI(`[
	{"inputs":[{"internalType":"address","name":"to","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"mint","outputs":[],"stateMutability":"nonpayable","type":"function"},
	{"inputs":[{"internalType":"address","name":"from","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"burn","outputs":[],"stateMutability":"nonpayable","type":"function"},
	{"inputs":[{"internalType":"address[]","name":"recipients","type":"address[]"},{"internalType":"uint256[]","name":"amounts","type":"uint256[]"}],"name":"batchMint","outputs":[],"stateMutability":"nonpayable","type":"function"},
	{"inputs":[{"internalType":"address[]","name":"accounts","type":"address[]"},{"internalType":"uint256[]","name":"amounts","type":"uint256[]"}],"name":"batchBurn","outputs":[],"stateMutability":"nonpayable","type":"function"},
	{"inputs":[{"internalType":"address","name":"account","type":"address"}],"name":"freezeAddress","outputs":[],"stateMutability":"nonpayable","type":"function"},
	{"inputs":[{"internalType":"address","name":"account","type":"address"}],"name":"unfreezeAddress","outputs":[],"stateMutability":"nonpayable","type":"function"},
	{"inputs":[{"internalType":"address[]","name":"accounts","type":"address[]"}],"name":"batchFreezeAddress","outputs":[],"stateMutability":"nonpayable","type":"function"},
	{"inputs":[{"internalType":"address[]","name":"accounts","type":"address[]"}],"name":"batchUnfreezeAddress","outputs":[],"stateMutability":"nonpayable","type":"function"},
	{"inputs":[{"internalType":"address","name":"from","type":"address"},{"internalType":"address","name":"to","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"forcedTransfer","outputs":[],"stateMutability":"nonpayable","type":"function"},
	{"inputs":[{"internalType":"address","name":"lostAddress","type":"address"},{"internalType":"address","name":"recoveryAddress","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"recoveryAddress","outputs":[],"stateMutability":"nonpayable","type":"function"},
	{"inputs":[],"name":"pause","outputs":[],"stateMutability":"nonpayable","type":"function"},
	{"inputs":[],"name":"unpause","outputs":[],"stateMutability":"nonpayable","type":"function"},
	{"inputs":[{"internalType":"address","name":"account","type":"address"}],"name":"isFrozen","outputs":[{"internalType":"bool","name":"isFrozen","type":"bool"}],"stateMutability":"view","type":"function"},
	{"inputs":[{"internalType":"address","name":"identityRegistry_","type":"address"}],"name":"setIdentityRegistry","outputs":[],"stateMutability":"nonpayable","type":"function"},
	{"inputs":[{"internalType":"address","name":"compliance_","type":"address"}],"name":"setCompliance","outputs":[],"stateMutability":"nonpayable","type":"function"}
]`)

// BXOSecurityTokenFactory ABI — matches contracts/src/token/BXOSecurityTokenFactory.sol
var tokenFactoryABI = mustParseABI(`[
	{"inputs":[{"internalType":"string","name":"name","type":"string"},{"internalType":"string","name":"symbol","type":"string"},{"internalType":"uint8","name":"decimals","type":"uint8"},{"internalType":"address","name":"identityRegistry","type":"address"},{"internalType":"address","name":"compliance","type":"address"},{"internalType":"uint256","name":"initialSupply","type":"uint256"}],"name":"deployToken","outputs":[{"internalType":"address","name":"tokenAddress","type":"address"}],"stateMutability":"nonpayable","type":"function"},
	{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"token","type":"address"},{"indexed":false,"internalType":"string","name":"name","type":"string"},{"indexed":false,"internalType":"string","name":"symbol","type":"string"},{"indexed":true,"internalType":"address","name":"identityRegistry","type":"address"},{"indexed":true,"internalType":"address","name":"compliance","type":"address"},{"indexed":false,"internalType":"address","name":"deployer","type":"address"}],"name":"TokenDeployed","type":"event"}
]`)

// IdentityRegistry ABI — matches contracts/src/identity/IdentityRegistry.sol
var identityRegistryABI = mustParseABI(`[
	{"inputs":[{"internalType":"address","name":"investor","type":"address"},{"internalType":"address","name":"identity","type":"address"},{"internalType":"uint16","name":"country","type":"uint16"}],"name":"registerIdentity","outputs":[],"stateMutability":"nonpayable","type":"function"},
	{"inputs":[{"internalType":"address","name":"investor","type":"address"}],"name":"deleteIdentity","outputs":[],"stateMutability":"nonpayable","type":"function"},
	{"inputs":[{"internalType":"address","name":"investor","type":"address"},{"internalType":"uint16","name":"country","type":"uint16"}],"name":"updateCountry","outputs":[],"stateMutability":"nonpayable","type":"function"},
	{"inputs":[{"internalType":"address","name":"investor","type":"address"}],"name":"isVerified","outputs":[{"internalType":"bool","name":"isVerified","type":"bool"}],"stateMutability":"view","type":"function"},
	{"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"contains","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"}
]`)

// ModularCompliance ABI — matches contracts/src/compliance/ModularCompliance.sol
var modularComplianceABI = mustParseABI(`[
	{"inputs":[{"internalType":"address","name":"module","type":"address"}],"name":"addModule","outputs":[],"stateMutability":"nonpayable","type":"function"},
	{"inputs":[{"internalType":"address","name":"moduleAddress","type":"address"}],"name":"removeModule","outputs":[],"stateMutability":"nonpayable","type":"function"},
	{"inputs":[{"internalType":"address","name":"from","type":"address"},{"internalType":"address","name":"to","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"canTransfer","outputs":[{"internalType":"bool","name":"isAllowed","type":"bool"}],"stateMutability":"view","type":"function"},
	{"inputs":[],"name":"getModules","outputs":[{"internalType":"address[]","name":"modules","type":"address[]"}],"stateMutability":"view","type":"function"}
]`)

// =============================================================================
// Constructor
// =============================================================================

// NewEVM creates an EVMAdapter using the configured Signer mode.
// CHAIN_SIGNER controls the signing backend:
//   - "env"  — reads CHAIN_PRIVATE_KEY from environment (dev/testing only)
//   - "kms"  — delegates to AWS/GCP/Azure KMS (production)
//
// If CHAIN_SIGNER is not set, defaults to "env" for backward compatibility.
func NewEVM(cfg config.Config, d *db.DB) (*EVMAdapter, error) {
	if cfg.ChainRPCURL == "" {
		return nil, errors.New("CHAIN_RPC_URL not set")
	}
	if cfg.TokenFactoryAddress == "" {
		return nil, errors.New("TOKEN_FACTORY_ADDRESS not set")
	}
	if !common.IsHexAddress(cfg.TokenFactoryAddress) {
		return nil, errors.New("TOKEN_FACTORY_ADDRESS is invalid")
	}

	client, err := ethclient.Dial(cfg.ChainRPCURL)
	if err != nil {
		return nil, fmt.Errorf("rpc connect failed: %w", err)
	}

	// Build signer based on config
	var signer Signer
	switch cfg.ChainSigner {
	case "kms":
		signer, err = NewKMSSigner(cfg.KMSKeyARN)
		if err != nil {
			client.Close()
			return nil, fmt.Errorf("KMS signer init failed: %w", err)
		}
		log.Info().Str("mode", "kms").Msg("chain signer initialized (KMS)")
	default:
		// "env" or empty — backward compatible
		if cfg.ChainPrivateKey == "" {
			client.Close()
			return nil, errors.New("CHAIN_PRIVATE_KEY not set (required when CHAIN_SIGNER=env)")
		}
		signer, err = NewEnvSigner(cfg.ChainPrivateKey)
		if err != nil {
			client.Close()
			return nil, err
		}
		log.Warn().Str("mode", "env").Msg("chain signer initialized (raw key in env — use CHAIN_SIGNER=kms for production)")
	}

	nm := NewNonceManager(client, signer.Address())

	return &EVMAdapter{
		rpcURL:  cfg.ChainRPCURL,
		chainID: big.NewInt(cfg.ChainID),
		signer:  signer,
		nonces:  nm,
		client:  client,
		db:      d,
		factory: common.HexToAddress(cfg.TokenFactoryAddress),
	}, nil
}

// =============================================================================
// Token deployment — ERC-3643 flow
// =============================================================================

// DeployToken deploys a complete ERC-3643 security token via BXOSecurityTokenFactory.
// Requires pre-deployed IdentityRegistry and ModularCompliance addresses.
// Returns tokenAddress, txHash.
func (e *EVMAdapter) DeployToken(ctx context.Context, req DeployTokenRequest) (string, string, error) {
	if !common.IsHexAddress(req.IdentityRegistry) {
		return "", "", errors.New("invalid identity registry address")
	}
	if !common.IsHexAddress(req.Compliance) {
		return "", "", errors.New("invalid compliance address")
	}
	if req.Name == "" || req.Symbol == "" {
		return "", "", errors.New("token name and symbol required")
	}
	if req.Decimals > 18 {
		return "", "", errors.New("decimals must be <= 18")
	}

	initialSupply := new(big.Int)
	if req.InitialSupply != "" {
		var err error
		initialSupply, err = parseTokenAmount(req.InitialSupply, int(req.Decimals))
		if err != nil {
			return "", "", fmt.Errorf("invalid initial supply: %w", err)
		}
	}

	bound := bind.NewBoundContract(e.factory, tokenFactoryABI, e.client, e.client, e.client)
	transact, err := e.newTransactor(ctx)
	if err != nil {
		return "", "", err
	}

	res, err := bound.Transact(transact, "deployToken",
		req.Name,
		req.Symbol,
		req.Decimals,
		common.HexToAddress(req.IdentityRegistry),
		common.HexToAddress(req.Compliance),
		initialSupply,
	)
	if err != nil {
		e.nonces.Reset()
		return "", "", fmt.Errorf("deployToken tx failed: %w", err)
	}

	receipt, err := bind.WaitMined(ctx, e.client, res)
	if err != nil {
		return "", "", fmt.Errorf("waiting for deployToken receipt: %w", err)
	}

	// Parse TokenDeployed event to get the token address
	for _, lg := range receipt.Logs {
		if lg.Address != e.factory {
			continue
		}
		evt, err := tokenFactoryABI.EventByID(lg.Topics[0])
		if err != nil || evt.Name != "TokenDeployed" {
			continue
		}
		// TokenDeployed: indexed token (topic[1]), indexed identityRegistry (topic[2]), indexed compliance (topic[3])
		if len(lg.Topics) >= 2 {
			tokenAddr := common.HexToAddress(lg.Topics[1].Hex())
			return tokenAddr.Hex(), res.Hash().Hex(), nil
		}
	}

	return "", res.Hash().Hex(), errors.New("TokenDeployed event not found in receipt")
}

// DeployAssetToken is the legacy interface — wraps DeployToken for backward compatibility.
// The identityRegistry and compliance addresses are looked up from the DB's rules_json
// or must be deployed first via the API.
func (e *EVMAdapter) DeployAssetToken(ctx context.Context, offeringID string, name string, symbol string, assetType string, metadataURI string, issuer string) (string, string, string, error) {
	// Look up identity registry and compliance from DB
	irAddr, err := e.identityRegistryForOffering(ctx, offeringID)
	if err != nil {
		return "", "", "", fmt.Errorf("identity registry lookup: %w", err)
	}
	compAddr, err := e.complianceForOffering(ctx, offeringID)
	if err != nil {
		return "", "", "", fmt.Errorf("compliance lookup: %w", err)
	}

	tokenAddr, txHash, err := e.DeployToken(ctx, DeployTokenRequest{
		Name:             name,
		Symbol:           symbol,
		Decimals:         18,
		IdentityRegistry: irAddr.Hex(),
		Compliance:       compAddr.Hex(),
	})
	if err != nil {
		return "", "", "", err
	}

	// Store token address back to DB
	_, dbErr := e.db.Pool.Exec(ctx,
		`UPDATE offerings SET token_contract=$1 WHERE id=$2`,
		tokenAddr, offeringID)
	if dbErr != nil {
		log.Error().Err(dbErr).Str("offering", offeringID).Msg("failed to store token_contract in DB")
	}

	return tokenAddr, compAddr.Hex(), txHash, nil
}

// =============================================================================
// Identity registry operations
// =============================================================================

// RegisterIdentity registers an investor in the offering's IdentityRegistry.
func (e *EVMAdapter) RegisterIdentity(ctx context.Context, offeringID string, investor string, identity string, country uint16) (string, error) {
	if !common.IsHexAddress(investor) {
		return "", errors.New("invalid investor address")
	}
	if !common.IsHexAddress(identity) {
		return "", errors.New("invalid identity contract address")
	}

	registryAddr, err := e.identityRegistryForOffering(ctx, offeringID)
	if err != nil {
		return "", err
	}

	bound := bind.NewBoundContract(registryAddr, identityRegistryABI, e.client, e.client, e.client)
	transact, err := e.newTransactor(ctx)
	if err != nil {
		return "", err
	}

	res, err := bound.Transact(transact, "registerIdentity",
		common.HexToAddress(investor),
		common.HexToAddress(identity),
		country,
	)
	if err != nil {
		e.nonces.Reset()
		return "", fmt.Errorf("registerIdentity failed: %w", err)
	}
	return res.Hash().Hex(), nil
}

// DeleteIdentity removes an investor from the offering's IdentityRegistry.
func (e *EVMAdapter) DeleteIdentity(ctx context.Context, offeringID string, investor string) (string, error) {
	if !common.IsHexAddress(investor) {
		return "", errors.New("invalid investor address")
	}

	registryAddr, err := e.identityRegistryForOffering(ctx, offeringID)
	if err != nil {
		return "", err
	}

	bound := bind.NewBoundContract(registryAddr, identityRegistryABI, e.client, e.client, e.client)
	transact, err := e.newTransactor(ctx)
	if err != nil {
		return "", err
	}

	res, err := bound.Transact(transact, "deleteIdentity", common.HexToAddress(investor))
	if err != nil {
		e.nonces.Reset()
		return "", fmt.Errorf("deleteIdentity failed: %w", err)
	}
	return res.Hash().Hex(), nil
}

// IsIdentityVerified checks if an investor is verified in the IdentityRegistry (read-only call).
func (e *EVMAdapter) IsIdentityVerified(ctx context.Context, offeringID string, investor string) (bool, error) {
	if !common.IsHexAddress(investor) {
		return false, errors.New("invalid investor address")
	}

	registryAddr, err := e.identityRegistryForOffering(ctx, offeringID)
	if err != nil {
		return false, err
	}

	bound := bind.NewBoundContract(registryAddr, identityRegistryABI, e.client, e.client, e.client)
	var result []interface{}
	err = bound.Call(&bind.CallOpts{Context: ctx}, &result, "isVerified", common.HexToAddress(investor))
	if err != nil {
		return false, fmt.Errorf("isVerified call failed: %w", err)
	}
	if len(result) == 0 {
		return false, errors.New("empty result from isVerified")
	}
	verified, ok := result[0].(bool)
	if !ok {
		return false, errors.New("unexpected type from isVerified")
	}
	return verified, nil
}

// =============================================================================
// Compliance operations
// =============================================================================

// AddComplianceModule adds a compliance module to the offering's ModularCompliance.
func (e *EVMAdapter) AddComplianceModule(ctx context.Context, offeringID string, moduleAddress string) (string, error) {
	if !common.IsHexAddress(moduleAddress) {
		return "", errors.New("invalid module address")
	}

	compAddr, err := e.complianceForOffering(ctx, offeringID)
	if err != nil {
		return "", err
	}

	bound := bind.NewBoundContract(compAddr, modularComplianceABI, e.client, e.client, e.client)
	transact, err := e.newTransactor(ctx)
	if err != nil {
		return "", err
	}

	res, err := bound.Transact(transact, "addModule", common.HexToAddress(moduleAddress))
	if err != nil {
		e.nonces.Reset()
		return "", fmt.Errorf("addModule failed: %w", err)
	}
	return res.Hash().Hex(), nil
}

// RemoveComplianceModule removes a compliance module.
func (e *EVMAdapter) RemoveComplianceModule(ctx context.Context, offeringID string, moduleAddress string) (string, error) {
	if !common.IsHexAddress(moduleAddress) {
		return "", errors.New("invalid module address")
	}

	compAddr, err := e.complianceForOffering(ctx, offeringID)
	if err != nil {
		return "", err
	}

	bound := bind.NewBoundContract(compAddr, modularComplianceABI, e.client, e.client, e.client)
	transact, err := e.newTransactor(ctx)
	if err != nil {
		return "", err
	}

	res, err := bound.Transact(transact, "removeModule", common.HexToAddress(moduleAddress))
	if err != nil {
		e.nonces.Reset()
		return "", fmt.Errorf("removeModule failed: %w", err)
	}
	return res.Hash().Hex(), nil
}

// CanTransfer checks if a transfer is allowed by all compliance modules (read-only).
func (e *EVMAdapter) CanTransfer(ctx context.Context, offeringID string, from, to, amount string) (bool, error) {
	if !common.IsHexAddress(from) || !common.IsHexAddress(to) {
		return false, errors.New("invalid from/to address")
	}

	compAddr, err := e.complianceForOffering(ctx, offeringID)
	if err != nil {
		return false, err
	}

	amt, err := parseTokenAmount(amount, 18)
	if err != nil {
		return false, err
	}

	bound := bind.NewBoundContract(compAddr, modularComplianceABI, e.client, e.client, e.client)
	var result []interface{}
	err = bound.Call(&bind.CallOpts{Context: ctx}, &result, "canTransfer",
		common.HexToAddress(from), common.HexToAddress(to), amt)
	if err != nil {
		return false, fmt.Errorf("canTransfer call failed: %w", err)
	}
	if len(result) == 0 {
		return false, errors.New("empty result from canTransfer")
	}
	allowed, ok := result[0].(bool)
	if !ok {
		return false, errors.New("unexpected type from canTransfer")
	}
	return allowed, nil
}

// =============================================================================
// Token lifecycle — Adapter interface methods
// =============================================================================

// Whitelist is now RegisterIdentity (ERC-3643 replaces whitelisting with identity verification).
// This method exists for backward compatibility — it registers the address in the identity registry
// with a placeholder identity contract (zero address) and default country (0).
// For production, use RegisterIdentity directly with a proper identity contract.
func (e *EVMAdapter) Whitelist(ctx context.Context, offeringID string, address string) (string, error) {
	if !common.IsHexAddress(address) {
		return "", errors.New("invalid whitelist address")
	}
	// In ERC-3643, "whitelisting" = registering identity in the IdentityRegistry.
	// We use a placeholder identity and country=0; production should call RegisterIdentity.
	return e.RegisterIdentity(ctx, offeringID, address, address, 0)
}

func (e *EVMAdapter) Mint(ctx context.Context, offeringID string, toAddress string, amount string) (string, error) {
	if !common.IsHexAddress(toAddress) {
		return "", errors.New("invalid mint target address")
	}
	return e.callToken(ctx, offeringID, "mint", common.HexToAddress(toAddress), amount)
}

func (e *EVMAdapter) Burn(ctx context.Context, offeringID string, fromAddress string, amount string) (string, error) {
	if !common.IsHexAddress(fromAddress) {
		return "", errors.New("invalid burn source address")
	}
	return e.callToken(ctx, offeringID, "burn", common.HexToAddress(fromAddress), amount)
}

// Freeze freezes or unfreezes an address. Uses the correct ERC-3643 functions:
// freezeAddress(account) / unfreezeAddress(account) — NOT setFrozen(account, bool).
func (e *EVMAdapter) Freeze(ctx context.Context, offeringID string, address string, freeze bool) (string, error) {
	if !common.IsHexAddress(address) {
		return "", errors.New("invalid freeze target address")
	}

	contractAddr, err := e.tokenAddressForOffering(ctx, offeringID)
	if err != nil {
		return "", err
	}

	bound := bind.NewBoundContract(contractAddr, securityTokenABI, e.client, e.client, e.client)
	transact, err := e.newTransactor(ctx)
	if err != nil {
		return "", err
	}

	method := "unfreezeAddress"
	if freeze {
		method = "freezeAddress"
	}

	res, err := bound.Transact(transact, method, common.HexToAddress(address))
	if err != nil {
		e.nonces.Reset()
		return "", fmt.Errorf("%s failed: %w", method, err)
	}
	return res.Hash().Hex(), nil
}

func (e *EVMAdapter) ForceTransfer(ctx context.Context, offeringID string, fromAddress, toAddress, amount string) (string, error) {
	if !common.IsHexAddress(fromAddress) {
		return "", errors.New("invalid force-transfer source address")
	}
	if !common.IsHexAddress(toAddress) {
		return "", errors.New("invalid force-transfer target address")
	}
	return e.callTokenForceTransfer(ctx, offeringID, common.HexToAddress(fromAddress), common.HexToAddress(toAddress), amount)
}

// Pause pauses all token transfers on the offering's security token.
func (e *EVMAdapter) Pause(ctx context.Context, offeringID string) (string, error) {
	contractAddr, err := e.tokenAddressForOffering(ctx, offeringID)
	if err != nil {
		return "", err
	}

	bound := bind.NewBoundContract(contractAddr, securityTokenABI, e.client, e.client, e.client)
	transact, err := e.newTransactor(ctx)
	if err != nil {
		return "", err
	}

	res, err := bound.Transact(transact, "pause")
	if err != nil {
		e.nonces.Reset()
		return "", fmt.Errorf("pause failed: %w", err)
	}
	return res.Hash().Hex(), nil
}

// Unpause unpauses all token transfers on the offering's security token.
func (e *EVMAdapter) Unpause(ctx context.Context, offeringID string) (string, error) {
	contractAddr, err := e.tokenAddressForOffering(ctx, offeringID)
	if err != nil {
		return "", err
	}

	bound := bind.NewBoundContract(contractAddr, securityTokenABI, e.client, e.client, e.client)
	transact, err := e.newTransactor(ctx)
	if err != nil {
		return "", err
	}

	res, err := bound.Transact(transact, "unpause")
	if err != nil {
		e.nonces.Reset()
		return "", fmt.Errorf("unpause failed: %w", err)
	}
	return res.Hash().Hex(), nil
}

// RecoverTokens recovers tokens from a lost wallet to a new wallet (AGENT_ROLE required on-chain).
func (e *EVMAdapter) RecoverTokens(ctx context.Context, offeringID string, lostAddress, recoveryAddr, amount string) (string, error) {
	if !common.IsHexAddress(lostAddress) {
		return "", errors.New("invalid lost address")
	}
	if !common.IsHexAddress(recoveryAddr) {
		return "", errors.New("invalid recovery address")
	}

	contractAddr, err := e.tokenAddressForOffering(ctx, offeringID)
	if err != nil {
		return "", err
	}

	amt, err := parseTokenAmount(amount, 18)
	if err != nil {
		return "", err
	}

	bound := bind.NewBoundContract(contractAddr, securityTokenABI, e.client, e.client, e.client)
	transact, err := e.newTransactor(ctx)
	if err != nil {
		return "", err
	}

	res, err := bound.Transact(transact, "recoveryAddress",
		common.HexToAddress(lostAddress),
		common.HexToAddress(recoveryAddr),
		amt,
	)
	if err != nil {
		e.nonces.Reset()
		return "", fmt.Errorf("recoveryAddress failed: %w", err)
	}
	return res.Hash().Hex(), nil
}

// IsFrozen checks if an address is frozen (read-only call).
func (e *EVMAdapter) IsFrozen(ctx context.Context, offeringID string, address string) (bool, error) {
	if !common.IsHexAddress(address) {
		return false, errors.New("invalid address")
	}

	contractAddr, err := e.tokenAddressForOffering(ctx, offeringID)
	if err != nil {
		return false, err
	}

	bound := bind.NewBoundContract(contractAddr, securityTokenABI, e.client, e.client, e.client)
	var result []interface{}
	err = bound.Call(&bind.CallOpts{Context: ctx}, &result, "isFrozen", common.HexToAddress(address))
	if err != nil {
		return false, fmt.Errorf("isFrozen call failed: %w", err)
	}
	if len(result) == 0 {
		return false, errors.New("empty result from isFrozen")
	}
	frozen, ok := result[0].(bool)
	if !ok {
		return false, errors.New("unexpected type from isFrozen")
	}
	return frozen, nil
}

// =============================================================================
// Internal helpers
// =============================================================================

func (e *EVMAdapter) callToken(ctx context.Context, offeringID, method string, addr common.Address, amount string) (string, error) {
	contractAddr, err := e.tokenAddressForOffering(ctx, offeringID)
	if err != nil {
		return "", err
	}
	amt, err := parseTokenAmount(amount, 18)
	if err != nil {
		return "", err
	}
	bound := bind.NewBoundContract(contractAddr, securityTokenABI, e.client, e.client, e.client)
	transact, err := e.newTransactor(ctx)
	if err != nil {
		return "", err
	}
	res, err := bound.Transact(transact, method, addr, amt)
	if err != nil {
		e.nonces.Reset()
		return "", fmt.Errorf("%s failed: %w", method, err)
	}
	return res.Hash().Hex(), nil
}

func (e *EVMAdapter) callTokenForceTransfer(ctx context.Context, offeringID string, from, to common.Address, amount string) (string, error) {
	contractAddr, err := e.tokenAddressForOffering(ctx, offeringID)
	if err != nil {
		return "", err
	}
	amt, err := parseTokenAmount(amount, 18)
	if err != nil {
		return "", err
	}
	bound := bind.NewBoundContract(contractAddr, securityTokenABI, e.client, e.client, e.client)
	transact, err := e.newTransactor(ctx)
	if err != nil {
		return "", err
	}
	res, err := bound.Transact(transact, "forcedTransfer", from, to, amt)
	if err != nil {
		e.nonces.Reset()
		return "", fmt.Errorf("forcedTransfer failed: %w", err)
	}
	return res.Hash().Hex(), nil
}

// newTransactor builds TransactOpts using the Signer + NonceManager.
// The private key is never touched here — the Signer handles all signing.
func (e *EVMAdapter) newTransactor(ctx context.Context) (*bind.TransactOpts, error) {
	auth, err := e.signer.TransactOpts(ctx, e.chainID)
	if err != nil {
		return nil, fmt.Errorf("signer.TransactOpts: %w", err)
	}

	nonce, err := e.nonces.Next(ctx)
	if err != nil {
		return nil, fmt.Errorf("nonce manager: %w", err)
	}

	tip, err := e.client.SuggestGasTipCap(ctx)
	if err != nil {
		return nil, err
	}
	feeCap, err := e.client.SuggestGasPrice(ctx)
	if err != nil {
		return nil, err
	}

	auth.Nonce = nonce
	auth.GasTipCap = tip
	auth.GasFeeCap = feeCap
	return auth, nil
}

// =============================================================================
// DB lookups
// =============================================================================

func (e *EVMAdapter) tokenAddressForOffering(ctx context.Context, offeringID string) (common.Address, error) {
	var tokenContract string
	row := e.db.Pool.QueryRow(ctx, `SELECT token_contract FROM offerings WHERE id=$1`, offeringID)
	if err := row.Scan(&tokenContract); err != nil {
		return common.Address{}, err
	}
	if tokenContract == "" {
		return common.Address{}, errors.New("offering missing token_contract")
	}
	if !common.IsHexAddress(tokenContract) {
		return common.Address{}, errors.New("invalid token_contract address")
	}
	return common.HexToAddress(tokenContract), nil
}

func (e *EVMAdapter) identityRegistryForOffering(ctx context.Context, offeringID string) (common.Address, error) {
	var addr string
	row := e.db.Pool.QueryRow(ctx,
		`SELECT COALESCE(identity_registry, '') FROM offerings WHERE id=$1`, offeringID)
	if err := row.Scan(&addr); err != nil {
		return common.Address{}, err
	}
	if addr == "" {
		return common.Address{}, errors.New("offering missing identity_registry — deploy IdentityRegistry first")
	}
	if !common.IsHexAddress(addr) {
		return common.Address{}, errors.New("invalid identity_registry address")
	}
	return common.HexToAddress(addr), nil
}

func (e *EVMAdapter) complianceForOffering(ctx context.Context, offeringID string) (common.Address, error) {
	var addr string
	row := e.db.Pool.QueryRow(ctx,
		`SELECT COALESCE(compliance_contract, '') FROM offerings WHERE id=$1`, offeringID)
	if err := row.Scan(&addr); err != nil {
		return common.Address{}, err
	}
	if addr == "" {
		return common.Address{}, errors.New("offering missing compliance_contract — deploy ModularCompliance first")
	}
	if !common.IsHexAddress(addr) {
		return common.Address{}, errors.New("invalid compliance_contract address")
	}
	return common.HexToAddress(addr), nil
}

// =============================================================================
// Utilities
// =============================================================================

func parseTokenAmount(amount string, decimals int) (*big.Int, error) {
	amount = strings.TrimSpace(amount)
	if amount == "" {
		return nil, errors.New("amount required")
	}
	parts := strings.Split(amount, ".")
	if len(parts) > 2 {
		return nil, errors.New("invalid amount")
	}
	whole := parts[0]
	frac := ""
	if len(parts) == 2 {
		frac = parts[1]
	}
	if len(frac) > decimals {
		return nil, errors.New("amount has too many decimals")
	}
	frac = frac + strings.Repeat("0", decimals-len(frac))
	val := strings.TrimLeft(whole+frac, "0")
	if val == "" {
		val = "0"
	}
	bi, ok := new(big.Int).SetString(val, 10)
	if !ok {
		return nil, errors.New("invalid amount")
	}
	return bi, nil
}

func mustParseABI(data string) abi.ABI {
	parsed, err := abi.JSON(strings.NewReader(data))
	if err != nil {
		panic(err)
	}
	return parsed
}

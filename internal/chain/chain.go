package chain

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"
)

// DeployTokenRequest contains parameters for deploying an ERC-3643 security token
// via BXOSecurityTokenFactory.deployToken.
type DeployTokenRequest struct {
	Name             string // Token name (e.g. "BlockXOne Property Fund A")
	Symbol           string // Token symbol (e.g. "BXPFA")
	Decimals         uint8  // Token decimals (typically 18, max 18)
	IdentityRegistry string // Pre-deployed IdentityRegistry contract address
	Compliance       string // Pre-deployed ModularCompliance contract address
	InitialSupply    string // Initial supply in human-readable form (e.g. "1000000")
}

// Adapter is the blockchain interaction interface.
// All write methods return a transaction hash; read-only methods return their result directly.
type Adapter interface {
	// --- Legacy methods (backward compatible) ---

	// DeployAssetToken deploys a token using legacy parameters (wraps DeployToken internally).
	DeployAssetToken(ctx context.Context, offeringID string, name string, symbol string, assetType string, metadataURI string, issuer string) (tokenAddress string, complianceRegistry string, txHash string, err error)

	// Whitelist registers an address in the identity registry (legacy wrapper for RegisterIdentity).
	Whitelist(ctx context.Context, offeringID string, address string) (txHash string, err error)

	// --- Token lifecycle ---

	// DeployToken deploys a complete ERC-3643 security token via BXOSecurityTokenFactory.
	DeployToken(ctx context.Context, req DeployTokenRequest) (tokenAddress string, txHash string, err error)

	// Mint creates new tokens and sends them to toAddress.
	Mint(ctx context.Context, offeringID string, toAddress string, amount string) (txHash string, err error)

	// Burn destroys tokens from fromAddress.
	Burn(ctx context.Context, offeringID string, fromAddress string, amount string) (txHash string, err error)

	// Freeze freezes (freeze=true) or unfreezes (freeze=false) an address.
	Freeze(ctx context.Context, offeringID string, address string, freeze bool) (txHash string, err error)

	// ForceTransfer moves tokens between addresses without holder approval (regulatory action).
	ForceTransfer(ctx context.Context, offeringID string, fromAddress, toAddress, amount string) (txHash string, err error)

	// Pause halts all token transfers on the offering's security token.
	Pause(ctx context.Context, offeringID string) (txHash string, err error)

	// Unpause resumes token transfers.
	Unpause(ctx context.Context, offeringID string) (txHash string, err error)

	// RecoverTokens recovers tokens from a lost wallet to a recovery address.
	RecoverTokens(ctx context.Context, offeringID string, lostAddress, recoveryAddress, amount string) (txHash string, err error)

	// IsFrozen checks if an address is frozen (read-only).
	IsFrozen(ctx context.Context, offeringID string, address string) (bool, error)

	// --- Identity registry ---

	// RegisterIdentity registers an investor in the offering's IdentityRegistry.
	RegisterIdentity(ctx context.Context, offeringID string, investor string, identity string, country uint16) (txHash string, err error)

	// DeleteIdentity removes an investor from the identity registry.
	DeleteIdentity(ctx context.Context, offeringID string, investor string) (txHash string, err error)

	// IsIdentityVerified checks if an investor is verified (read-only).
	IsIdentityVerified(ctx context.Context, offeringID string, investor string) (bool, error)

	// --- Compliance ---

	// AddComplianceModule adds a compliance module to the offering's ModularCompliance.
	AddComplianceModule(ctx context.Context, offeringID string, moduleAddress string) (txHash string, err error)

	// RemoveComplianceModule removes a compliance module.
	RemoveComplianceModule(ctx context.Context, offeringID string, moduleAddress string) (txHash string, err error)

	// CanTransfer checks if a transfer is allowed by all compliance modules (read-only).
	CanTransfer(ctx context.Context, offeringID string, from, to, amount string) (bool, error)
}

type Mode string

const (
	ModeMock Mode = "mock"
	ModeEVM  Mode = "evm"
)

// =============================================================================
// MockAdapter — deterministic mock for testing
// =============================================================================

type MockAdapter struct {
	// FrozenAddresses tracks frozen state per offering+address for testing.
	FrozenAddresses map[string]bool
	// Identities tracks registered identities per offering+investor for testing.
	Identities map[string]bool
}

func NewMock() *MockAdapter {
	return &MockAdapter{
		FrozenAddresses: make(map[string]bool),
		Identities:      make(map[string]bool),
	}
}

func fakeTx(parts ...string) string {
	h := sha256.Sum256([]byte(fmt.Sprintf("%s|%d|%v", time.Now().UTC().Format(time.RFC3339Nano), time.Now().UnixNano(), parts)))
	return "0x" + hex.EncodeToString(h[:])
}

func fakeAddr(seed string) string {
	h := sha256.Sum256([]byte(seed))
	return "0x" + hex.EncodeToString(h[:20])
}

func identityKey(offeringID, investor string) string {
	return offeringID + "|" + investor
}

// --- Legacy methods ---

func (m *MockAdapter) DeployAssetToken(ctx context.Context, offeringID string, name string, symbol string, assetType string, metadataURI string, issuer string) (string, string, string, error) {
	tokenHash := sha256.Sum256([]byte("token|" + offeringID))
	registryHash := sha256.Sum256([]byte("registry|" + offeringID))
	token := "0x" + hex.EncodeToString(tokenHash[:20])
	registry := "0x" + hex.EncodeToString(registryHash[:20])
	return token, registry, fakeTx("DEPLOY", offeringID, name, symbol, assetType), nil
}

func (m *MockAdapter) Whitelist(ctx context.Context, offeringID string, address string) (string, error) {
	m.Identities[identityKey(offeringID, address)] = true
	return fakeTx("WHITELIST", offeringID, address), nil
}

// --- Token lifecycle ---

func (m *MockAdapter) DeployToken(ctx context.Context, req DeployTokenRequest) (string, string, error) {
	tokenAddr := fakeAddr("token|" + req.Name + "|" + req.Symbol)
	return tokenAddr, fakeTx("DEPLOY_TOKEN", req.Name, req.Symbol), nil
}

func (m *MockAdapter) Mint(ctx context.Context, offeringID string, toAddress string, amount string) (string, error) {
	return fakeTx("MINT", offeringID, toAddress, amount), nil
}

func (m *MockAdapter) Burn(ctx context.Context, offeringID string, fromAddress string, amount string) (string, error) {
	return fakeTx("BURN", offeringID, fromAddress, amount), nil
}

func (m *MockAdapter) Freeze(ctx context.Context, offeringID string, address string, freeze bool) (string, error) {
	m.FrozenAddresses[identityKey(offeringID, address)] = freeze
	return fakeTx("FREEZE", offeringID, address, fmt.Sprintf("%v", freeze)), nil
}

func (m *MockAdapter) ForceTransfer(ctx context.Context, offeringID string, fromAddress, toAddress, amount string) (string, error) {
	return fakeTx("FORCE_TRANSFER", offeringID, fromAddress, toAddress, amount), nil
}

func (m *MockAdapter) Pause(ctx context.Context, offeringID string) (string, error) {
	return fakeTx("PAUSE", offeringID), nil
}

func (m *MockAdapter) Unpause(ctx context.Context, offeringID string) (string, error) {
	return fakeTx("UNPAUSE", offeringID), nil
}

func (m *MockAdapter) RecoverTokens(ctx context.Context, offeringID string, lostAddress, recoveryAddress, amount string) (string, error) {
	return fakeTx("RECOVER", offeringID, lostAddress, recoveryAddress, amount), nil
}

func (m *MockAdapter) IsFrozen(ctx context.Context, offeringID string, address string) (bool, error) {
	frozen, exists := m.FrozenAddresses[identityKey(offeringID, address)]
	if !exists {
		return false, nil
	}
	return frozen, nil
}

// --- Identity registry ---

func (m *MockAdapter) RegisterIdentity(ctx context.Context, offeringID string, investor string, identity string, country uint16) (string, error) {
	m.Identities[identityKey(offeringID, investor)] = true
	return fakeTx("REGISTER_IDENTITY", offeringID, investor, identity, fmt.Sprintf("%d", country)), nil
}

func (m *MockAdapter) DeleteIdentity(ctx context.Context, offeringID string, investor string) (string, error) {
	delete(m.Identities, identityKey(offeringID, investor))
	return fakeTx("DELETE_IDENTITY", offeringID, investor), nil
}

func (m *MockAdapter) IsIdentityVerified(ctx context.Context, offeringID string, investor string) (bool, error) {
	registered, exists := m.Identities[identityKey(offeringID, investor)]
	if !exists {
		return false, nil
	}
	return registered, nil
}

// --- Compliance ---

func (m *MockAdapter) AddComplianceModule(ctx context.Context, offeringID string, moduleAddress string) (string, error) {
	return fakeTx("ADD_MODULE", offeringID, moduleAddress), nil
}

func (m *MockAdapter) RemoveComplianceModule(ctx context.Context, offeringID string, moduleAddress string) (string, error) {
	return fakeTx("REMOVE_MODULE", offeringID, moduleAddress), nil
}

func (m *MockAdapter) CanTransfer(ctx context.Context, offeringID string, from, to, amount string) (bool, error) {
	// Mock always allows transfers if both addresses are registered
	fromRegistered := m.Identities[identityKey(offeringID, from)]
	toRegistered := m.Identities[identityKey(offeringID, to)]
	return fromRegistered && toRegistered, nil
}

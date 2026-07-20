package chain

// Signer abstracts transaction signing so that the EVM adapter never holds
// a raw private key in production.
//
// Implementations:
//   - EnvSigner  — loads key from CHAIN_PRIVATE_KEY env (dev/testing only)
//   - KMSSigner  — delegates to AWS KMS / GCP Cloud KMS / Azure Key Vault
//
// The EVMAdapter accepts a Signer and uses it exclusively for building
// TransactOpts. The private key never leaks outside the signer boundary.

import (
	"context"
	"crypto/ecdsa"
	"errors"
	"fmt"
	"math/big"
	"strings"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
)

// Signer produces a bind.TransactOpts for a given chain without exposing keys.
type Signer interface {
	// Address returns the signer's Ethereum address.
	Address() common.Address

	// TransactOpts returns a ready-to-use TransactOpts bound to this signer.
	// The caller is responsible for setting Nonce, GasTipCap, GasFeeCap after.
	TransactOpts(ctx context.Context, chainID *big.Int) (*bind.TransactOpts, error)

	// Mode returns a human-readable label for logging (never secrets).
	Mode() string
}

// ---------------------------------------------------------------------------
// EnvSigner — development/testing only.
// Loads a raw hex private key. NEVER use in production.
// ---------------------------------------------------------------------------

type EnvSigner struct {
	key  *ecdsa.PrivateKey
	addr common.Address
}

func NewEnvSigner(hexKey string) (*EnvSigner, error) {
	clean := strings.TrimPrefix(strings.TrimSpace(hexKey), "0x")
	if clean == "" {
		return nil, errors.New("CHAIN_PRIVATE_KEY is empty")
	}
	pk, err := crypto.HexToECDSA(clean)
	if err != nil {
		return nil, fmt.Errorf("invalid CHAIN_PRIVATE_KEY: %w", err)
	}
	return &EnvSigner{
		key:  pk,
		addr: crypto.PubkeyToAddress(pk.PublicKey),
	}, nil
}

func (s *EnvSigner) Address() common.Address { return s.addr }
func (s *EnvSigner) Mode() string            { return "env" }

func (s *EnvSigner) TransactOpts(ctx context.Context, chainID *big.Int) (*bind.TransactOpts, error) {
	auth, err := bind.NewKeyedTransactorWithChainID(s.key, chainID)
	if err != nil {
		return nil, err
	}
	auth.Context = ctx
	return auth, nil
}

// ---------------------------------------------------------------------------
// KMSSigner — production stub.
// When you provision AWS KMS / GCP Cloud KMS / Azure Key Vault, implement
// this to sign via the remote HSM. The private key never touches this process.
//
// For AWS KMS: use aws-sdk-go-v2 + kms.Sign with ECDSA_SHA_256 on secp256k1
// For GCP KMS: use cloud.google.com/go/kms/apiv1 with EC_SIGN_SECP256K1_SHA256
// For Azure:   use azkeys with ECDSA256K
// ---------------------------------------------------------------------------

type KMSSigner struct {
	addr common.Address
	// In real implementation, add: kmsClient, keyVersion, etc.
}

func NewKMSSigner(keyARN string) (*KMSSigner, error) {
	if keyARN == "" {
		return nil, errors.New("KMS_KEY_ARN is required for KMS signer")
	}
	// In production: derive the Ethereum address from the KMS public key.
	// For now, return an error indicating the signer is not yet wired.
	return nil, fmt.Errorf("KMS signer not yet implemented — set CHAIN_SIGNER=env for dev, or implement KMS integration for key ARN %s", keyARN)
}

func (s *KMSSigner) Address() common.Address { return s.addr }
func (s *KMSSigner) Mode() string            { return "kms" }

func (s *KMSSigner) TransactOpts(ctx context.Context, chainID *big.Int) (*bind.TransactOpts, error) {
	// In production: call KMS to sign, return custom TransactOpts with
	// a signer function that delegates to KMS.
	return nil, errors.New("KMS TransactOpts not yet implemented")
}

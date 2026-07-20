package chain

// NonceManager provides thread-safe nonce management for EVM transactions.
//
// Without this, concurrent calls to Mint/Burn/Whitelist etc. all call
// PendingNonceAt independently and can get the SAME nonce, causing one
// of the transactions to fail with "nonce too low" or "replacement
// transaction underpriced".
//
// The manager keeps a local counter and increments it atomically.
// If a transaction fails, call Reset() to re-sync from the chain.

import (
	"context"
	"errors"
	"math"
	"math/big"
	"sync"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"
)

type NonceManager struct {
	mu      sync.Mutex
	client  *ethclient.Client
	address common.Address
	current uint64
	synced  bool
}

func NewNonceManager(client *ethclient.Client, address common.Address) *NonceManager {
	return &NonceManager{
		client:  client,
		address: address,
	}
}

// Next returns the next nonce to use, incrementing the internal counter.
// On first call (or after Reset), it syncs from the chain.
func (nm *NonceManager) Next(ctx context.Context) (*big.Int, error) {
	nm.mu.Lock()
	defer nm.mu.Unlock()

	if !nm.synced {
		pending, err := nm.client.PendingNonceAt(ctx, nm.address)
		if err != nil {
			return nil, err
		}
		nm.current = pending
		nm.synced = true
	}

	nonce := nm.current
	if nonce == math.MaxUint64 {
		return nil, errors.New("chain nonce exhausted uint64 range")
	}
	nm.current++
	return new(big.Int).SetUint64(nonce), nil
}

// Reset forces the next call to Next() to re-sync from the chain.
// Call this after a transaction failure to recover from nonce drift.
func (nm *NonceManager) Reset() {
	nm.mu.Lock()
	defer nm.mu.Unlock()
	nm.synced = false
}

// Current returns the current nonce value without incrementing.
func (nm *NonceManager) Current() uint64 {
	nm.mu.Lock()
	defer nm.mu.Unlock()
	return nm.current
}

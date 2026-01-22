package chain

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"
)

type Adapter interface {
	Whitelist(ctx context.Context, offeringID string, address string) (txHash string, err error)
	Mint(ctx context.Context, offeringID string, toAddress string, amount string) (txHash string, err error)
	Burn(ctx context.Context, offeringID string, fromAddress string, amount string) (txHash string, err error)
	Freeze(ctx context.Context, offeringID string, address string, freeze bool) (txHash string, err error)
	ForceTransfer(ctx context.Context, offeringID string, fromAddress, toAddress, amount string) (txHash string, err error)
}

type Mode string

const (
	ModeMock Mode = "mock"
	ModeEVM  Mode = "evm"
)

type MockAdapter struct{}

func NewMock() *MockAdapter { return &MockAdapter{} }

func fakeTx(parts ...string) string {
	h := sha256.Sum256([]byte(fmt.Sprintf("%s|%d|%v", time.Now().UTC().Format(time.RFC3339Nano), time.Now().UnixNano(), parts)))
	return "0x" + hex.EncodeToString(h[:])
}

func (m *MockAdapter) Whitelist(ctx context.Context, offeringID string, address string) (string, error) {
	return fakeTx("WHITELIST", offeringID, address), nil
}

func (m *MockAdapter) Mint(ctx context.Context, offeringID string, toAddress string, amount string) (string, error) {
	return fakeTx("MINT", offeringID, toAddress, amount), nil
}

func (m *MockAdapter) Burn(ctx context.Context, offeringID string, fromAddress string, amount string) (string, error) {
	return fakeTx("BURN", offeringID, fromAddress, amount), nil
}

func (m *MockAdapter) Freeze(ctx context.Context, offeringID string, address string, freeze bool) (string, error) {
	return fakeTx("FREEZE", offeringID, address, fmt.Sprintf("%v", freeze)), nil
}

func (m *MockAdapter) ForceTransfer(ctx context.Context, offeringID string, fromAddress, toAddress, amount string) (string, error) {
	return fakeTx("FORCE_TRANSFER", offeringID, fromAddress, toAddress, amount), nil
}

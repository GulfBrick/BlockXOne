package chain

// EVM adapter stub.
//
// In production, this adapter should:
// - Use a signer held in HSM/KMS/Vault (never raw keys on app servers)
// - Call deployed contracts per offering (token + registry)
// - Confirm tx receipts with retries + nonce management
//
// For MVP, BlockXOne defaults to CHAIN_MODE=mock.

import "context"

type EVMAdapter struct{}

func NewEVM() *EVMAdapter { return &EVMAdapter{} }

func (e *EVMAdapter) Whitelist(ctx context.Context, offeringID string, address string) (string, error) {
	return "", ErrNotImplemented("Whitelist")
}
func (e *EVMAdapter) Mint(ctx context.Context, offeringID string, toAddress string, amount string) (string, error) {
	return "", ErrNotImplemented("Mint")
}
func (e *EVMAdapter) Burn(ctx context.Context, offeringID string, fromAddress string, amount string) (string, error) {
	return "", ErrNotImplemented("Burn")
}
func (e *EVMAdapter) Freeze(ctx context.Context, offeringID string, address string, freeze bool) (string, error) {
	return "", ErrNotImplemented("Freeze")
}
func (e *EVMAdapter) ForceTransfer(ctx context.Context, offeringID string, fromAddress, toAddress, amount string) (string, error) {
	return "", ErrNotImplemented("ForceTransfer")
}

type notImplErr string

func (e notImplErr) Error() string { return string(e) }

func ErrNotImplemented(op string) error {
	return notImplErr("EVM adapter not implemented: " + op)
}

package chain

import (
	"context"
	"math"
	"testing"
)

func TestNonceManagerPreservesUnsignedNonceRange(t *testing.T) {
	nm := &NonceManager{current: math.MaxInt64 + 1, synced: true}

	nonce, err := nm.Next(context.Background())
	if err != nil {
		t.Fatalf("Next returned error: %v", err)
	}
	if nonce.Uint64() != math.MaxInt64+1 || nonce.Sign() < 0 {
		t.Fatalf("nonce lost unsigned range: %s", nonce)
	}
}

func TestNonceManagerRejectsUint64Exhaustion(t *testing.T) {
	nm := &NonceManager{current: math.MaxUint64, synced: true}

	if _, err := nm.Next(context.Background()); err == nil {
		t.Fatal("expected uint64 nonce exhaustion to fail")
	}
	if nm.Current() != math.MaxUint64 {
		t.Fatalf("exhausted nonce must not wrap, got %d", nm.Current())
	}
}

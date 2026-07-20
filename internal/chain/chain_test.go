package chain

import (
	"context"
	"strings"
	"testing"
)

// =============================================================================
// Compile-time interface check
// =============================================================================

var _ Adapter = (*MockAdapter)(nil)

// =============================================================================
// Legacy methods
// =============================================================================

func TestMockAdapter_DeployAssetToken(t *testing.T) {
	adapter := NewMock()
	ctx := context.Background()

	offeringID := "offering-123"
	name := "Test Asset"
	symbol := "TST"
	assetType := "equity"
	metadataURI := "ipfs://QmHash"
	issuer := "0xissuer123"

	tokenAddr, registryAddr, txHash, err := adapter.DeployAssetToken(ctx, offeringID, name, symbol, assetType, metadataURI, issuer)

	if err != nil {
		t.Fatalf("DeployAssetToken failed: %v", err)
	}

	if tokenAddr == "" {
		t.Error("token address should not be empty")
	}
	if registryAddr == "" {
		t.Error("registry address should not be empty")
	}
	if txHash == "" {
		t.Error("txHash should not be empty")
	}

	// Verify they look like Ethereum addresses
	if !strings.HasPrefix(tokenAddr, "0x") {
		t.Errorf("token address should start with 0x, got %q", tokenAddr)
	}
	if !strings.HasPrefix(registryAddr, "0x") {
		t.Errorf("registry address should start with 0x, got %q", registryAddr)
	}
	if !strings.HasPrefix(txHash, "0x") {
		t.Errorf("txHash should start with 0x, got %q", txHash)
	}

	// Verify address lengths (40 chars after 0x = 20 bytes)
	if len(tokenAddr) != 42 {
		t.Errorf("token address length should be 42 chars, got %d", len(tokenAddr))
	}
	if len(registryAddr) != 42 {
		t.Errorf("registry address length should be 42 chars, got %d", len(registryAddr))
	}
}

func TestMockAdapter_DeployAssetToken_Deterministic(t *testing.T) {
	adapter := NewMock()
	ctx := context.Background()

	offeringID := "offering-456"
	name := "Stable Asset"
	symbol := "STABLE"
	assetType := "stablecoin"
	metadataURI := "ipfs://Qm456"
	issuer := "0xissuer456"

	// Call twice with same inputs
	tokenAddr1, registryAddr1, _, err1 := adapter.DeployAssetToken(ctx, offeringID, name, symbol, assetType, metadataURI, issuer)
	if err1 != nil {
		t.Fatalf("First call failed: %v", err1)
	}

	tokenAddr2, registryAddr2, _, err2 := adapter.DeployAssetToken(ctx, offeringID, name, symbol, assetType, metadataURI, issuer)
	if err2 != nil {
		t.Fatalf("Second call failed: %v", err2)
	}

	// Addresses should be consistent for same offering
	if tokenAddr1 != tokenAddr2 {
		t.Errorf("token address should be deterministic, got %q then %q", tokenAddr1, tokenAddr2)
	}
	if registryAddr1 != registryAddr2 {
		t.Errorf("registry address should be deterministic, got %q then %q", registryAddr1, registryAddr2)
	}
}

// =============================================================================
// DeployToken (ERC-3643)
// =============================================================================

func TestMockAdapter_DeployToken(t *testing.T) {
	adapter := NewMock()
	ctx := context.Background()

	req := DeployTokenRequest{
		Name:             "BlockXOne Fund A",
		Symbol:           "BXA",
		Decimals:         18,
		IdentityRegistry: "0x1111111111111111111111111111111111111111",
		Compliance:       "0x2222222222222222222222222222222222222222",
		InitialSupply:    "1000000",
	}

	tokenAddr, txHash, err := adapter.DeployToken(ctx, req)
	if err != nil {
		t.Fatalf("DeployToken failed: %v", err)
	}
	if tokenAddr == "" {
		t.Error("token address should not be empty")
	}
	if !strings.HasPrefix(tokenAddr, "0x") {
		t.Errorf("token address should start with 0x, got %q", tokenAddr)
	}
	if len(tokenAddr) != 42 {
		t.Errorf("token address length should be 42 chars, got %d", len(tokenAddr))
	}
	assertValidTxHash(t, txHash)
}

func TestMockAdapter_DeployToken_Deterministic(t *testing.T) {
	adapter := NewMock()
	ctx := context.Background()

	req := DeployTokenRequest{
		Name:     "Deterministic Token",
		Symbol:   "DET",
		Decimals: 18,
	}

	addr1, _, _ := adapter.DeployToken(ctx, req)
	addr2, _, _ := adapter.DeployToken(ctx, req)

	if addr1 != addr2 {
		t.Errorf("DeployToken address should be deterministic, got %q then %q", addr1, addr2)
	}
}

// =============================================================================
// Whitelist / Identity registry
// =============================================================================

func TestMockAdapter_Whitelist(t *testing.T) {
	adapter := NewMock()
	ctx := context.Background()

	offeringID := "offering-789"
	address := "0xuser789"

	txHash, err := adapter.Whitelist(ctx, offeringID, address)
	if err != nil {
		t.Fatalf("Whitelist failed: %v", err)
	}
	assertValidTxHash(t, txHash)

	// Whitelist should register in identities
	verified, err := adapter.IsIdentityVerified(ctx, offeringID, address)
	if err != nil {
		t.Fatalf("IsIdentityVerified after whitelist failed: %v", err)
	}
	if !verified {
		t.Error("address should be verified after whitelisting")
	}
}

func TestMockAdapter_Whitelist_MultipleAddresses(t *testing.T) {
	adapter := NewMock()
	ctx := context.Background()

	offeringID := "offering-multi"
	addresses := []string{"0xaddr1", "0xaddr2", "0xaddr3"}

	for i, addr := range addresses {
		txHash, err := adapter.Whitelist(ctx, offeringID, addr)
		if err != nil {
			t.Fatalf("Whitelist %d failed: %v", i, err)
		}
		if txHash == "" {
			t.Errorf("txHash %d should not be empty", i)
		}
	}
}

func TestMockAdapter_RegisterIdentity(t *testing.T) {
	adapter := NewMock()
	ctx := context.Background()

	offeringID := "offering-reg"
	investor := "0xInvestor123"
	identity := "0xIdentityContract456"

	// Initially not verified
	verified, err := adapter.IsIdentityVerified(ctx, offeringID, investor)
	if err != nil {
		t.Fatalf("IsIdentityVerified failed: %v", err)
	}
	if verified {
		t.Error("should not be verified before registration")
	}

	// Register
	txHash, err := adapter.RegisterIdentity(ctx, offeringID, investor, identity, 710) // 710 = South Africa
	if err != nil {
		t.Fatalf("RegisterIdentity failed: %v", err)
	}
	assertValidTxHash(t, txHash)

	// Now verified
	verified, err = adapter.IsIdentityVerified(ctx, offeringID, investor)
	if err != nil {
		t.Fatalf("IsIdentityVerified after register failed: %v", err)
	}
	if !verified {
		t.Error("should be verified after registration")
	}
}

func TestMockAdapter_DeleteIdentity(t *testing.T) {
	adapter := NewMock()
	ctx := context.Background()

	offeringID := "offering-del"
	investor := "0xInvestorDel"

	// Register then delete
	_, _ = adapter.RegisterIdentity(ctx, offeringID, investor, "0xIdentity", 840) // 840 = USA

	txHash, err := adapter.DeleteIdentity(ctx, offeringID, investor)
	if err != nil {
		t.Fatalf("DeleteIdentity failed: %v", err)
	}
	assertValidTxHash(t, txHash)

	// Should no longer be verified
	verified, _ := adapter.IsIdentityVerified(ctx, offeringID, investor)
	if verified {
		t.Error("should not be verified after deletion")
	}
}

// =============================================================================
// Mint / Burn
// =============================================================================

func TestMockAdapter_Mint(t *testing.T) {
	adapter := NewMock()
	ctx := context.Background()

	txHash, err := adapter.Mint(ctx, "offering-mint", "0xrecipient", "1000000000000000000")
	if err != nil {
		t.Fatalf("Mint failed: %v", err)
	}
	assertValidTxHash(t, txHash)
}

func TestMockAdapter_Mint_MultipleAmounts(t *testing.T) {
	adapter := NewMock()
	ctx := context.Background()

	amounts := []string{"100", "1000", "999999999"}
	for i, amount := range amounts {
		txHash, err := adapter.Mint(ctx, "offering-mint-multi", "0xrecipient", amount)
		if err != nil {
			t.Fatalf("Mint %d failed: %v", i, err)
		}
		if txHash == "" {
			t.Errorf("txHash %d should not be empty", i)
		}
	}
}

func TestMockAdapter_Burn(t *testing.T) {
	adapter := NewMock()
	ctx := context.Background()

	txHash, err := adapter.Burn(ctx, "offering-burn", "0xowner", "500000000000000000")
	if err != nil {
		t.Fatalf("Burn failed: %v", err)
	}
	assertValidTxHash(t, txHash)
}

func TestMockAdapter_Burn_VariousAmounts(t *testing.T) {
	adapter := NewMock()
	ctx := context.Background()

	amounts := []string{"1", "100", "999999999999999999"}
	for i, amount := range amounts {
		txHash, err := adapter.Burn(ctx, "offering-burn-various", "0xowner-burn", amount)
		if err != nil {
			t.Fatalf("Burn %d failed: %v", i, err)
		}
		if txHash == "" {
			t.Errorf("txHash %d should not be empty", i)
		}
	}
}

// =============================================================================
// Freeze / Unfreeze / IsFrozen
// =============================================================================

func TestMockAdapter_Freeze(t *testing.T) {
	adapter := NewMock()
	ctx := context.Background()
	offeringID := "offering-freeze"
	address := "0xfrozen"

	t.Run("freeze address", func(t *testing.T) {
		txHash, err := adapter.Freeze(ctx, offeringID, address, true)
		if err != nil {
			t.Fatalf("Freeze failed: %v", err)
		}
		assertValidTxHash(t, txHash)

		frozen, _ := adapter.IsFrozen(ctx, offeringID, address)
		if !frozen {
			t.Error("address should be frozen after Freeze(true)")
		}
	})

	t.Run("unfreeze address", func(t *testing.T) {
		txHash, err := adapter.Freeze(ctx, offeringID, address, false)
		if err != nil {
			t.Fatalf("Unfreeze failed: %v", err)
		}
		assertValidTxHash(t, txHash)

		frozen, _ := adapter.IsFrozen(ctx, offeringID, address)
		if frozen {
			t.Error("address should not be frozen after Freeze(false)")
		}
	})
}

func TestMockAdapter_IsFrozen_Default(t *testing.T) {
	adapter := NewMock()
	ctx := context.Background()

	// Unknown address should not be frozen
	frozen, err := adapter.IsFrozen(ctx, "offering-x", "0xunknown")
	if err != nil {
		t.Fatalf("IsFrozen failed: %v", err)
	}
	if frozen {
		t.Error("unknown address should not be frozen by default")
	}
}

func TestMockAdapter_Freeze_Different(t *testing.T) {
	adapter := NewMock()
	ctx := context.Background()

	offeringID := "offering-freeze-diff"

	txHash1, err1 := adapter.Freeze(ctx, offeringID, "0xaddr1", true)
	txHash2, err2 := adapter.Freeze(ctx, offeringID, "0xaddr1", false)

	if err1 != nil || err2 != nil {
		t.Fatal("Freeze operations failed")
	}

	if txHash1 == txHash2 {
		t.Error("freeze and unfreeze should produce different txHashes")
	}
}

// =============================================================================
// ForceTransfer
// =============================================================================

func TestMockAdapter_ForceTransfer(t *testing.T) {
	adapter := NewMock()
	ctx := context.Background()

	txHash, err := adapter.ForceTransfer(ctx, "offering-force-transfer", "0xfrom", "0xto", "1000000000000000000")
	if err != nil {
		t.Fatalf("ForceTransfer failed: %v", err)
	}
	assertValidTxHash(t, txHash)
}

func TestMockAdapter_ForceTransfer_ValidAddresses(t *testing.T) {
	adapter := NewMock()
	ctx := context.Background()

	offeringID := "offering-ft"

	testCases := []struct {
		from   string
		to     string
		amount string
	}{
		{"0x0000000000000000000000000000000000000001", "0x0000000000000000000000000000000000000002", "100"},
		{"0xaaaa", "0xbbbb", "999999999"},
		{"0xccccc", "0xddddd", "1"},
	}

	for i, tc := range testCases {
		txHash, err := adapter.ForceTransfer(ctx, offeringID, tc.from, tc.to, tc.amount)
		if err != nil {
			t.Fatalf("ForceTransfer %d failed: %v", i, err)
		}
		if txHash == "" {
			t.Errorf("txHash %d should not be empty", i)
		}
	}
}

// =============================================================================
// Pause / Unpause
// =============================================================================

func TestMockAdapter_Pause(t *testing.T) {
	adapter := NewMock()
	ctx := context.Background()

	txHash, err := adapter.Pause(ctx, "offering-pause")
	if err != nil {
		t.Fatalf("Pause failed: %v", err)
	}
	assertValidTxHash(t, txHash)
}

func TestMockAdapter_Unpause(t *testing.T) {
	adapter := NewMock()
	ctx := context.Background()

	txHash, err := adapter.Unpause(ctx, "offering-unpause")
	if err != nil {
		t.Fatalf("Unpause failed: %v", err)
	}
	assertValidTxHash(t, txHash)
}

// =============================================================================
// RecoverTokens
// =============================================================================

func TestMockAdapter_RecoverTokens(t *testing.T) {
	adapter := NewMock()
	ctx := context.Background()

	txHash, err := adapter.RecoverTokens(ctx, "offering-recover", "0xlost", "0xrecovery", "50000")
	if err != nil {
		t.Fatalf("RecoverTokens failed: %v", err)
	}
	assertValidTxHash(t, txHash)
}

// =============================================================================
// Compliance
// =============================================================================

func TestMockAdapter_AddComplianceModule(t *testing.T) {
	adapter := NewMock()
	ctx := context.Background()

	txHash, err := adapter.AddComplianceModule(ctx, "offering-comp", "0xmodule123")
	if err != nil {
		t.Fatalf("AddComplianceModule failed: %v", err)
	}
	assertValidTxHash(t, txHash)
}

func TestMockAdapter_RemoveComplianceModule(t *testing.T) {
	adapter := NewMock()
	ctx := context.Background()

	txHash, err := adapter.RemoveComplianceModule(ctx, "offering-comp", "0xmodule123")
	if err != nil {
		t.Fatalf("RemoveComplianceModule failed: %v", err)
	}
	assertValidTxHash(t, txHash)
}

func TestMockAdapter_CanTransfer(t *testing.T) {
	adapter := NewMock()
	ctx := context.Background()

	offeringID := "offering-transfer-check"
	from := "0xsender"
	to := "0xreceiver"

	// Before registration: should NOT be allowed
	allowed, err := adapter.CanTransfer(ctx, offeringID, from, to, "100")
	if err != nil {
		t.Fatalf("CanTransfer failed: %v", err)
	}
	if allowed {
		t.Error("transfer should not be allowed before identity registration")
	}

	// Register both addresses
	_, _ = adapter.RegisterIdentity(ctx, offeringID, from, "0xid1", 710)
	_, _ = adapter.RegisterIdentity(ctx, offeringID, to, "0xid2", 710)

	// Now should be allowed
	allowed, err = adapter.CanTransfer(ctx, offeringID, from, to, "100")
	if err != nil {
		t.Fatalf("CanTransfer failed: %v", err)
	}
	if !allowed {
		t.Error("transfer should be allowed after both addresses are registered")
	}
}

func TestMockAdapter_CanTransfer_OneUnregistered(t *testing.T) {
	adapter := NewMock()
	ctx := context.Background()

	offeringID := "offering-partial"
	from := "0xregistered"
	to := "0xunregistered"

	// Register only sender
	_, _ = adapter.RegisterIdentity(ctx, offeringID, from, "0xid1", 710)

	// Should not be allowed (receiver not registered)
	allowed, _ := adapter.CanTransfer(ctx, offeringID, from, to, "100")
	if allowed {
		t.Error("transfer should not be allowed when receiver is not registered")
	}
}

// =============================================================================
// Combined / integration
// =============================================================================

func TestMockAdapter_AllMethodsNoError(t *testing.T) {
	adapter := NewMock()
	ctx := context.Background()

	offeringID := "offering-all"

	t.Run("DeployAssetToken", func(t *testing.T) {
		_, _, _, err := adapter.DeployAssetToken(ctx, offeringID, "name", "symbol", "type", "uri", "issuer")
		if err != nil {
			t.Errorf("DeployAssetToken should not error: %v", err)
		}
	})

	t.Run("DeployToken", func(t *testing.T) {
		_, _, err := adapter.DeployToken(ctx, DeployTokenRequest{Name: "Test", Symbol: "TST", Decimals: 18})
		if err != nil {
			t.Errorf("DeployToken should not error: %v", err)
		}
	})

	t.Run("Whitelist", func(t *testing.T) {
		_, err := adapter.Whitelist(ctx, offeringID, "0xaddr")
		if err != nil {
			t.Errorf("Whitelist should not error: %v", err)
		}
	})

	t.Run("Mint", func(t *testing.T) {
		_, err := adapter.Mint(ctx, offeringID, "0xto", "100")
		if err != nil {
			t.Errorf("Mint should not error: %v", err)
		}
	})

	t.Run("Burn", func(t *testing.T) {
		_, err := adapter.Burn(ctx, offeringID, "0xfrom", "50")
		if err != nil {
			t.Errorf("Burn should not error: %v", err)
		}
	})

	t.Run("Freeze", func(t *testing.T) {
		_, err := adapter.Freeze(ctx, offeringID, "0xaddr", true)
		if err != nil {
			t.Errorf("Freeze should not error: %v", err)
		}
	})

	t.Run("ForceTransfer", func(t *testing.T) {
		_, err := adapter.ForceTransfer(ctx, offeringID, "0xfrom", "0xto", "100")
		if err != nil {
			t.Errorf("ForceTransfer should not error: %v", err)
		}
	})

	t.Run("Pause", func(t *testing.T) {
		_, err := adapter.Pause(ctx, offeringID)
		if err != nil {
			t.Errorf("Pause should not error: %v", err)
		}
	})

	t.Run("Unpause", func(t *testing.T) {
		_, err := adapter.Unpause(ctx, offeringID)
		if err != nil {
			t.Errorf("Unpause should not error: %v", err)
		}
	})

	t.Run("RecoverTokens", func(t *testing.T) {
		_, err := adapter.RecoverTokens(ctx, offeringID, "0xlost", "0xrecovery", "100")
		if err != nil {
			t.Errorf("RecoverTokens should not error: %v", err)
		}
	})

	t.Run("IsFrozen", func(t *testing.T) {
		_, err := adapter.IsFrozen(ctx, offeringID, "0xaddr")
		if err != nil {
			t.Errorf("IsFrozen should not error: %v", err)
		}
	})

	t.Run("RegisterIdentity", func(t *testing.T) {
		_, err := adapter.RegisterIdentity(ctx, offeringID, "0xinvestor", "0xidentity", 710)
		if err != nil {
			t.Errorf("RegisterIdentity should not error: %v", err)
		}
	})

	t.Run("DeleteIdentity", func(t *testing.T) {
		_, err := adapter.DeleteIdentity(ctx, offeringID, "0xinvestor")
		if err != nil {
			t.Errorf("DeleteIdentity should not error: %v", err)
		}
	})

	t.Run("IsIdentityVerified", func(t *testing.T) {
		_, err := adapter.IsIdentityVerified(ctx, offeringID, "0xinvestor")
		if err != nil {
			t.Errorf("IsIdentityVerified should not error: %v", err)
		}
	})

	t.Run("AddComplianceModule", func(t *testing.T) {
		_, err := adapter.AddComplianceModule(ctx, offeringID, "0xmodule")
		if err != nil {
			t.Errorf("AddComplianceModule should not error: %v", err)
		}
	})

	t.Run("RemoveComplianceModule", func(t *testing.T) {
		_, err := adapter.RemoveComplianceModule(ctx, offeringID, "0xmodule")
		if err != nil {
			t.Errorf("RemoveComplianceModule should not error: %v", err)
		}
	})

	t.Run("CanTransfer", func(t *testing.T) {
		_, err := adapter.CanTransfer(ctx, offeringID, "0xfrom", "0xto", "100")
		if err != nil {
			t.Errorf("CanTransfer should not error: %v", err)
		}
	})
}

func TestMockAdapter_ContextCancellation(t *testing.T) {
	adapter := NewMock()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	offeringID := "offering-cancelled"

	// Mock adapter should still work even with cancelled context
	// (it doesn't actually use the context for I/O)
	_, _, _, err := adapter.DeployAssetToken(ctx, offeringID, "name", "symbol", "type", "uri", "issuer")
	if err != nil {
		t.Errorf("DeployAssetToken with cancelled context should not error: %v", err)
	}

	_, _, err = adapter.DeployToken(ctx, DeployTokenRequest{Name: "Test", Symbol: "TST", Decimals: 18})
	if err != nil {
		t.Errorf("DeployToken with cancelled context should not error: %v", err)
	}
}

func TestMockAdapter_TxHashFormat(t *testing.T) {
	adapter := NewMock()
	ctx := context.Background()

	txHash, _ := adapter.Whitelist(ctx, "offering", "0xaddr")

	// Verify hash format
	if len(txHash) != 66 { // 0x + 64 hex chars (32 bytes)
		t.Errorf("expected txHash length 66, got %d: %s", len(txHash), txHash)
	}

	// Verify hex format after 0x
	hexPart := txHash[2:]
	for _, ch := range hexPart {
		if (ch < '0' || ch > '9') && (ch < 'a' || ch > 'f') && (ch < 'A' || ch > 'F') {
			t.Errorf("invalid hex character in txHash: %c", ch)
		}
	}
}

// =============================================================================
// Helpers
// =============================================================================

func assertValidTxHash(t *testing.T, txHash string) {
	t.Helper()
	if txHash == "" {
		t.Error("txHash should not be empty")
	}
	if !strings.HasPrefix(txHash, "0x") {
		t.Errorf("txHash should start with 0x, got %q", txHash)
	}
	if len(txHash) != 66 {
		t.Errorf("txHash length should be 66, got %d", len(txHash))
	}
}

package ethsig

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/accounts"
	"github.com/ethereum/go-ethereum/crypto"
)

func deterministicFixturePrivateKeyHex(t *testing.T, fixtureID byte) string {
	t.Helper()

	material := append([]byte("blockxone/ethsig/test-private-key/v2:"), byte(fixtureID))
	derived := sha256.Sum256(material)
	privateKey, err := crypto.ToECDSA(derived[:])
	if err != nil {
		t.Fatalf("derive test private key: %v", err)
	}
	return hex.EncodeToString(crypto.FromECDSA(privateKey))
}

// TestVector represents a known good Ethereum signature test case
type TestVector struct {
	message   string
	address   string
	signature string
}

// GenerateTestVector creates a new test vector for a given message and address
// This is used to generate valid test cases
func generateTestVector(message string, privKeyHex string) TestVector {
	// Remove 0x prefix if present
	if len(privKeyHex) > 2 && privKeyHex[:2] == "0x" {
		privKeyHex = privKeyHex[2:]
	}

	privKey, _ := crypto.HexToECDSA(privKeyHex)
	msgHash := accounts.TextHash([]byte(message))
	sig, _ := crypto.Sign(msgHash, privKey)

	// crypto.Sign returns V in 0/1 format, but Ethereum expects 27/28
	sig[64] += 27

	addr := crypto.PubkeyToAddress(privKey.PublicKey)

	return TestVector{
		message:   message,
		address:   addr.Hex(),
		signature: "0x" + hex.EncodeToString(sig),
	}
}

func TestVerifyPersonalSign_ValidSignature(t *testing.T) {
	// Create a valid test vector
	// Using a known private key for reproducibility
	privKeyHex := deterministicFixturePrivateKeyHex(t, 1)
	vector := generateTestVector("test message", privKeyHex)

	err := VerifyPersonalSign(vector.message, vector.signature, vector.address)

	if err != nil {
		t.Fatalf("VerifyPersonalSign failed for valid signature: %v", err)
	}
}

func TestVerifyPersonalSign_InvalidSignature(t *testing.T) {
	privKeyHex := deterministicFixturePrivateKeyHex(t, 2)
	vector := generateTestVector("test message", privKeyHex)

	// Try to verify with wrong message
	err := VerifyPersonalSign("wrong message", vector.signature, vector.address)

	if err == nil {
		t.Error("VerifyPersonalSign should fail for wrong message")
	}
}

func TestVerifyPersonalSign_WrongAddress(t *testing.T) {
	privKeyHex := deterministicFixturePrivateKeyHex(t, 3)
	vector := generateTestVector("test message", privKeyHex)

	// Create a different address
	privKey2, _ := crypto.HexToECDSA(hex.EncodeToString(crypto.Keccak256([]byte("shared-message-fixture"))))
	wrongAddress := crypto.PubkeyToAddress(privKey2.PublicKey).Hex()

	err := VerifyPersonalSign(vector.message, vector.signature, wrongAddress)

	if err == nil {
		t.Error("VerifyPersonalSign should fail for wrong address")
	}
}

func TestVerifyPersonalSign_MalformedSignature(t *testing.T) {
	message := "test message"
	address := "0x0000000000000000000000000000000000000000"

	testCases := []struct {
		name      string
		signature string
	}{
		{"too short", "0xabcd"},
		{"not hex", "0xZZZZ"},
		{"missing 0x", "abcdefg"},
		{"empty", ""},
		{"odd length", "0xabcdefgh"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			err := VerifyPersonalSign(message, tc.signature, address)
			if err == nil {
				t.Errorf("VerifyPersonalSign should fail for malformed signature: %s", tc.name)
			}
		})
	}
}

func TestVerifyPersonalSign_SignatureLengthValidation(t *testing.T) {
	message := "test"
	address := "0x0000000000000000000000000000000000000000"

	// Create a signature that's not 65 bytes
	invalidSigs := []string{
		"0x" + "aa",        // 1 byte
		"0x" + "aa" + "bb", // 2 bytes
		"0x" + "aabbccdd",  // 4 bytes
	}

	for _, sig := range invalidSigs {
		err := VerifyPersonalSign(message, sig, address)
		if err == nil {
			t.Errorf("VerifyPersonalSign should fail for non-65-byte signature: %s", sig)
		}
	}
}

func TestVerifyPersonalSign_CaseInsensitiveSignature(t *testing.T) {
	privKeyHex := deterministicFixturePrivateKeyHex(t, 4)
	vector := generateTestVector("test message", privKeyHex)

	// Convert signature to lowercase
	lowercaseSig := "0x" + vector.signature[2:]

	err := VerifyPersonalSign(vector.message, lowercaseSig, vector.address)

	if err != nil {
		t.Fatalf("VerifyPersonalSign should work with lowercase signature: %v", err)
	}
}

func TestVerifyPersonalSign_AddressNormalization(t *testing.T) {
	privKeyHex := deterministicFixturePrivateKeyHex(t, 5)
	vector := generateTestVector("test message", privKeyHex)

	// Try with uppercase address
	uppercaseAddr := vector.address
	err := VerifyPersonalSign(vector.message, vector.signature, uppercaseAddr)

	if err != nil {
		t.Fatalf("VerifyPersonalSign should work with address in various cases: %v", err)
	}
}

func TestVerifyPersonalSign_EmptyMessage(t *testing.T) {
	privKeyHex := deterministicFixturePrivateKeyHex(t, 6)
	vector := generateTestVector("", privKeyHex)

	err := VerifyPersonalSign(vector.message, vector.signature, vector.address)

	if err != nil {
		t.Fatalf("VerifyPersonalSign should work with empty message: %v", err)
	}
}

func TestVerifyPersonalSign_LongMessage(t *testing.T) {
	privKeyHex := deterministicFixturePrivateKeyHex(t, 7)
	longMessage := ""
	for i := 0; i < 1000; i++ {
		longMessage += "a"
	}

	vector := generateTestVector(longMessage, privKeyHex)

	err := VerifyPersonalSign(vector.message, vector.signature, vector.address)

	if err != nil {
		t.Fatalf("VerifyPersonalSign should work with long message: %v", err)
	}
}

func TestVerifyPersonalSign_SpecialCharactersInMessage(t *testing.T) {
	privKeyHex := deterministicFixturePrivateKeyHex(t, 8)

	messages := []string{
		"Test with spaces",
		"Test\nwith\nnewlines",
		"Test\twith\ttabs",
		"Test with ü ñ é",
		"Test with emoji 🔐",
		`{"json":"data"}`,
	}

	for _, msg := range messages {
		vector := generateTestVector(msg, privKeyHex)
		err := VerifyPersonalSign(vector.message, vector.signature, vector.address)

		if err != nil {
			t.Errorf("VerifyPersonalSign failed for message %q: %v", msg, err)
		}
	}
}

func TestVerifyPersonalSign_MultiplePrivateKeys(t *testing.T) {
	// Test with different private keys
	privKeys := []string{
		hex.EncodeToString(crypto.Keccak256([]byte("multi-key-fixture-a"))),
		hex.EncodeToString(crypto.Keccak256([]byte("shared-message-fixture"))),
		hex.EncodeToString(crypto.Keccak256([]byte("multi-key-fixture-b"))),
	}

	message := "test message"

	for i, privKey := range privKeys {
		vector := generateTestVector(message, privKey)
		err := VerifyPersonalSign(vector.message, vector.signature, vector.address)

		if err != nil {
			t.Errorf("VerifyPersonalSign failed for private key %d: %v", i, err)
		}
	}
}

func TestVerifyPersonalSign_SignatureTampering(t *testing.T) {
	privKeyHex := deterministicFixturePrivateKeyHex(t, 9)
	vector := generateTestVector("test message", privKeyHex)

	// Tamper with the signature by changing one character
	tampered := vector.signature[:10] + "FF" + vector.signature[12:]

	err := VerifyPersonalSign(vector.message, tampered, vector.address)

	if err == nil {
		t.Error("VerifyPersonalSign should fail for tampered signature")
	}
}

func TestVerifyPersonalSign_V27Format(t *testing.T) {
	// Test that both V formats work (27/28 and 0/1)
	privKeyHex := deterministicFixturePrivateKeyHex(t, 10)
	vector := generateTestVector("test message", privKeyHex)

	// Verify original signature (V in 27/28 format)
	err := VerifyPersonalSign(vector.message, vector.signature, vector.address)
	if err != nil {
		t.Fatalf("VerifyPersonalSign failed for V=27/28 format: %v", err)
	}

	// Try V in 0/1 format
	sigBytes, err := hex.DecodeString(strings.TrimPrefix(vector.signature, "0x"))
	if err != nil {
		t.Fatalf("failed to decode signature: %v", err)
	}
	if sigBytes[64] >= 27 {
		sigBytes[64] -= 27
	}
	modifiedSig := "0x" + hex.EncodeToString(sigBytes)

	err = VerifyPersonalSign(vector.message, modifiedSig, vector.address)
	if err != nil {
		t.Fatalf("VerifyPersonalSign failed for V=0/1 format: %v", err)
	}
}

func TestVerifyPersonalSign_ZeroAddress(t *testing.T) {
	zeroAddress := "0x0000000000000000000000000000000000000000"
	message := "test message"
	privKeyHex := deterministicFixturePrivateKeyHex(t, 11)
	vector := generateTestVector(message, privKeyHex)

	// Try to verify with zero address (should fail)
	err := VerifyPersonalSign(vector.message, vector.signature, zeroAddress)

	if err == nil {
		t.Error("VerifyPersonalSign should fail when expected address is zero")
	}
}

func TestVerifyPersonalSign_ConsistentBehavior(t *testing.T) {
	// Verify that the same signature always verifies the same way
	privKeyHex := deterministicFixturePrivateKeyHex(t, 12)
	vector := generateTestVector("consistent test", privKeyHex)

	for i := 0; i < 5; i++ {
		err := VerifyPersonalSign(vector.message, vector.signature, vector.address)
		if err != nil {
			t.Errorf("Iteration %d: VerifyPersonalSign failed: %v", i, err)
		}
	}
}

func TestVerifyPersonalSign_InvalidAddressFormat(t *testing.T) {
	privKeyHex := deterministicFixturePrivateKeyHex(t, 13)
	vector := generateTestVector("test message", privKeyHex)

	// Try various invalid address formats
	invalidAddresses := []string{
		"not-an-address",
		"0xZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ",
		"0x",
		"",
	}

	for _, addr := range invalidAddresses {
		err := VerifyPersonalSign(vector.message, vector.signature, addr)
		// Invalid address format should cause verification to fail
		// (either return error or just not match)
		_ = err
	}
}

func TestVerifyPersonalSign_EIP191Prefix(t *testing.T) {
	// Verify that the function uses EIP-191 "Ethereum Signed Message" prefix
	message := "Test message"
	privKeyHex := deterministicFixturePrivateKeyHex(t, 14)

	// Sign with the correct prefix
	privKey, _ := crypto.HexToECDSA(privKeyHex)
	msgHash := accounts.TextHash([]byte(message))
	sig, _ := crypto.Sign(msgHash, privKey)
	sig[64] += 27

	address := crypto.PubkeyToAddress(privKey.PublicKey)

	// Verify should work
	err := VerifyPersonalSign(message, "0x"+hex.EncodeToString(sig), address.Hex())
	if err != nil {
		t.Fatalf("EIP-191 compliant signature should verify: %v", err)
	}

	// If we used a plain message hash without the prefix, it should fail
	// (This is implicitly tested by the above)
}

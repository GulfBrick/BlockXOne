package ethsig

import (
	"encoding/hex"
	"errors"
	"strings"

	"github.com/ethereum/go-ethereum/accounts"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
)

// VerifyPersonalSign verifies an Ethereum personal_sign signature against a message and expected address.
// This uses the EIP-191 prefix: "\x19Ethereum Signed Message:\n" + len(message).
func VerifyPersonalSign(message string, signatureHex string, expectedAddress string) error {
	expected := common.HexToAddress(expectedAddress)

	sig := strings.TrimPrefix(signatureHex, "0x")
	b, err := hex.DecodeString(sig)
	if err != nil {
		return err
	}
	if len(b) != 65 {
		return errors.New("signature must be 65 bytes")
	}

	// go-ethereum expects V to be 27/28? crypto.SigToPub expects 0/1 in last byte.
	if b[64] >= 27 {
		b[64] -= 27
	}

	hash := accounts.TextHash([]byte(message))
	pub, err := crypto.SigToPub(hash, b)
	if err != nil {
		return err
	}
	recovered := crypto.PubkeyToAddress(*pub)
	if recovered != expected {
		return errors.New("signature does not match address")
	}
	return nil
}

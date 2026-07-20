package custody

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"blockxone/internal/chain"
)

// Provider defines the interface for custody solutions
type Provider interface {
	CreateVault(ctx context.Context, name string) (*Vault, error)
	CreateWallet(ctx context.Context, vaultID, assetID string) (*Wallet, error)
	GetBalance(ctx context.Context, walletID, assetID string) (*Balance, error)
	CreateTransaction(ctx context.Context, req TransactionRequest) (*Transaction, error)
	GetTransaction(ctx context.Context, txID string) (*Transaction, error)
	SignMessage(ctx context.Context, vaultID string, msg []byte) ([]byte, error)
	ListVaults(ctx context.Context) ([]Vault, error)
	SetWebhookURL(ctx context.Context, url string) error
	HandleWebhook(ctx context.Context, payload []byte, signature string) (*WebhookEvent, error)
}

// FireblocksProvider implements Provider for Fireblocks custody
type FireblocksProvider struct {
	apiKey     string
	secretKey  string
	baseURL    string
	httpClient *http.Client
	webhookKey string
}

// NewFireblocksProvider creates a new Fireblocks custody provider
func NewFireblocksProvider(apiKey, secretKey, baseURL, webhookKey string) *FireblocksProvider {
	return &FireblocksProvider{
		apiKey:     apiKey,
		secretKey:  secretKey,
		baseURL:    baseURL,
		webhookKey: webhookKey,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// CreateVault creates a new vault in Fireblocks
func (p *FireblocksProvider) CreateVault(ctx context.Context, name string) (result *Vault, err error) {
	req := map[string]interface{}{
		"name": name,
	}

	payload, _ := json.Marshal(req)
	resp, err := p.doRequest(ctx, "POST", "/v1/vaults", payload)
	if err != nil {
		return nil, err
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			result = nil
			err = errors.Join(err, fmt.Errorf("close Fireblocks create-vault response body: %w", closeErr))
		}
	}()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("fireblocks API error: %d %s", resp.StatusCode, string(body))
	}

	var fbVault struct {
		ID string `json:"id"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&fbVault)

	vault := &Vault{
		ID:        fbVault.ID,
		Name:      name,
		Status:    VaultStatusActive,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	return vault, nil
}

// CreateWallet creates a new wallet in a vault
func (p *FireblocksProvider) CreateWallet(ctx context.Context, vaultID, assetID string) (result *Wallet, err error) {
	req := map[string]interface{}{
		"assetId": assetID,
	}

	payload, _ := json.Marshal(req)
	resp, err := p.doRequest(ctx, "POST", fmt.Sprintf("/v1/vaults/%s/accounts", vaultID), payload)
	if err != nil {
		return nil, err
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			result = nil
			err = errors.Join(err, fmt.Errorf("close Fireblocks create-wallet response body: %w", closeErr))
		}
	}()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("fireblocks API error: %d %s", resp.StatusCode, string(body))
	}

	var fbWallet struct {
		ID      string `json:"id"`
		Address string `json:"address"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&fbWallet)

	wallet := &Wallet{
		ID:        fbWallet.ID,
		VaultID:   vaultID,
		AssetID:   assetID,
		Address:   fbWallet.Address,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	return wallet, nil
}

// GetBalance retrieves the balance of a wallet
func (p *FireblocksProvider) GetBalance(ctx context.Context, walletID, assetID string) (result *Balance, err error) {
	resp, err := p.doRequest(ctx, "GET", fmt.Sprintf("/v1/wallets/%s/assets/%s", walletID, assetID), nil)
	if err != nil {
		return nil, err
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			result = nil
			err = errors.Join(err, fmt.Errorf("close Fireblocks balance response body: %w", closeErr))
		}
	}()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("fireblocks API error: %d %s", resp.StatusCode, string(body))
	}

	var fbBalance struct {
		Balance string `json:"balance"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&fbBalance)

	balance := &Balance{
		WalletID:  walletID,
		AssetID:   assetID,
		Amount:    fbBalance.Balance,
		UpdatedAt: time.Now(),
	}

	return balance, nil
}

// CreateTransaction creates a new transaction
func (p *FireblocksProvider) CreateTransaction(ctx context.Context, req TransactionRequest) (result *Transaction, err error) {
	fbTxReq := map[string]interface{}{
		"assetId": req.AssetID,
		"source": map[string]string{
			"id": req.WalletID,
		},
		"destination": map[string]string{
			"address": req.ToAddress,
		},
		"amount": req.Amount,
	}

	if req.GasPrice != "" {
		fbTxReq["gasPrice"] = req.GasPrice
	}
	if req.GasLimit != "" {
		fbTxReq["gasLimit"] = req.GasLimit
	}

	payload, _ := json.Marshal(fbTxReq)
	resp, err := p.doRequest(ctx, "POST", "/v1/transactions", payload)
	if err != nil {
		return nil, err
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			result = nil
			err = errors.Join(err, fmt.Errorf("close Fireblocks create-transaction response body: %w", closeErr))
		}
	}()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("fireblocks API error: %d %s", resp.StatusCode, string(body))
	}

	var fbTx struct {
		ID string `json:"id"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&fbTx)

	transaction := &Transaction{
		ID:          fbTx.ID,
		VaultID:     req.VaultID,
		WalletID:    req.WalletID,
		AssetID:     req.AssetID,
		Status:      TransactionStatusPending,
		FromAddress: "",
		ToAddress:   req.ToAddress,
		Amount:      req.Amount,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	return transaction, nil
}

// GetTransaction retrieves transaction details
func (p *FireblocksProvider) GetTransaction(ctx context.Context, txID string) (result *Transaction, err error) {
	resp, err := p.doRequest(ctx, "GET", fmt.Sprintf("/v1/transactions/%s", txID), nil)
	if err != nil {
		return nil, err
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			result = nil
			err = errors.Join(err, fmt.Errorf("close Fireblocks get-transaction response body: %w", closeErr))
		}
	}()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("fireblocks API error: %d %s", resp.StatusCode, string(body))
	}

	var fbTx struct {
		ID     string `json:"id"`
		Hash   string `json:"txHash"`
		Status string `json:"status"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&fbTx)

	transaction := &Transaction{
		ID:              fbTx.ID,
		TransactionHash: fbTx.Hash,
		Status:          p.mapFireblocksStatus(fbTx.Status),
		UpdatedAt:       time.Now(),
	}

	return transaction, nil
}

// SignMessage signs a message using a vault key
func (p *FireblocksProvider) SignMessage(ctx context.Context, vaultID string, msg []byte) (result []byte, err error) {
	req := map[string]interface{}{
		"payload": hex.EncodeToString(msg),
	}

	payload, _ := json.Marshal(req)
	resp, err := p.doRequest(ctx, "POST", fmt.Sprintf("/v1/vaults/%s/sign", vaultID), payload)
	if err != nil {
		return nil, err
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			result = nil
			err = errors.Join(err, fmt.Errorf("close Fireblocks sign-message response body: %w", closeErr))
		}
	}()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("fireblocks API error: %d %s", resp.StatusCode, string(body))
	}

	var fbSig struct {
		Signature string `json:"signature"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&fbSig)

	sig, err := hex.DecodeString(fbSig.Signature)
	if err != nil {
		return nil, fmt.Errorf("failed to decode signature: %w", err)
	}

	return sig, nil
}

// ListVaults lists all vaults
func (p *FireblocksProvider) ListVaults(ctx context.Context) (result []Vault, err error) {
	resp, err := p.doRequest(ctx, "GET", "/v1/vaults", nil)
	if err != nil {
		return nil, err
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			result = nil
			err = errors.Join(err, fmt.Errorf("close Fireblocks list-vaults response body: %w", closeErr))
		}
	}()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("fireblocks API error: %d %s", resp.StatusCode, string(body))
	}

	var fbVaults []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&fbVaults)

	vaults := make([]Vault, len(fbVaults))
	for i, fv := range fbVaults {
		vaults[i] = Vault{
			ID:        fv.ID,
			Name:      fv.Name,
			Status:    VaultStatusActive,
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		}
	}

	return vaults, nil
}

// SetWebhookURL sets the webhook URL for notifications
func (p *FireblocksProvider) SetWebhookURL(ctx context.Context, url string) (err error) {
	req := map[string]interface{}{
		"webhookUrl": url,
	}

	payload, _ := json.Marshal(req)
	resp, err := p.doRequest(ctx, "POST", "/v1/webhooks", payload)
	if err != nil {
		return err
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			err = errors.Join(err, fmt.Errorf("close Fireblocks webhook response body: %w", closeErr))
		}
	}()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("fireblocks API error: %d %s", resp.StatusCode, string(body))
	}

	return nil
}

// HandleWebhook processes webhook events from Fireblocks
func (p *FireblocksProvider) HandleWebhook(ctx context.Context, payload []byte, signature string) (*WebhookEvent, error) {
	// Verify HMAC signature
	if !p.verifySignature(payload, signature) {
		return nil, fmt.Errorf("invalid webhook signature")
	}

	var fbEvent struct {
		Type      string `json:"type"`
		VaultID   string `json:"vaultId"`
		WalletID  string `json:"walletId"`
		TxID      string `json:"txId"`
		Status    string `json:"status"`
		Timestamp int64  `json:"timestamp"`
	}
	if err := json.Unmarshal(payload, &fbEvent); err != nil {
		return nil, fmt.Errorf("failed to unmarshal webhook payload: %w", err)
	}

	event := &WebhookEvent{
		Type:          fbEvent.Type,
		VaultID:       fbEvent.VaultID,
		WalletID:      fbEvent.WalletID,
		TransactionID: fbEvent.TxID,
		Status:        fbEvent.Status,
		Timestamp:     time.UnixMilli(fbEvent.Timestamp),
		Data: map[string]interface{}{
			"payload": fbEvent,
		},
	}

	return event, nil
}

// Helper methods

func (p *FireblocksProvider) doRequest(ctx context.Context, method, path string, body []byte) (*http.Response, error) {
	url := p.baseURL + path

	req, err := http.NewRequestWithContext(ctx, method, url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	if body != nil {
		req.Body = io.NopCloser(io.Reader(bytes.NewReader(body)))
		req.Header.Set("Content-Type", "application/json")
	}

	req.Header.Set("X-API-Key", p.apiKey)

	resp, err := p.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}

	return resp, nil
}

func (p *FireblocksProvider) verifySignature(payload []byte, signature string) bool {
	h := hmac.New(sha256.New, []byte(p.webhookKey))
	h.Write(payload)
	expectedSig := hex.EncodeToString(h.Sum(nil))
	return hmac.Equal([]byte(expectedSig), []byte(signature))
}

func (p *FireblocksProvider) mapFireblocksStatus(fbStatus string) TransactionStatus {
	switch fbStatus {
	case "SUBMITTED":
		return TransactionStatusSubmitted
	case "PENDING_SIGNATURE":
		return TransactionStatusPending
	case "SIGNED":
		return TransactionStatusBroadcast
	case "BROADCASTED":
		return TransactionStatusBroadcast
	case "CONFIRMED":
		return TransactionStatusConfirmed
	case "FAILED":
		return TransactionStatusFailed
	case "REJECTED":
		return TransactionStatusRejected
	default:
		return TransactionStatusPending
	}
}

// SelfCustodyProvider implements Provider using the existing chain adapter for self-custody
type SelfCustodyProvider struct {
	vaults   map[string]*Vault
	wallets  map[string]*Wallet
	balances map[string]*Balance
	txs      map[string]*Transaction
	adapter  chain.Adapter
	chainID  int64
}

// NewSelfCustodyProvider creates a new self-custody provider
func NewSelfCustodyProvider(adapter chain.Adapter, chainID int64) *SelfCustodyProvider {
	return &SelfCustodyProvider{
		vaults:   make(map[string]*Vault),
		wallets:  make(map[string]*Wallet),
		balances: make(map[string]*Balance),
		txs:      make(map[string]*Transaction),
		adapter:  adapter,
		chainID:  chainID,
	}
}

func (s *SelfCustodyProvider) CreateVault(ctx context.Context, name string) (*Vault, error) {
	vaultID := fmt.Sprintf("self_vault_%d", time.Now().UnixNano())
	vault := &Vault{
		ID:        vaultID,
		Name:      name,
		Status:    VaultStatusActive,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	s.vaults[vaultID] = vault
	return vault, nil
}

func (s *SelfCustodyProvider) CreateWallet(ctx context.Context, vaultID, assetID string) (*Wallet, error) {
	if _, ok := s.vaults[vaultID]; !ok {
		return nil, fmt.Errorf("vault not found: %s", vaultID)
	}

	walletID := fmt.Sprintf("self_wallet_%d", time.Now().UnixNano())
	wallet := &Wallet{
		ID:        walletID,
		VaultID:   vaultID,
		AssetID:   assetID,
		ChainID:   s.chainID,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	s.wallets[walletID] = wallet
	return wallet, nil
}

func (s *SelfCustodyProvider) GetBalance(ctx context.Context, walletID, assetID string) (*Balance, error) {
	if bal, ok := s.balances[walletID+":"+assetID]; ok {
		return bal, nil
	}

	balance := &Balance{
		WalletID:  walletID,
		AssetID:   assetID,
		Amount:    "0",
		UpdatedAt: time.Now(),
	}
	return balance, nil
}

func (s *SelfCustodyProvider) CreateTransaction(ctx context.Context, req TransactionRequest) (*Transaction, error) {
	if _, ok := s.wallets[req.WalletID]; !ok {
		return nil, fmt.Errorf("wallet not found: %s", req.WalletID)
	}

	// Use chain adapter to mint tokens (simplified model)
	txHash, err := s.adapter.Mint(ctx, req.AssetID, req.ToAddress, req.Amount)
	if err != nil {
		return nil, fmt.Errorf("failed to mint tokens: %w", err)
	}

	tx := &Transaction{
		ID:              fmt.Sprintf("self_tx_%d", time.Now().UnixNano()),
		VaultID:         req.VaultID,
		WalletID:        req.WalletID,
		AssetID:         req.AssetID,
		TransactionHash: txHash,
		Status:          TransactionStatusConfirmed,
		ToAddress:       req.ToAddress,
		Amount:          req.Amount,
		ChainID:         s.chainID,
		CreatedAt:       time.Now(),
		UpdatedAt:       time.Now(),
	}

	s.txs[tx.ID] = tx
	return tx, nil
}

func (s *SelfCustodyProvider) GetTransaction(ctx context.Context, txID string) (*Transaction, error) {
	if tx, ok := s.txs[txID]; ok {
		return tx, nil
	}
	return nil, fmt.Errorf("transaction not found: %s", txID)
}

func (s *SelfCustodyProvider) SignMessage(ctx context.Context, vaultID string, msg []byte) ([]byte, error) {
	// Simplified: return a mock signature
	h := sha256.Sum256(msg)
	return h[:], nil
}

func (s *SelfCustodyProvider) ListVaults(ctx context.Context) ([]Vault, error) {
	vaults := make([]Vault, 0, len(s.vaults))
	for _, v := range s.vaults {
		vaults = append(vaults, *v)
	}
	return vaults, nil
}

func (s *SelfCustodyProvider) SetWebhookURL(ctx context.Context, url string) error {
	// No-op for self custody
	return nil
}

func (s *SelfCustodyProvider) HandleWebhook(ctx context.Context, payload []byte, signature string) (*WebhookEvent, error) {
	// Parse webhook event
	var event WebhookEvent
	if err := json.Unmarshal(payload, &event); err != nil {
		return nil, err
	}
	event.Timestamp = time.Now()
	return &event, nil
}

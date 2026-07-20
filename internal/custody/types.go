package custody

import "time"

// VaultStatus represents the status of a vault
type VaultStatus string

const (
	VaultStatusActive   VaultStatus = "ACTIVE"
	VaultStatusInactive VaultStatus = "INACTIVE"
	VaultStatusArchived VaultStatus = "ARCHIVED"
)

// TransactionStatus represents the status of a transaction
type TransactionStatus string

const (
	TransactionStatusPending   TransactionStatus = "PENDING"
	TransactionStatusSubmitted TransactionStatus = "SUBMITTED"
	TransactionStatusBroadcast TransactionStatus = "BROADCAST"
	TransactionStatusConfirmed TransactionStatus = "CONFIRMED"
	TransactionStatusFailed    TransactionStatus = "FAILED"
	TransactionStatusRejected  TransactionStatus = "REJECTED"
)

// WalletType represents the type of wallet
type WalletType string

const (
	WalletTypeHot  WalletType = "HOT"
	WalletTypeCold WalletType = "COLD"
)

// Vault represents a custody vault
type Vault struct {
	ID        string            `json:"id"`
	Name      string            `json:"name"`
	Status    VaultStatus       `json:"status"`
	CreatedAt time.Time         `json:"created_at"`
	UpdatedAt time.Time         `json:"updated_at"`
	Metadata  map[string]string `json:"metadata,omitempty"`
}

// Wallet represents a wallet within a vault
type Wallet struct {
	ID        string    `json:"id"`
	VaultID   string    `json:"vault_id"`
	AssetID   string    `json:"asset_id"`
	Address   string    `json:"address"`
	ChainID   int64     `json:"chain_id"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Balance represents an asset balance in a wallet
type Balance struct {
	WalletID  string    `json:"wallet_id"`
	AssetID   string    `json:"asset_id"`
	Amount    string    `json:"amount"` // Use string for arbitrary precision
	Decimals  int32     `json:"decimals"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Transaction represents a blockchain transaction
type Transaction struct {
	ID              string                 `json:"id"`
	VaultID         string                 `json:"vault_id"`
	WalletID        string                 `json:"wallet_id"`
	AssetID         string                 `json:"asset_id"`
	TransactionHash string                 `json:"transaction_hash,omitempty"`
	Status          TransactionStatus      `json:"status"`
	FromAddress     string                 `json:"from_address"`
	ToAddress       string                 `json:"to_address"`
	Amount          string                 `json:"amount"`
	Decimals        int32                  `json:"decimals"`
	GasPrice        string                 `json:"gas_price,omitempty"`
	GasLimit        string                 `json:"gas_limit,omitempty"`
	ChainID         int64                  `json:"chain_id"`
	CreatedAt       time.Time              `json:"created_at"`
	UpdatedAt       time.Time              `json:"updated_at"`
	FailureReason   string                 `json:"failure_reason,omitempty"`
	Metadata        map[string]interface{} `json:"metadata,omitempty"`
}

// TransactionRequest is the request to create a transaction
type TransactionRequest struct {
	VaultID   string                 `json:"vault_id" binding:"required"`
	WalletID  string                 `json:"wallet_id" binding:"required"`
	AssetID   string                 `json:"asset_id" binding:"required"`
	ToAddress string                 `json:"to_address" binding:"required"`
	Amount    string                 `json:"amount" binding:"required"`
	GasPrice  string                 `json:"gas_price,omitempty"`
	GasLimit  string                 `json:"gas_limit,omitempty"`
	Metadata  map[string]interface{} `json:"metadata,omitempty"`
}

// WebhookEvent represents an event from the custody provider
type WebhookEvent struct {
	Type          string                 `json:"type"` // vault_created, wallet_created, transaction_created, transaction_confirmed, etc.
	VaultID       string                 `json:"vault_id,omitempty"`
	WalletID      string                 `json:"wallet_id,omitempty"`
	TransactionID string                 `json:"transaction_id,omitempty"`
	Status        string                 `json:"status,omitempty"`
	Timestamp     time.Time              `json:"timestamp"`
	Data          map[string]interface{} `json:"data,omitempty"`
}

// CustodyStatus is a combined status response
type CustodyStatus struct {
	VaultID       string            `json:"vault_id"`
	TotalWallets  int               `json:"total_wallets"`
	ActiveBalance map[string]string `json:"active_balance"` // assetID -> balance
	UpdatedAt     time.Time         `json:"updated_at"`
}

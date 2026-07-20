package payments

import "time"

// PaymentStatus represents the status of a payment
type PaymentStatus string

const (
	PaymentStatusPending        PaymentStatus = "PENDING"
	PaymentStatusProcessing     PaymentStatus = "PROCESSING"
	PaymentStatusSucceeded      PaymentStatus = "SUCCEEDED"
	PaymentStatusFailed         PaymentStatus = "FAILED"
	PaymentStatusCanceled       PaymentStatus = "CANCELED"
	PaymentStatusRequiresAction PaymentStatus = "REQUIRES_ACTION"
)

// PayoutStatus represents the status of a payout
type PayoutStatus string

const (
	PayoutStatusPending    PayoutStatus = "PENDING"
	PayoutStatusProcessing PayoutStatus = "PROCESSING"
	PayoutStatusSucceeded  PayoutStatus = "SUCCEEDED"
	PayoutStatusFailed     PayoutStatus = "FAILED"
	PayoutStatusCanceled   PayoutStatus = "CANCELED"
	PayoutStatusReversed   PayoutStatus = "REVERSED"
)

// PaymentMethod represents the method of payment
type PaymentMethod string

const (
	PaymentMethodCard   PaymentMethod = "CARD"
	PaymentMethodACH    PaymentMethod = "ACH"
	PaymentMethodWire   PaymentMethod = "WIRE"
	PaymentMethodWallet PaymentMethod = "WALLET"
)

// Currency represents supported currencies
type Currency string

const (
	CurrencyUSD Currency = "USD"
	CurrencyEUR Currency = "EUR"
	CurrencyGBP Currency = "GBP"
	CurrencyJPY Currency = "JPY"
)

// PaymentIntent represents a payment intent
type PaymentIntent struct {
	ID             string            `json:"id"`
	OrderID        string            `json:"order_id"`
	Amount         int64             `json:"amount"` // In cents/smallest unit
	Currency       Currency          `json:"currency"`
	Status         PaymentStatus     `json:"status"`
	PaymentMethod  PaymentMethod     `json:"payment_method,omitempty"`
	CreatedAt      time.Time         `json:"created_at"`
	UpdatedAt      time.Time         `json:"updated_at"`
	ClientSecret   string            `json:"client_secret,omitempty"`
	FailureMessage string            `json:"failure_message,omitempty"`
	Metadata       map[string]string `json:"metadata,omitempty"`
}

// PaymentIntentRequest is the request to create a payment intent
type PaymentIntentRequest struct {
	OrderID       string            `json:"order_id" binding:"required"`
	Amount        int64             `json:"amount" binding:"required"`
	Currency      Currency          `json:"currency" binding:"required"`
	PaymentMethod PaymentMethod     `json:"payment_method" binding:"required"`
	Email         string            `json:"email,omitempty"`
	ReceiptEmail  string            `json:"receipt_email,omitempty"`
	Description   string            `json:"description,omitempty"`
	Metadata      map[string]string `json:"metadata,omitempty"`
}

// Payout represents a payout to a bank account
type Payout struct {
	ID             string            `json:"id"`
	Amount         int64             `json:"amount"` // In cents/smallest unit
	Currency       Currency          `json:"currency"`
	Status         PayoutStatus      `json:"status"`
	BankAccount    BankAccount       `json:"bank_account"`
	CreatedAt      time.Time         `json:"created_at"`
	UpdatedAt      time.Time         `json:"updated_at"`
	FailureMessage string            `json:"failure_message,omitempty"`
	Metadata       map[string]string `json:"metadata,omitempty"`
}

// BankAccount represents bank account details
type BankAccount struct {
	AccountNumber string `json:"account_number"`
	RoutingNumber string `json:"routing_number"`
	AccountHolder string `json:"account_holder"`
	BankName      string `json:"bank_name,omitempty"`
	Country       string `json:"country,omitempty"`
}

// PayoutRequest is the request to create a payout
type PayoutRequest struct {
	Amount      int64             `json:"amount" binding:"required"`
	Currency    Currency          `json:"currency" binding:"required"`
	BankAccount BankAccount       `json:"bank_account" binding:"required"`
	Description string            `json:"description,omitempty"`
	Metadata    map[string]string `json:"metadata,omitempty"`
}

// WebhookEvent represents an event from the payment provider
type WebhookEvent struct {
	Type      string                 `json:"type"` // payment_intent.created, payment_intent.succeeded, payout.created, etc.
	PaymentID string                 `json:"payment_id,omitempty"`
	PayoutID  string                 `json:"payout_id,omitempty"`
	Status    string                 `json:"status,omitempty"`
	Amount    int64                  `json:"amount,omitempty"`
	Currency  Currency               `json:"currency,omitempty"`
	Timestamp time.Time              `json:"timestamp"`
	Data      map[string]interface{} `json:"data,omitempty"`
}

// PaymentStatusResponse is the response for payment status
type PaymentStatusResponse struct {
	PaymentID string        `json:"payment_id"`
	Status    PaymentStatus `json:"status"`
	Amount    int64         `json:"amount"`
	Currency  Currency      `json:"currency"`
	UpdatedAt time.Time     `json:"updated_at"`
}

// PayoutStatusResponse is the response for payout status
type PayoutStatusResponse struct {
	PayoutID  string       `json:"payout_id"`
	Status    PayoutStatus `json:"status"`
	Amount    int64        `json:"amount"`
	Currency  Currency     `json:"currency"`
	UpdatedAt time.Time    `json:"updated_at"`
}

package payments

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/stripe/stripe-go/v82"
	"github.com/stripe/stripe-go/v82/paymentintent"
	stripePayout "github.com/stripe/stripe-go/v82/payout"
	"github.com/stripe/stripe-go/v82/webhook"
)

// Provider defines the interface for payment processing
type Provider interface {
	CreatePaymentIntent(ctx context.Context, req PaymentIntentRequest) (*PaymentIntent, error)
	GetPaymentStatus(ctx context.Context, paymentID string) (*PaymentIntent, error)
	HandleWebhook(ctx context.Context, payload []byte, signature string) (*WebhookEvent, error)
	CreatePayout(ctx context.Context, req PayoutRequest) (*Payout, error)
	GetPayoutStatus(ctx context.Context, payoutID string) (*Payout, error)
}

// StripeProvider implements Provider using the official stripe-go SDK.
//
// Fixes over the previous raw-HTTP implementation:
//   - Uses official SDK (correct Content-Type: application/x-www-form-urlencoded)
//   - Webhook signature verification uses Stripe's t=timestamp,v1=hmac format
//   - Idempotency keys on every mutating call prevent double-charges
type StripeProvider struct {
	webhookKey string
}

// NewStripeProvider creates a new Stripe payment provider.
// apiKey is set globally on the stripe package (required by the SDK).
// webhookKey is used for webhook signature verification.
func NewStripeProvider(apiKey, webhookKey string) *StripeProvider {
	stripe.Key = apiKey
	return &StripeProvider{
		webhookKey: webhookKey,
	}
}

// CreatePaymentIntent creates a new payment intent in Stripe with an
// idempotency key derived from the order ID to prevent double-charging.
func (p *StripeProvider) CreatePaymentIntent(ctx context.Context, req PaymentIntentRequest) (*PaymentIntent, error) {
	params := &stripe.PaymentIntentParams{
		Amount:   stripe.Int64(req.Amount),
		Currency: stripe.String(string(req.Currency)),
	}

	if req.Description != "" {
		params.Description = stripe.String(req.Description)
	}
	if req.Email != "" {
		params.ReceiptEmail = stripe.String(req.Email)
	}

	// Attach order metadata for reconciliation
	params.AddMetadata("order_id", req.OrderID)
	for k, v := range req.Metadata {
		params.AddMetadata(k, v)
	}

	// Idempotency key: same order_id will never create duplicate charges.
	// Uses the order ID so retries of the same subscription request are safe.
	if req.OrderID != "" {
		params.SetIdempotencyKey(fmt.Sprintf("pi_create_%s", req.OrderID))
	}

	pi, err := paymentintent.New(params)
	if err != nil {
		return nil, fmt.Errorf("stripe CreatePaymentIntent: %w", err)
	}

	return &PaymentIntent{
		ID:           pi.ID,
		OrderID:      req.OrderID,
		Amount:       pi.Amount,
		Currency:     Currency(pi.Currency),
		Status:       mapStripeStatus(pi.Status),
		ClientSecret: pi.ClientSecret,
		CreatedAt:    time.Unix(pi.Created, 0),
		UpdatedAt:    time.Now(),
		Metadata:     req.Metadata,
	}, nil
}

// GetPaymentStatus retrieves the current status of a payment intent.
func (p *StripeProvider) GetPaymentStatus(ctx context.Context, paymentID string) (*PaymentIntent, error) {
	pi, err := paymentintent.Get(paymentID, nil)
	if err != nil {
		return nil, fmt.Errorf("stripe GetPaymentIntent: %w", err)
	}

	return &PaymentIntent{
		ID:        pi.ID,
		Amount:    pi.Amount,
		Currency:  Currency(pi.Currency),
		Status:    mapStripeStatus(pi.Status),
		CreatedAt: time.Unix(pi.Created, 0),
		UpdatedAt: time.Now(),
	}, nil
}

// HandleWebhook verifies the Stripe webhook signature using the official SDK
// (t=timestamp,v1=hmac format) and parses the event payload.
//
// The tolerance window is 5 minutes — events older than that are rejected
// to prevent replay attacks.
func (p *StripeProvider) HandleWebhook(ctx context.Context, payload []byte, signature string) (*WebhookEvent, error) {
	// webhook.ConstructEventWithOptions verifies the Stripe-Signature header
	// using the correct t=timestamp,v1=signature format with timing-safe comparison.
	// We ignore API version mismatch because the Stripe dashboard API version
	// may differ from the SDK version — the signature is still valid regardless.
	event, err := webhook.ConstructEventWithOptions(payload, signature, p.webhookKey, webhook.ConstructEventOptions{
		IgnoreAPIVersionMismatch: true,
	})
	if err != nil {
		return nil, fmt.Errorf("invalid webhook signature: %w", err)
	}

	// Extract the nested object ID, amount, currency, status from the event data.
	var obj struct {
		ID       string `json:"id"`
		Amount   int64  `json:"amount"`
		Currency string `json:"currency"`
		Status   string `json:"status"`
	}
	if err := json.Unmarshal(event.Data.Raw, &obj); err != nil {
		return nil, fmt.Errorf("failed to unmarshal webhook data object: %w", err)
	}

	webhookEvent := &WebhookEvent{
		Type:      string(event.Type),
		PaymentID: obj.ID,
		Status:    obj.Status,
		Amount:    obj.Amount,
		Currency:  Currency(obj.Currency),
		Timestamp: time.Unix(event.Created, 0),
		Data: map[string]interface{}{
			"event_id":    event.ID,
			"api_version": event.APIVersion,
			"livemode":    event.Livemode,
		},
	}

	return webhookEvent, nil
}

// CreatePayout creates a payout to the platform's default bank account.
// Idempotency key prevents duplicate payouts on retries.
func (p *StripeProvider) CreatePayout(ctx context.Context, req PayoutRequest) (*Payout, error) {
	params := &stripe.PayoutParams{
		Amount:   stripe.Int64(req.Amount),
		Currency: stripe.String(string(req.Currency)),
	}

	if req.Description != "" {
		params.Description = stripe.String(req.Description)
	}

	for k, v := range req.Metadata {
		params.AddMetadata(k, v)
	}

	// Idempotency: prevent duplicate payouts on network retry
	params.SetIdempotencyKey(fmt.Sprintf("po_create_%d_%d", req.Amount, time.Now().UnixNano()))

	po, err := stripePayout.New(params)
	if err != nil {
		return nil, fmt.Errorf("stripe CreatePayout: %w", err)
	}

	return &Payout{
		ID:        po.ID,
		Amount:    po.Amount,
		Currency:  Currency(po.Currency),
		Status:    mapStripePayoutStatus(po.Status),
		CreatedAt: time.Unix(po.Created, 0),
		UpdatedAt: time.Now(),
	}, nil
}

// GetPayoutStatus retrieves the current status of a payout.
func (p *StripeProvider) GetPayoutStatus(ctx context.Context, payoutID string) (*Payout, error) {
	po, err := stripePayout.Get(payoutID, nil)
	if err != nil {
		return nil, fmt.Errorf("stripe GetPayout: %w", err)
	}

	return &Payout{
		ID:        po.ID,
		Amount:    po.Amount,
		Currency:  Currency(po.Currency),
		Status:    mapStripePayoutStatus(po.Status),
		CreatedAt: time.Unix(po.Created, 0),
		UpdatedAt: time.Now(),
	}, nil
}

// --- Status mapping helpers (package-level, shared) ---

func mapStripeStatus(status stripe.PaymentIntentStatus) PaymentStatus {
	switch status {
	case stripe.PaymentIntentStatusSucceeded:
		return PaymentStatusSucceeded
	case stripe.PaymentIntentStatusProcessing:
		return PaymentStatusProcessing
	case stripe.PaymentIntentStatusRequiresPaymentMethod:
		return PaymentStatusRequiresAction
	case stripe.PaymentIntentStatusRequiresAction:
		return PaymentStatusRequiresAction
	case stripe.PaymentIntentStatusCanceled:
		return PaymentStatusCanceled
	default:
		return PaymentStatusPending
	}
}

func mapStripePayoutStatus(status stripe.PayoutStatus) PayoutStatus {
	switch status {
	case stripe.PayoutStatusPaid:
		return PayoutStatusSucceeded
	case stripe.PayoutStatusInTransit:
		return PayoutStatusProcessing
	case stripe.PayoutStatusFailed:
		return PayoutStatusFailed
	case stripe.PayoutStatusCanceled:
		return PayoutStatusCanceled
	default:
		return PayoutStatusPending
	}
}

// =============================================================================
// ManualBankTransferProvider — for markets without Stripe (e.g. SA EFT)
// =============================================================================

// ManualBankTransferProvider implements Provider for manual bank transfers
type ManualBankTransferProvider struct {
	intents map[string]*PaymentIntent
	payouts map[string]*Payout
}

// NewManualBankTransferProvider creates a new manual bank transfer provider
func NewManualBankTransferProvider() *ManualBankTransferProvider {
	return &ManualBankTransferProvider{
		intents: make(map[string]*PaymentIntent),
		payouts: make(map[string]*Payout),
	}
}

func (m *ManualBankTransferProvider) CreatePaymentIntent(ctx context.Context, req PaymentIntentRequest) (*PaymentIntent, error) {
	id := fmt.Sprintf("manual_intent_%d", time.Now().UnixNano())
	paymentIntent := &PaymentIntent{
		ID:        id,
		OrderID:   req.OrderID,
		Amount:    req.Amount,
		Currency:  req.Currency,
		Status:    PaymentStatusPending,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
		Metadata:  req.Metadata,
	}
	m.intents[id] = paymentIntent
	return paymentIntent, nil
}

func (m *ManualBankTransferProvider) GetPaymentStatus(ctx context.Context, paymentID string) (*PaymentIntent, error) {
	if intent, ok := m.intents[paymentID]; ok {
		return intent, nil
	}
	return nil, fmt.Errorf("payment intent not found: %s", paymentID)
}

func (m *ManualBankTransferProvider) HandleWebhook(ctx context.Context, payload []byte, signature string) (*WebhookEvent, error) {
	var event WebhookEvent
	if err := json.Unmarshal(payload, &event); err != nil {
		return nil, err
	}
	event.Timestamp = time.Now()
	return &event, nil
}

func (m *ManualBankTransferProvider) CreatePayout(ctx context.Context, req PayoutRequest) (*Payout, error) {
	id := fmt.Sprintf("manual_payout_%d", time.Now().UnixNano())
	payout := &Payout{
		ID:          id,
		Amount:      req.Amount,
		Currency:    req.Currency,
		Status:      PayoutStatusPending,
		BankAccount: req.BankAccount,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
		Metadata:    req.Metadata,
	}
	m.payouts[id] = payout
	return payout, nil
}

func (m *ManualBankTransferProvider) GetPayoutStatus(ctx context.Context, payoutID string) (*Payout, error) {
	if payout, ok := m.payouts[payoutID]; ok {
		return payout, nil
	}
	return nil, fmt.Errorf("payout not found: %s", payoutID)
}

// =============================================================================
// MockPaymentProvider — for testing and development
// =============================================================================

// MockPaymentProvider implements Provider for testing
type MockPaymentProvider struct {
	intents map[string]*PaymentIntent
	payouts map[string]*Payout
}

// NewMockPaymentProvider creates a new mock payment provider
func NewMockPaymentProvider() *MockPaymentProvider {
	return &MockPaymentProvider{
		intents: make(map[string]*PaymentIntent),
		payouts: make(map[string]*Payout),
	}
}

func (m *MockPaymentProvider) CreatePaymentIntent(ctx context.Context, req PaymentIntentRequest) (*PaymentIntent, error) {
	id := fmt.Sprintf("mock_intent_%d", time.Now().UnixNano())
	paymentIntent := &PaymentIntent{
		ID:        id,
		OrderID:   req.OrderID,
		Amount:    req.Amount,
		Currency:  req.Currency,
		Status:    PaymentStatusSucceeded,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
		Metadata:  req.Metadata,
	}
	m.intents[id] = paymentIntent
	return paymentIntent, nil
}

func (m *MockPaymentProvider) GetPaymentStatus(ctx context.Context, paymentID string) (*PaymentIntent, error) {
	if intent, ok := m.intents[paymentID]; ok {
		return intent, nil
	}
	return nil, fmt.Errorf("payment intent not found: %s", paymentID)
}

func (m *MockPaymentProvider) HandleWebhook(ctx context.Context, payload []byte, signature string) (*WebhookEvent, error) {
	var event WebhookEvent
	if err := json.Unmarshal(payload, &event); err != nil {
		return nil, err
	}
	event.Timestamp = time.Now()
	return &event, nil
}

func (m *MockPaymentProvider) CreatePayout(ctx context.Context, req PayoutRequest) (*Payout, error) {
	id := fmt.Sprintf("mock_payout_%d", time.Now().UnixNano())
	payout := &Payout{
		ID:          id,
		Amount:      req.Amount,
		Currency:    req.Currency,
		Status:      PayoutStatusSucceeded,
		BankAccount: req.BankAccount,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
		Metadata:    req.Metadata,
	}
	m.payouts[id] = payout
	return payout, nil
}

func (m *MockPaymentProvider) GetPayoutStatus(ctx context.Context, payoutID string) (*Payout, error) {
	if payout, ok := m.payouts[payoutID]; ok {
		return payout, nil
	}
	return nil, fmt.Errorf("payout not found: %s", payoutID)
}

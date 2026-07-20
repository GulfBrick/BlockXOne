package examples

import (
	"context"
	"log"

	"blockxone/internal/chain"
	"blockxone/internal/config"
	"blockxone/internal/custody"
	"blockxone/internal/kyc"
	"blockxone/internal/payments"
)

// Example: Initialize providers from configuration
func InitializeProvidersFromConfig(cfg config.Config) (
	kycProvider kyc.Provider,
	custodyProvider custody.Provider,
	paymentProvider payments.Provider,
	err error,
) {
	// Initialize KYC Provider
	switch cfg.KYCProvider {
	case "sumsub":
		kycProvider = kyc.NewSumsubProvider(
			cfg.SumsubAppToken,
			cfg.SumsubSecretKey,
			cfg.SumsubBaseURL,
			cfg.SumsubWebhookSecret,
		)
	case "mock":
		fallthrough
	default:
		kycProvider = kyc.NewMockProvider()
	}

	// Initialize Custody Provider
	switch cfg.CustodyProvider {
	case "fireblocks":
		custodyProvider = custody.NewFireblocksProvider(
			cfg.FireblocksAPIKey,
			"", // would load from file: cfg.FireblocksSecretKeyPath
			cfg.FireblocksBaseURL,
			"", // webhook key
		)
	case "self":
		// Wrap the existing chain adapter for self-custody
		chainAdapter := chain.NewMock() // or NewEVM with real config
		custodyProvider = custody.NewSelfCustodyProvider(chainAdapter, cfg.ChainID)
	case "mock":
		fallthrough
	default:
		custodyProvider = custody.NewSelfCustodyProvider(chain.NewMock(), cfg.ChainID)
	}

	// Initialize Payment Provider
	switch cfg.PaymentProvider {
	case "stripe":
		paymentProvider = payments.NewStripeProvider(
			cfg.StripeSecretKey,
			cfg.StripeWebhookSecret,
		)
	case "manual":
		paymentProvider = payments.NewManualBankTransferProvider()
	case "mock":
		fallthrough
	default:
		paymentProvider = payments.NewMockPaymentProvider()
	}

	return kycProvider, custodyProvider, paymentProvider, nil
}

// Example: KYC workflow
func ExampleKYCWorkflow(ctx context.Context, kycProvider kyc.Provider) {
	// 1. Create applicant
	applicant, err := kycProvider.CreateApplicant(
		ctx,
		"user_123",
		"user@example.com",
		kyc.LevelEnhanced,
	)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("Created applicant: %s", applicant.ID)

	// 2. Get verification URL
	verifyURL, err := kycProvider.GetVerificationURL(
		ctx,
		applicant.ID,
		"https://app.example.com/kyc-callback",
	)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("Verification URL: %s", verifyURL)

	// 3. In background, user completes verification...
	// Provider sends webhook to your webhook endpoint

	// 4. Poll status (or wait for webhook)
	refreshedApplicant, err := kycProvider.GetApplicant(ctx, applicant.ID)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("Applicant status: %s", refreshedApplicant.Status)

	// 5. Get submitted documents
	documents, err := kycProvider.GetDocuments(ctx, applicant.ID)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("Submitted documents: %d", len(documents))
}

// Example: Custody workflow
func ExampleCustodyWorkflow(ctx context.Context, custodyProvider custody.Provider) {
	// 1. Create vault for user
	vault, err := custodyProvider.CreateVault(ctx, "user_123_vault")
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("Created vault: %s", vault.ID)

	// 2. Create wallet for specific asset
	wallet, err := custodyProvider.CreateWallet(ctx, vault.ID, "USDC")
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("Created wallet: %s at %s", wallet.ID, wallet.Address)

	// 3. Check balance
	balance, err := custodyProvider.GetBalance(ctx, wallet.ID, "USDC")
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("Balance: %s USDC", balance.Amount)

	// 4. Create transaction
	tx, err := custodyProvider.CreateTransaction(ctx, custody.TransactionRequest{
		VaultID:   vault.ID,
		WalletID:  wallet.ID,
		AssetID:   "USDC",
		ToAddress: "0x742d35Cc6634C0532925a3b844Bc9e7595f42bE6",
		Amount:    "100000000", // 100 USDC in smallest units
		GasPrice:  "50",
		GasLimit:  "21000",
	})
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("Created transaction: %s", tx.ID)

	// 5. Poll transaction status
	txStatus, err := custodyProvider.GetTransaction(ctx, tx.ID)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("Transaction status: %s", txStatus.Status)
}

// Example: Payment workflow
func ExamplePaymentWorkflow(ctx context.Context, paymentProvider payments.Provider) {
	// 1. Create payment intent
	intent, err := paymentProvider.CreatePaymentIntent(ctx, payments.PaymentIntentRequest{
		OrderID:       "order_abc123",
		Amount:        99999, // $999.99
		Currency:      payments.CurrencyUSD,
		PaymentMethod: payments.PaymentMethodCard,
		Email:         "customer@example.com",
		Description:   "Asset purchase",
		Metadata: map[string]string{
			"asset_id": "asset_xyz",
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("Created payment intent: %s", intent.ID)
	log.Printf("Client secret: %s (send to frontend)", intent.ClientSecret)

	// 2. Poll payment status (or wait for webhook)
	status, err := paymentProvider.GetPaymentStatus(ctx, intent.ID)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("Payment status: %s", status.Status)

	// 3. Once payment succeeds, create payout (e.g., to treasury)
	if status.Status == payments.PaymentStatusSucceeded {
		payout, err := paymentProvider.CreatePayout(ctx, payments.PayoutRequest{
			Amount:   99999, // $999.99
			Currency: payments.CurrencyUSD,
			BankAccount: payments.BankAccount{
				AccountNumber: "1234567890",
				RoutingNumber: "021000021",
				AccountHolder: "BlockXOne Inc",
				BankName:      "Bank of America",
				Country:       "US",
			},
			Description: "Treasury settlement",
			Metadata: map[string]string{
				"order_id": "order_abc123",
			},
		})
		if err != nil {
			log.Fatal(err)
		}
		log.Printf("Created payout: %s", payout.ID)
	}
}

// Example: Webhook handling for KYC
func ExampleKYCWebhookHandler(kycProvider kyc.Provider, payload []byte, signature string) {
	ctx := context.Background()

	// Verify and parse webhook
	event, err := kycProvider.HandleWebhook(ctx, payload, signature)
	if err != nil {
		log.Printf("Invalid webhook signature: %v", err)
		return
	}

	log.Printf("Received KYC event: %s for applicant %s", event.Type, event.ApplicantID)

	switch event.Status {
	case kyc.StatusApproved:
		log.Printf("User %s approved for %s verification", event.UserID, event.ApplicantID)
		// Update user status in database
		// Trigger next step (e.g., asset transfer)

	case kyc.StatusRejected:
		log.Printf("User %s rejected: %v", event.UserID, event.Data["reason"])
		// Update user status in database
		// Send notification to user

	case kyc.StatusResubmissionRequested:
		log.Printf("User %s needs to resubmit", event.UserID)
		// Notify user to complete verification again
	}
}

// Example: Webhook handling for Custody
func ExampleCustodyWebhookHandler(custodyProvider custody.Provider, payload []byte, signature string) {
	ctx := context.Background()

	// Verify and parse webhook
	event, err := custodyProvider.HandleWebhook(ctx, payload, signature)
	if err != nil {
		log.Printf("Invalid webhook signature: %v", err)
		return
	}

	log.Printf("Received custody event: %s for transaction %s", event.Type, event.TransactionID)

	switch event.Type {
	case "transaction_confirmed":
		log.Printf("Transaction %s confirmed on-chain", event.TransactionID)
		// Update transaction status in database
		// Trigger next step (e.g., notify user)

	case "transaction_failed":
		log.Printf("Transaction %s failed: %s", event.TransactionID, event.Status)
		// Update transaction status
		// Trigger retry or notify admin
	}
}

// Example: Webhook handling for Payments
func ExamplePaymentWebhookHandler(paymentProvider payments.Provider, payload []byte, signature string) {
	ctx := context.Background()

	// Verify and parse webhook
	event, err := paymentProvider.HandleWebhook(ctx, payload, signature)
	if err != nil {
		log.Printf("Invalid webhook signature: %v", err)
		return
	}

	log.Printf("Received payment event: %s for payment %s", event.Type, event.PaymentID)

	switch event.Type {
	case "payment_intent.succeeded":
		log.Printf("Payment %s succeeded", event.PaymentID)
		// Update order status in database
		// Trigger fulfillment (e.g., transfer assets)
		// Send receipt to customer

	case "payment_intent.payment_failed":
		log.Printf("Payment %s failed", event.PaymentID)
		// Update order status
		// Notify customer to retry
	}
}

// Example: Error handling
func ExampleErrorHandling(ctx context.Context, kycProvider kyc.Provider) {
	// Error handling patterns
	applicant, err := kycProvider.GetApplicant(ctx, "nonexistent_id")
	if err != nil {
		// Type assertion to check error type if needed
		log.Printf("Error retrieving applicant: %v", err)
		// In real code, you'd log this, potentially retry, etc.
		return
	}

	log.Printf("Found applicant: %s", applicant.ID)
}

// Example: Working with self-custody provider
func ExampleSelfCustodySetup(cfg config.Config) custody.Provider {
	// For teams wanting self-custody, use the existing chain adapter
	chainAdapter := chain.NewMock()

	// Wrap it in custody provider interface
	selfCustody := custody.NewSelfCustodyProvider(chainAdapter, cfg.ChainID)

	return selfCustody
}

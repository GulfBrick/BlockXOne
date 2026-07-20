package kyc

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
)

// Provider defines the interface for KYC verification providers
type Provider interface {
	CreateApplicant(ctx context.Context, userID, email string, level Level) (*Applicant, error)
	GetApplicant(ctx context.Context, applicantID string) (*Applicant, error)
	GetVerificationURL(ctx context.Context, applicantID, redirectURL string) (string, error)
	HandleWebhook(ctx context.Context, payload []byte, signature string) (*WebhookEvent, error)
	GetDocuments(ctx context.Context, applicantID string) ([]Document, error)
	RefreshApplicantStatus(ctx context.Context, applicantID string) (*Applicant, error)
}

// SumsubProvider implements Provider for Sumsub KYC
type SumsubProvider struct {
	apiKey     string
	secretKey  string
	baseURL    string
	httpClient *http.Client
	webhookKey string
}

// Sumsub API request/response structures
type sumsubApplicantRequest struct {
	ExternalUserID string `json:"externalUserId"`
	Email          string `json:"email,omitempty"`
	Phone          string `json:"phone,omitempty"`
	FirstName      string `json:"firstName,omitempty"`
	LastName       string `json:"lastName,omitempty"`
}

type sumsubApplicantResponse struct {
	ID             string  `json:"id"`
	CreatedAt      int64   `json:"createdAt"`
	Email          string  `json:"email"`
	ExternalUserID string  `json:"externalUserId"`
	Review         *review `json:"review,omitempty"`
}

type review struct {
	ID       string   `json:"id"`
	Status   string   `json:"reviewStatus"` // PENDING, APPROVED, REJECTED, etc.
	RejectOn []string `json:"rejectOn,omitempty"`
	Reason   string   `json:"reason,omitempty"`
}

type sumsubWebhookPayload struct {
	Type           string  `json:"type"`
	ApplicantID    string  `json:"applicantId"`
	ExternalUserID string  `json:"externalUserId"`
	ReviewResult   *review `json:"reviewResult,omitempty"`
	CreatedAt      int64   `json:"createdAt"`
}

type sumsubDocument struct {
	ID             string                 `json:"id"`
	CreatedAt      int64                  `json:"createdAt"`
	DocumentType   string                 `json:"documentType"`
	DocumentStatus string                 `json:"documentStatus"`
	Metadata       map[string]interface{} `json:"metadata,omitempty"`
}

// NewSumsubProvider creates a new Sumsub KYC provider
func NewSumsubProvider(apiKey, secretKey, baseURL, webhookKey string) *SumsubProvider {
	return &SumsubProvider{
		apiKey:     apiKey,
		secretKey:  secretKey,
		baseURL:    baseURL,
		webhookKey: webhookKey,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// CreateApplicant creates a new applicant in Sumsub
func (p *SumsubProvider) CreateApplicant(ctx context.Context, userID, email string, level Level) (result *Applicant, err error) {
	req := sumsubApplicantRequest{
		ExternalUserID: userID,
		Email:          email,
	}

	payload, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	resp, err := p.doRequest(ctx, "POST", "/applicants", payload)
	if err != nil {
		return nil, err
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			result = nil
			err = errors.Join(err, fmt.Errorf("close Sumsub create-applicant response body: %w", closeErr))
		}
	}()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("sumsub API error: %d %s", resp.StatusCode, string(body))
	}

	var sumsubApplicant sumsubApplicantResponse
	if err := json.NewDecoder(resp.Body).Decode(&sumsubApplicant); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	applicant := &Applicant{
		ID:         sumsubApplicant.ID,
		UserID:     userID,
		Email:      email,
		Level:      level,
		Status:     StatusPending,
		CreatedAt:  time.Now(),
		UpdatedAt:  time.Now(),
		ExternalID: sumsubApplicant.ID,
	}

	return applicant, nil
}

// GetApplicant retrieves applicant details from Sumsub
func (p *SumsubProvider) GetApplicant(ctx context.Context, applicantID string) (result *Applicant, err error) {
	resp, err := p.doRequest(ctx, "GET", fmt.Sprintf("/applicants/%s", applicantID), nil)
	if err != nil {
		return nil, err
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			result = nil
			err = errors.Join(err, fmt.Errorf("close Sumsub get-applicant response body: %w", closeErr))
		}
	}()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("sumsub API error: %d %s", resp.StatusCode, string(body))
	}

	var sumsubApplicant sumsubApplicantResponse
	if err := json.NewDecoder(resp.Body).Decode(&sumsubApplicant); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	applicant := &Applicant{
		ID:         sumsubApplicant.ID,
		UserID:     sumsubApplicant.ExternalUserID,
		Email:      sumsubApplicant.Email,
		ExternalID: sumsubApplicant.ID,
		CreatedAt:  time.UnixMilli(sumsubApplicant.CreatedAt),
		UpdatedAt:  time.Now(),
	}

	// Map Sumsub review status to internal status
	if sumsubApplicant.Review != nil {
		applicant.Status = p.mapSumsubStatus(sumsubApplicant.Review.Status)
		applicant.VerificationID = sumsubApplicant.Review.ID
	} else {
		applicant.Status = StatusPending
	}

	return applicant, nil
}

// GetVerificationURL retrieves the verification URL from Sumsub
func (p *SumsubProvider) GetVerificationURL(ctx context.Context, applicantID, redirectURL string) (result string, err error) {
	// Sumsub uses the format: baseURL/mobile/idv/p/{accessToken}
	// First, we need to get an access token
	payload := []byte(fmt.Sprintf(`{"userId":"%s"}`, applicantID))

	resp, err := p.doRequest(ctx, "POST", "/accessTokens", payload)
	if err != nil {
		return "", err
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			result = ""
			err = errors.Join(err, fmt.Errorf("close Sumsub access-token response body: %w", closeErr))
		}
	}()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("failed to get access token: %d %s", resp.StatusCode, string(body))
	}

	var tokenResp struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return "", fmt.Errorf("failed to decode token response: %w", err)
	}

	verificationURL := fmt.Sprintf("%s/mobile/idv/p/%s", p.baseURL, tokenResp.Token)
	if redirectURL != "" {
		verificationURL += fmt.Sprintf("?returnUrl=%s", redirectURL)
	}

	return verificationURL, nil
}

// HandleWebhook verifies and processes webhook events from Sumsub
func (p *SumsubProvider) HandleWebhook(ctx context.Context, payload []byte, signature string) (*WebhookEvent, error) {
	// Verify HMAC signature
	if !p.verifySignature(payload, signature) {
		return nil, fmt.Errorf("invalid webhook signature")
	}

	var webhookPayload sumsubWebhookPayload
	if err := json.Unmarshal(payload, &webhookPayload); err != nil {
		return nil, fmt.Errorf("failed to unmarshal webhook payload: %w", err)
	}

	event := &WebhookEvent{
		Type:        webhookPayload.Type,
		ApplicantID: webhookPayload.ApplicantID,
		UserID:      webhookPayload.ExternalUserID,
		Timestamp:   time.UnixMilli(webhookPayload.CreatedAt),
		Data: map[string]interface{}{
			"payload": webhookPayload,
		},
	}

	if webhookPayload.ReviewResult != nil {
		event.Status = p.mapSumsubStatus(webhookPayload.ReviewResult.Status)
		if webhookPayload.ReviewResult.Reason != "" {
			event.Data["reason"] = webhookPayload.ReviewResult.Reason
		}
	} else {
		event.Status = StatusPending
	}

	return event, nil
}

// GetDocuments retrieves submitted documents for an applicant
func (p *SumsubProvider) GetDocuments(ctx context.Context, applicantID string) (result []Document, err error) {
	resp, err := p.doRequest(ctx, "GET", fmt.Sprintf("/applicants/%s/documents", applicantID), nil)
	if err != nil {
		return nil, err
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			result = nil
			err = errors.Join(err, fmt.Errorf("close Sumsub documents response body: %w", closeErr))
		}
	}()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("sumsub API error: %d %s", resp.StatusCode, string(body))
	}

	var sumsubDocs []sumsubDocument
	if err := json.NewDecoder(resp.Body).Decode(&sumsubDocs); err != nil {
		return nil, fmt.Errorf("failed to decode documents: %w", err)
	}

	documents := make([]Document, len(sumsubDocs))
	for i, doc := range sumsubDocs {
		documents[i] = Document{
			ID:          doc.ID,
			ApplicantID: applicantID,
			Type:        doc.DocumentType,
			Status:      p.mapDocumentStatus(doc.DocumentStatus),
			CreatedAt:   time.UnixMilli(doc.CreatedAt),
			UpdatedAt:   time.UnixMilli(doc.CreatedAt),
		}
	}

	return documents, nil
}

// RefreshApplicantStatus refreshes the status of an applicant
func (p *SumsubProvider) RefreshApplicantStatus(ctx context.Context, applicantID string) (*Applicant, error) {
	return p.GetApplicant(ctx, applicantID)
}

// Helper methods

func (p *SumsubProvider) doRequest(ctx context.Context, method, path string, body []byte) (*http.Response, error) {
	url := p.baseURL + path

	req, err := http.NewRequestWithContext(ctx, method, url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	if body != nil {
		req.Body = io.NopCloser(bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Content-Length", fmt.Sprintf("%d", len(body)))
	}

	// Add timestamp for signature
	ts := fmt.Sprintf("%d", time.Now().UnixMilli())
	req.Header.Set("X-App-Token", p.apiKey)

	// Add HMAC signature
	sig := p.calculateSignature(method, path, ts, string(body))
	req.Header.Set("X-App-Access-Sig", sig)
	req.Header.Set("X-App-Access-TS", ts)

	resp, err := p.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}

	return resp, nil
}

func (p *SumsubProvider) calculateSignature(method, path, ts, body string) string {
	// Signature format: HMAC-SHA256(method + path + ts + body)
	data := method + path + ts + body
	h := hmac.New(sha256.New, []byte(p.secretKey))
	h.Write([]byte(data))
	return hex.EncodeToString(h.Sum(nil))
}

func (p *SumsubProvider) verifySignature(payload []byte, signature string) bool {
	h := hmac.New(sha256.New, []byte(p.webhookKey))
	h.Write(payload)
	expectedSig := hex.EncodeToString(h.Sum(nil))
	return hmac.Equal([]byte(expectedSig), []byte(signature))
}

func (p *SumsubProvider) mapSumsubStatus(sumsubStatus string) Status {
	switch sumsubStatus {
	case "APPROVED", "GREEN":
		return StatusApproved
	case "REJECTED", "RED":
		return StatusRejected
	case "RESUBMISSION_REQUESTED", "YELLOW":
		return StatusResubmissionRequested
	case "PENDING", "REVIEW_IN_PROCESS":
		return StatusUnderReview
	default:
		return StatusPending
	}
}

func (p *SumsubProvider) mapDocumentStatus(docStatus string) Status {
	switch docStatus {
	case "APPROVED":
		return StatusApproved
	case "REJECTED":
		return StatusRejected
	case "RESUBMISSION_REQUESTED":
		return StatusResubmissionRequested
	default:
		return StatusPending
	}
}

// MockProvider implements Provider for testing
type MockProvider struct {
	applicants map[string]*Applicant
}

// NewMockProvider creates a new mock KYC provider
func NewMockProvider() *MockProvider {
	return &MockProvider{
		applicants: make(map[string]*Applicant),
	}
}

func (m *MockProvider) CreateApplicant(ctx context.Context, userID, email string, level Level) (*Applicant, error) {
	applicant := &Applicant{
		ID:        fmt.Sprintf("mock_app_%s", userID),
		UserID:    userID,
		Email:     email,
		Level:     level,
		Status:    StatusPending,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	m.applicants[applicant.ID] = applicant
	return applicant, nil
}

func (m *MockProvider) GetApplicant(ctx context.Context, applicantID string) (*Applicant, error) {
	if app, ok := m.applicants[applicantID]; ok {
		return app, nil
	}
	return nil, fmt.Errorf("applicant not found: %s", applicantID)
}

func (m *MockProvider) GetVerificationURL(ctx context.Context, applicantID, redirectURL string) (string, error) {
	if _, ok := m.applicants[applicantID]; !ok {
		return "", fmt.Errorf("applicant not found: %s", applicantID)
	}
	return "https://mock.kyc.example.com/verify/" + applicantID, nil
}

func (m *MockProvider) HandleWebhook(ctx context.Context, payload []byte, signature string) (*WebhookEvent, error) {
	var event WebhookEvent
	if err := json.Unmarshal(payload, &event); err != nil {
		return nil, err
	}
	event.Timestamp = time.Now()
	return &event, nil
}

func (m *MockProvider) GetDocuments(ctx context.Context, applicantID string) ([]Document, error) {
	if _, ok := m.applicants[applicantID]; !ok {
		return nil, fmt.Errorf("applicant not found: %s", applicantID)
	}
	return []Document{}, nil
}

func (m *MockProvider) RefreshApplicantStatus(ctx context.Context, applicantID string) (*Applicant, error) {
	return m.GetApplicant(ctx, applicantID)
}

package kyc

import "time"

// Status represents the verification status
type Status string

const (
	StatusPending               Status = "PENDING"
	StatusApproved              Status = "APPROVED"
	StatusRejected              Status = "REJECTED"
	StatusResubmissionRequested Status = "RESUBMISSION_REQUESTED"
	StatusExpired               Status = "EXPIRED"
	StatusUnderReview           Status = "UNDER_REVIEW"
)

// Level represents the KYC verification level
type Level string

const (
	LevelBasic      Level = "BASIC"
	LevelEnhanced   Level = "ENHANCED"
	LevelAccredited Level = "ACCREDITED"
)

// Applicant represents a user undergoing KYC verification
type Applicant struct {
	ID             string            `json:"id"`
	UserID         string            `json:"user_id"`
	Email          string            `json:"email"`
	Level          Level             `json:"level"`
	Status         Status            `json:"status"`
	CreatedAt      time.Time         `json:"created_at"`
	UpdatedAt      time.Time         `json:"updated_at"`
	VerificationID string            `json:"verification_id,omitempty"` // Sumsub verification ID
	ExternalID     string            `json:"external_id,omitempty"`     // Provider-specific ID
	Metadata       map[string]string `json:"metadata,omitempty"`
}

// Document represents a submitted document for verification
type Document struct {
	ID          string    `json:"id"`
	ApplicantID string    `json:"applicant_id"`
	Type        string    `json:"type"` // passport, national_id, driving_license, etc.
	Status      Status    `json:"status"`
	URL         string    `json:"url"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// VerificationResult contains the overall KYC verification outcome
type VerificationResult struct {
	ApplicantID  string                 `json:"applicant_id"`
	Level        Level                  `json:"level"`
	Status       Status                 `json:"status"`
	Reason       string                 `json:"reason,omitempty"`
	IdentityInfo map[string]interface{} `json:"identity_info,omitempty"`
	AMLStatus    string                 `json:"aml_status,omitempty"`
	CreatedAt    time.Time              `json:"created_at"`
}

// WebhookEvent represents an event from the KYC provider
type WebhookEvent struct {
	Type        string                 `json:"type"` // applicant_review_complete, applicant_action_required, etc.
	ApplicantID string                 `json:"applicant_id"`
	UserID      string                 `json:"user_id,omitempty"`
	Status      Status                 `json:"status"`
	Timestamp   time.Time              `json:"timestamp"`
	Data        map[string]interface{} `json:"data,omitempty"`
}

// CreateApplicantRequest is the request to create a new KYC applicant
type CreateApplicantRequest struct {
	UserID string `json:"user_id" binding:"required"`
	Email  string `json:"email" binding:"required,email"`
	Level  Level  `json:"level" binding:"required"`
}

// GetVerificationURLRequest is the request to get the verification URL
type GetVerificationURLRequest struct {
	ApplicantID string `json:"applicant_id" binding:"required"`
	Level       Level  `json:"level" binding:"required"`
	RedirectURL string `json:"redirect_url,omitempty"`
}

// VerificationStatusResponse is the response for verification status
type VerificationStatusResponse struct {
	ApplicantID string    `json:"applicant_id"`
	Status      Status    `json:"status"`
	Level       Level     `json:"level"`
	UpdatedAt   time.Time `json:"updated_at"`
}

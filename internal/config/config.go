package config

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
)

const productionEnvironment = "production"

var ethereumAddressPattern = regexp.MustCompile(`^0x[0-9a-fA-F]{40}$`)

type Config struct {
	AppEnv   string
	HTTPAddr string

	AuthMode             string
	DevAllowRoleOverride bool
	JWTSecret            string

	DatabaseURL string
	NatsURL     string
	RedisURL    string

	S3Endpoint  string
	S3AccessKey string
	S3SecretKey string
	S3Bucket    string
	S3Region    string
	S3UseSSL    bool

	ChainMode           string
	ChainID             int64
	ApprovedChainID     int64
	ChainRPCURL         string
	ChainPrivateKey     string // only used when ChainSigner=env
	ChainSigner         string // "env" (default, dev) or "kms" (production)
	KMSKeyARN           string // AWS KMS key ARN / GCP key name / Azure key ID
	TokenFactoryAddress string

	EnableMarketplace bool

	// KYC Provider Configuration
	KYCProvider         string
	SumsubAppToken      string
	SumsubSecretKey     string
	SumsubBaseURL       string
	SumsubWebhookSecret string

	// Custody Provider Configuration
	CustodyProvider         string
	FireblocksAPIKey        string
	FireblocksSecretKeyPath string
	FireblocksBaseURL       string

	// Payment Provider Configuration
	PaymentProvider     string
	StripeSecretKey     string
	StripeWebhookSecret string

	// CORS Configuration
	CORSAllowedOrigins string

	// Rate Limiting Configuration
	RateLimitAPI  int
	RateLimitAuth int

	loadErrors []string
}

func getEnv(key, def string) string {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	return v
}

func getEnvBool(key string, def bool) bool {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	switch v {
	case "1", "true", "TRUE", "yes", "YES", "y", "Y":
		return true
	case "0", "false", "FALSE", "no", "NO", "n", "N":
		return false
	default:
		return def
	}
}

func getEnvInt64(key string, def int64) int64 {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	var n int64
	_, err := fmt.Sscanf(v, "%d", &n)
	if err != nil {
		return def
	}
	return n
}

func normalizeEnvValue(v string) string {
	return strings.ToLower(strings.TrimSpace(v))
}

func getEnvBoolStrict(key string, def bool) (bool, error) {
	v, ok := os.LookupEnv(key)
	if !ok {
		return def, nil
	}
	if strings.TrimSpace(v) == "" {
		return def, fmt.Errorf("%s must not be blank when explicitly set", key)
	}
	switch normalizeEnvValue(v) {
	case "1", "true", "yes", "y":
		return true, nil
	case "0", "false", "no", "n":
		return false, nil
	default:
		return def, fmt.Errorf("%s must be a boolean", key)
	}
}

func getEnvInt64Strict(key string, def int64) (int64, error) {
	v, ok := os.LookupEnv(key)
	if !ok {
		return def, nil
	}
	if strings.TrimSpace(v) == "" {
		return def, fmt.Errorf("%s must not be blank when explicitly set", key)
	}
	n, err := strconv.ParseInt(strings.TrimSpace(v), 10, 64)
	if err != nil {
		return def, fmt.Errorf("%s must be an integer", key)
	}
	return n, nil
}

func getEnvNormalizedStrict(key, def string) (string, error) {
	v, ok := os.LookupEnv(key)
	if !ok {
		return normalizeEnvValue(def), nil
	}
	if strings.TrimSpace(v) == "" {
		return "", fmt.Errorf("%s must not be blank when explicitly set", key)
	}
	return normalizeEnvValue(v), nil
}

func defaultAuthMode(appEnv string) string {
	if appEnv == "dev" {
		return "dev"
	}
	return "jwt"
}

func defaultJWTSecret(appEnv string) string {
	if appEnv == "dev" {
		return "dev-jwt-secret"
	}
	return ""
}

func defaultDevAllowRoleOverride(appEnv string) bool {
	return appEnv == "dev"
}

func Load() Config {
	appEnv, appEnvErr := getEnvNormalizedStrict("APP_ENV", "dev")
	authMode, authModeErr := getEnvNormalizedStrict("AUTH_MODE", defaultAuthMode(appEnv))

	devRoleOverride, devRoleOverrideErr := getEnvBoolStrict("DEV_ALLOW_ROLE_OVERRIDE", defaultDevAllowRoleOverride(appEnv))
	s3UseSSL, s3UseSSLErr := getEnvBoolStrict("S3_USE_SSL", false)
	chainID, chainIDErr := getEnvInt64Strict("CHAIN_ID", 137)
	approvedChainID, approvedChainIDErr := getEnvInt64Strict("APPROVED_CHAIN_ID", 0)
	enableMarketplace, enableMarketplaceErr := getEnvBoolStrict("ENABLE_MARKETPLACE", true)
	rateLimitAPI, rateLimitAPIErr := getEnvInt64Strict("RATE_LIMIT_API", 60)
	rateLimitAuth, rateLimitAuthErr := getEnvInt64Strict("RATE_LIMIT_AUTH", 10)

	var loadErrors []string
	for _, err := range []error{
		appEnvErr,
		authModeErr,
		devRoleOverrideErr,
		s3UseSSLErr,
		chainIDErr,
		approvedChainIDErr,
		enableMarketplaceErr,
		rateLimitAPIErr,
		rateLimitAuthErr,
	} {
		if err != nil {
			loadErrors = append(loadErrors, err.Error())
		}
	}

	return Config{
		AppEnv:   appEnv,
		HTTPAddr: getEnv("HTTP_ADDR", ":8080"),

		AuthMode:             authMode,
		JWTSecret:            getEnv("JWT_SECRET", defaultJWTSecret(appEnv)),
		DevAllowRoleOverride: devRoleOverride,

		DatabaseURL: getEnv("DATABASE_URL", "postgres://blockxone:blockxone@localhost:5432/blockxone?sslmode=disable"),
		NatsURL:     getEnv("NATS_URL", "nats://localhost:4222"),
		RedisURL:    getEnv("REDIS_URL", "redis://localhost:6379/0"),

		S3Endpoint:  getEnv("S3_ENDPOINT", "http://localhost:9000"),
		S3AccessKey: getEnv("S3_ACCESS_KEY", "minioadmin"),
		S3SecretKey: getEnv("S3_SECRET_KEY", "minioadmin"),
		S3Bucket:    getEnv("S3_BUCKET", "blockxone-kyc"),
		S3Region:    getEnv("S3_REGION", "us-east-1"),
		S3UseSSL:    s3UseSSL,

		ChainMode:           normalizeEnvValue(getEnv("CHAIN_MODE", "mock")),
		ChainID:             chainID,
		ApprovedChainID:     approvedChainID,
		ChainRPCURL:         getEnv("CHAIN_RPC_URL", ""),
		ChainPrivateKey:     getEnv("CHAIN_PRIVATE_KEY", ""),
		ChainSigner:         normalizeEnvValue(getEnv("CHAIN_SIGNER", "env")),
		KMSKeyARN:           getEnv("KMS_KEY_ARN", ""),
		TokenFactoryAddress: getEnv("TOKEN_FACTORY_ADDRESS", ""),

		EnableMarketplace: enableMarketplace,

		// KYC Provider Configuration
		KYCProvider:         normalizeEnvValue(getEnv("KYC_PROVIDER", "mock")),
		SumsubAppToken:      getEnv("SUMSUB_APP_TOKEN", ""),
		SumsubSecretKey:     getEnv("SUMSUB_SECRET_KEY", ""),
		SumsubBaseURL:       getEnv("SUMSUB_BASE_URL", "https://api.sumsub.com"),
		SumsubWebhookSecret: getEnv("SUMSUB_WEBHOOK_SECRET", ""),

		// Custody Provider Configuration
		CustodyProvider:         normalizeEnvValue(getEnv("CUSTODY_PROVIDER", "mock")),
		FireblocksAPIKey:        getEnv("FIREBLOCKS_API_KEY", ""),
		FireblocksSecretKeyPath: getEnv("FIREBLOCKS_SECRET_KEY_PATH", ""),
		FireblocksBaseURL:       getEnv("FIREBLOCKS_BASE_URL", "https://api.fireblocks.io"),

		// Payment Provider Configuration
		PaymentProvider:     normalizeEnvValue(getEnv("PAYMENT_PROVIDER", "mock")),
		StripeSecretKey:     getEnv("STRIPE_SECRET_KEY", ""),
		StripeWebhookSecret: getEnv("STRIPE_WEBHOOK_SECRET", ""),

		// CORS Configuration
		CORSAllowedOrigins: getEnv("CORS_ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:8080"),

		// Rate Limiting Configuration
		RateLimitAPI:  int(rateLimitAPI),
		RateLimitAuth: int(rateLimitAuth),

		loadErrors: loadErrors,
	}
}

// ValidateRuntime validates configuration before a process performs any
// external connection or starts a listener. Production validation is
// deliberately fail-closed: a shaped API configuration still cannot start
// until managed signing and provider injection are implemented. The outbox
// worker has a separate least-privilege database-and-NATS contract.
func (c Config) ValidateRuntime(process string) error {
	process = normalizeEnvValue(process)
	var problems []error

	for _, loadErr := range c.loadErrors {
		problems = append(problems, errors.New(loadErr))
	}

	switch normalizeEnvValue(c.AppEnv) {
	case "dev", "test", productionEnvironment:
	default:
		problems = append(problems, errors.New("APP_ENV must be one of dev, test, or production"))
	}

	switch process {
	case "api", "worker", "migrate", "app":
	default:
		problems = append(problems, errors.New("runtime process must be api, worker, migrate, or app"))
	}

	if normalizeEnvValue(c.AppEnv) != productionEnvironment {
		if c.RateLimitAPI <= 0 {
			problems = append(problems, errors.New("RATE_LIMIT_API must be positive"))
		}
		if c.RateLimitAuth <= 0 {
			problems = append(problems, errors.New("RATE_LIMIT_AUTH must be positive"))
		}
		return errors.Join(problems...)
	}

	if process == "migrate" {
		if err := validateProductionDatabaseURL(c.DatabaseURL); err != nil {
			problems = append(problems, err)
		}
		return errors.Join(problems...)
	}
	if process == "worker" {
		if err := validateProductionDatabaseURL(c.DatabaseURL); err != nil {
			problems = append(problems, err)
		}
		if !isRemoteURLWithSchemes(c.NatsURL, "tls") {
			problems = append(problems, errors.New("production NATS_URL must use a remote tls:// endpoint"))
		}
		return errors.Join(problems...)
	}

	if c.RateLimitAPI <= 0 {
		problems = append(problems, errors.New("RATE_LIMIT_API must be positive"))
	}
	if c.RateLimitAuth <= 0 {
		problems = append(problems, errors.New("RATE_LIMIT_AUTH must be positive"))
	}
	problems = append(problems, c.validateProductionBase()...)
	problems = append(problems, c.validateProductionServices()...)
	return errors.Join(problems...)
}

func (c Config) validateProductionBase() []error {
	var problems []error
	if normalizeEnvValue(c.AuthMode) != "jwt" {
		problems = append(problems, errors.New("production requires AUTH_MODE=jwt"))
	}
	if c.DevAllowRoleOverride {
		problems = append(problems, errors.New("production forbids DEV_ALLOW_ROLE_OVERRIDE"))
	}
	jwtSecret := strings.TrimSpace(c.JWTSecret)
	if len(jwtSecret) < 32 || normalizeEnvValue(jwtSecret) == "dev-jwt-secret" || strings.Contains(normalizeEnvValue(jwtSecret), "change-me") {
		problems = append(problems, errors.New("production requires a non-default JWT_SECRET of at least 32 characters"))
	}

	if err := validateProductionDatabaseURL(c.DatabaseURL); err != nil {
		problems = append(problems, err)
	}
	if !isRemoteURLWithSchemes(c.NatsURL, "tls") {
		problems = append(problems, errors.New("production NATS_URL must use a remote tls:// endpoint"))
	}
	if !isRemoteURLWithSchemes(c.RedisURL, "rediss") {
		problems = append(problems, errors.New("production REDIS_URL must use a remote rediss:// endpoint"))
	}
	return problems
}

func (c Config) validateProductionServices() []error {
	var problems []error

	if !c.S3UseSSL || !isRemoteURLWithSchemes(c.S3Endpoint, "https") {
		problems = append(problems, errors.New("production document storage must use a remote HTTPS endpoint with S3_USE_SSL=true"))
	}
	if strings.TrimSpace(c.S3Bucket) == "" || strings.TrimSpace(c.S3Region) == "" {
		problems = append(problems, errors.New("production document storage bucket and region are required"))
	}
	if isDefaultCredential(c.S3AccessKey) || isDefaultCredential(c.S3SecretKey) {
		problems = append(problems, errors.New("production document storage credentials must not use defaults"))
	}

	if normalizeEnvValue(c.ChainMode) != "evm" {
		problems = append(problems, errors.New("production requires CHAIN_MODE=evm"))
	}
	if c.ChainID <= 0 || c.ApprovedChainID <= 0 || c.ChainID != c.ApprovedChainID {
		problems = append(problems, errors.New("CHAIN_ID must equal the positive APPROVED_CHAIN_ID"))
	}
	if !isRemoteURLWithSchemes(c.ChainRPCURL, "https", "wss") {
		problems = append(problems, errors.New("production CHAIN_RPC_URL must be a remote HTTPS or WSS endpoint"))
	}
	if !ethereumAddressPattern.MatchString(strings.TrimSpace(c.TokenFactoryAddress)) || isZeroAddress(c.TokenFactoryAddress) {
		problems = append(problems, errors.New("production TOKEN_FACTORY_ADDRESS must be a non-zero EVM address"))
	}
	if strings.TrimSpace(c.ChainPrivateKey) != "" {
		problems = append(problems, errors.New("production forbids CHAIN_PRIVATE_KEY"))
	}
	if normalizeEnvValue(c.ChainSigner) != "kms" || strings.TrimSpace(c.KMSKeyARN) == "" {
		problems = append(problems, errors.New("production requires CHAIN_SIGNER=kms and KMS_KEY_ARN"))
	}
	// The KMS constructor is intentionally still a stub. Refuse a production
	// runtime until Phase 5 replaces it with a verified managed signer.
	problems = append(problems, errors.New("production managed chain signer is not implemented"))

	if c.EnableMarketplace {
		problems = append(problems, errors.New("production release one forbids ENABLE_MARKETPLACE"))
	}

	problems = append(problems, validateProductionProviders(c)...)
	problems = append(problems, validateProductionCORS(c.CORSAllowedOrigins)...)

	// Provider labels currently do not inject dependencies into app.App. Keeping
	// this explicit blocker prevents labels from being mistaken for integration.
	problems = append(problems, errors.New("production provider dependency injection is not implemented"))
	return problems
}

func validateProductionProviders(c Config) []error {
	var problems []error
	if normalizeEnvValue(c.KYCProvider) != "sumsub" || anyBlank(c.SumsubAppToken, c.SumsubSecretKey, c.SumsubWebhookSecret) || !isRemoteURLWithSchemes(c.SumsubBaseURL, "https") {
		problems = append(problems, errors.New("production requires a fully configured HTTPS Sumsub KYC provider"))
	}
	if normalizeEnvValue(c.CustodyProvider) != "fireblocks" || anyBlank(c.FireblocksAPIKey, c.FireblocksSecretKeyPath) || !isRemoteURLWithSchemes(c.FireblocksBaseURL, "https") {
		problems = append(problems, errors.New("production requires a fully configured HTTPS Fireblocks custody provider"))
	}
	if normalizeEnvValue(c.PaymentProvider) != "stripe" || anyBlank(c.StripeSecretKey, c.StripeWebhookSecret) {
		problems = append(problems, errors.New("production requires a fully configured Stripe payment provider"))
	}
	return problems
}

func validateProductionCORS(origins string) []error {
	if strings.TrimSpace(origins) == "" {
		return []error{errors.New("production CORS_ALLOWED_ORIGINS is required")}
	}
	var problems []error
	for _, origin := range strings.Split(origins, ",") {
		origin = strings.TrimSpace(origin)
		if origin == "*" || !isSecureRemoteOrigin(origin) {
			problems = append(problems, errors.New("production CORS origins must be explicit remote HTTPS origins"))
			break
		}
	}
	return problems
}

func validateProductionDatabaseURL(raw string) error {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (normalizeEnvValue(u.Scheme) != "postgres" && normalizeEnvValue(u.Scheme) != "postgresql") || isNonGlobalHostname(u.Hostname()) {
		return errors.New("production DATABASE_URL must be an explicit remote PostgreSQL URL")
	}
	query, err := url.ParseQuery(u.RawQuery)
	sslModes := query["sslmode"]
	if err != nil || len(sslModes) != 1 || normalizeEnvValue(sslModes[0]) != "verify-full" {
		return errors.New("production DATABASE_URL must set sslmode=verify-full exactly once")
	}
	if u.User == nil {
		return errors.New("production DATABASE_URL must contain non-default credentials")
	}
	username := normalizeEnvValue(u.User.Username())
	password, hasPassword := u.User.Password()
	if username == "" || !hasPassword || strings.TrimSpace(password) == "" || username == "blockxone" && normalizeEnvValue(password) == "blockxone" {
		return errors.New("production DATABASE_URL must contain non-default credentials")
	}
	return nil
}

func isRemoteURLWithSchemes(raw string, allowedSchemes ...string) bool {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Hostname() == "" || isNonGlobalHostname(u.Hostname()) {
		return false
	}
	scheme := normalizeEnvValue(u.Scheme)
	for _, allowed := range allowedSchemes {
		if scheme == normalizeEnvValue(allowed) {
			return true
		}
	}
	return false
}

func isSecureRemoteOrigin(raw string) bool {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || normalizeEnvValue(u.Scheme) != "https" || isNonGlobalHostname(u.Hostname()) {
		return false
	}
	// A CORS origin is only scheme, host, and optional port. Reject credentials,
	// paths, queries, and fragments so the configured value can be compared to a
	// browser Origin header without surprising normalization.
	return u.User == nil && u.Path == "" && u.RawPath == "" && u.RawQuery == "" && u.Fragment == ""
}

func normalizeHostname(host string) string {
	host = normalizeEnvValue(strings.Trim(host, "[]"))
	// A final dot is the DNS root marker. Remove it before checking special-use
	// names so values such as localhost. cannot bypass the policy.
	return strings.TrimRight(host, ".")
}

func isNonGlobalHostname(host string) bool {
	host = normalizeHostname(host)
	if host == "" || host == "localhost" || strings.HasSuffix(host, ".localhost") ||
		strings.HasSuffix(host, ".local") || host == "localdomain" || strings.HasSuffix(host, ".localdomain") {
		return true
	}
	// Zone-scoped IPv6 addresses are necessarily interface-local. net.ParseIP
	// does not accept zone identifiers, so reject them before parsing.
	if strings.Contains(host, "%") {
		return true
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	return !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsUnspecified() ||
		ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast()
}

func isDefaultCredential(value string) bool {
	normalized := normalizeEnvValue(value)
	return normalized == "" || normalized == "minioadmin" || normalized == "blockxone" || strings.Contains(normalized, "change-me")
}

func isZeroAddress(address string) bool {
	return normalizeEnvValue(address) == "0x0000000000000000000000000000000000000000"
}

func anyBlank(values ...string) bool {
	for _, value := range values {
		if strings.TrimSpace(value) == "" {
			return true
		}
	}
	return false
}

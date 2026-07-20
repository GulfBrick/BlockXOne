package config

import (
	"strings"
	"testing"
)

func productionShapedConfig() Config {
	return Config{
		AppEnv:                  "production",
		AuthMode:                "jwt",
		JWTSecret:               strings.Repeat("x", 48),
		DatabaseURL:             "postgres://prod-user:strong-password@db.internal.example:5432/blockxone?sslmode=verify-full",
		NatsURL:                 "tls://nats.internal.example:4222",
		RedisURL:                "rediss://redis.internal.example:6379/0",
		S3Endpoint:              "https://documents.internal.example",
		S3AccessKey:             "production-access-key",
		S3SecretKey:             "production-secret-key",
		S3Bucket:                "regulated-documents",
		S3Region:                "af-south-1",
		S3UseSSL:                true,
		ChainMode:               "evm",
		ChainID:                 137,
		ApprovedChainID:         137,
		ChainRPCURL:             "https://polygon-rpc.internal.example",
		ChainSigner:             "kms",
		KMSKeyARN:               "kms://managed-key/reference",
		TokenFactoryAddress:     "0x1111111111111111111111111111111111111111",
		EnableMarketplace:       false,
		KYCProvider:             "sumsub",
		SumsubAppToken:          "sumsub-app-token",
		SumsubSecretKey:         "sumsub-secret",
		SumsubBaseURL:           "https://api.sumsub.com",
		SumsubWebhookSecret:     "sumsub-webhook-secret",
		CustodyProvider:         "fireblocks",
		FireblocksAPIKey:        "fireblocks-api-key",
		FireblocksSecretKeyPath: "/run/secrets/fireblocks-key",
		FireblocksBaseURL:       "https://api.fireblocks.io",
		PaymentProvider:         "stripe",
		StripeSecretKey:         "stripe-secret-key",
		StripeWebhookSecret:     "stripe-webhook-secret",
		CORSAllowedOrigins:      "https://app.blockxone.example",
		RateLimitAPI:            60,
		RateLimitAuth:           10,
	}
}

func TestValidateRuntimeProductionRetainsExplicitImplementationBlockers(t *testing.T) {
	cfg := productionShapedConfig()
	err := cfg.ValidateRuntime("api")
	if err == nil {
		t.Fatal("production API must remain blocked until managed signing and provider injection are implemented")
	}
	for _, want := range []string{
		"managed chain signer is not implemented",
		"provider dependency injection is not implemented",
	} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("expected blocker %q in %v", want, err)
		}
	}
}

func TestValidateRuntimeProductionRejectsUnsafeConfiguration(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*Config)
		want   string
	}{
		{"dev auth", func(c *Config) { c.AuthMode = "dev" }, "AUTH_MODE=jwt"},
		{"unknown auth", func(c *Config) { c.AuthMode = "other" }, "AUTH_MODE=jwt"},
		{"role override", func(c *Config) { c.DevAllowRoleOverride = true }, "DEV_ALLOW_ROLE_OVERRIDE"},
		{"weak jwt", func(c *Config) { c.JWTSecret = "short" }, "JWT_SECRET"},
		{"whitespace jwt", func(c *Config) { c.JWTSecret = strings.Repeat(" \t", 32) }, "JWT_SECRET"},
		{"local database", func(c *Config) { c.DatabaseURL = "postgres://user:pass@localhost:5432/db?sslmode=disable" }, "DATABASE_URL"},
		{"database tls omitted", func(c *Config) { c.DatabaseURL = "postgres://user:pass@db.example:5432/db" }, "sslmode=verify-full"},
		{"database tls require", func(c *Config) { c.DatabaseURL = "postgres://user:pass@db.example:5432/db?sslmode=require" }, "sslmode=verify-full"},
		{"local nats", func(c *Config) { c.NatsURL = "nats://localhost:4222" }, "NATS_URL"},
		{"plaintext remote nats", func(c *Config) { c.NatsURL = "nats://nats.example.com:4222" }, "NATS_URL"},
		{"local redis", func(c *Config) { c.RedisURL = "redis://localhost:6379" }, "REDIS_URL"},
		{"plaintext remote redis", func(c *Config) { c.RedisURL = "redis://redis.example.com:6379" }, "REDIS_URL"},
		{"public storage over http", func(c *Config) { c.S3Endpoint = "http://storage.example" }, "document storage"},
		{"storage websocket scheme", func(c *Config) { c.S3Endpoint = "wss://storage.example" }, "document storage"},
		{"default storage credential", func(c *Config) { c.S3AccessKey = "minioadmin" }, "credentials"},
		{"mock chain", func(c *Config) { c.ChainMode = "mock" }, "CHAIN_MODE=evm"},
		{"unknown chain", func(c *Config) { c.ChainMode = "other" }, "CHAIN_MODE=evm"},
		{"unapproved chain", func(c *Config) { c.ApprovedChainID = 1 }, "APPROVED_CHAIN_ID"},
		{"local rpc", func(c *Config) { c.ChainRPCURL = "http://localhost:8545" }, "CHAIN_RPC_URL"},
		{"zero factory", func(c *Config) { c.TokenFactoryAddress = "0x0000000000000000000000000000000000000000" }, "TOKEN_FACTORY_ADDRESS"},
		{"raw key", func(c *Config) { c.ChainPrivateKey = "not-a-real-key" }, "CHAIN_PRIVATE_KEY"},
		{"env signer", func(c *Config) { c.ChainSigner = "env" }, "CHAIN_SIGNER=kms"},
		{"unknown signer", func(c *Config) { c.ChainSigner = "other" }, "CHAIN_SIGNER=kms"},
		{"marketplace", func(c *Config) { c.EnableMarketplace = true }, "ENABLE_MARKETPLACE"},
		{"mock kyc", func(c *Config) { c.KYCProvider = "mock" }, "Sumsub"},
		{"kyc websocket scheme", func(c *Config) { c.SumsubBaseURL = "wss://api.sumsub.com" }, "Sumsub"},
		{"unknown custody", func(c *Config) { c.CustodyProvider = "other" }, "Fireblocks"},
		{"custody websocket scheme", func(c *Config) { c.FireblocksBaseURL = "wss://api.fireblocks.io" }, "Fireblocks"},
		{"mock payment", func(c *Config) { c.PaymentProvider = "mock" }, "Stripe"},
		{"wildcard cors", func(c *Config) { c.CORSAllowedOrigins = "*" }, "CORS"},
		{"local cors", func(c *Config) { c.CORSAllowedOrigins = "http://localhost:3000" }, "CORS"},
		{"zero api rate", func(c *Config) { c.RateLimitAPI = 0 }, "RATE_LIMIT_API"},
		{"zero auth rate", func(c *Config) { c.RateLimitAuth = 0 }, "RATE_LIMIT_AUTH"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := productionShapedConfig()
			tt.mutate(&cfg)
			err := cfg.ValidateRuntime("api")
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("expected error containing %q, got %v", tt.want, err)
			}
		})
	}
}

func TestRemoteServiceURLSchemePolicy(t *testing.T) {
	tests := []struct {
		name     string
		raw      string
		schemes  []string
		accepted bool
	}{
		{"NATS TLS", "tls://nats.example.com:4222", []string{"tls"}, true},
		{"NATS plaintext", "nats://nats.example.com:4222", []string{"tls"}, false},
		{"Redis TLS", "rediss://redis.example.com:6379/0", []string{"rediss"}, true},
		{"Redis plaintext", "redis://redis.example.com:6379/0", []string{"rediss"}, false},
		{"HTTPS provider", "https://api.example.com", []string{"https"}, true},
		{"WebSocket not provider HTTPS", "wss://api.example.com", []string{"https"}, false},
		{"chain HTTPS", "https://rpc.example.com", []string{"https", "wss"}, true},
		{"chain WSS", "wss://rpc.example.com", []string{"https", "wss"}, true},
		{"chain HTTP", "http://rpc.example.com", []string{"https", "wss"}, false},
		{"local TLS", "tls://localhost.:4222", []string{"tls"}, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isRemoteURLWithSchemes(tt.raw, tt.schemes...); got != tt.accepted {
				t.Fatalf("isRemoteURLWithSchemes(%q, %v) = %v, want %v", tt.raw, tt.schemes, got, tt.accepted)
			}
		})
	}
}

func TestValidateRuntimeProductionTrimsJWTSecretForValidation(t *testing.T) {
	cfg := productionShapedConfig()
	cfg.JWTSecret = " \t" + strings.Repeat("x", 32) + "\r\n"

	for _, err := range cfg.validateProductionBase() {
		if strings.Contains(err.Error(), "JWT_SECRET") {
			t.Fatalf("expected surrounding whitespace to be ignored when measuring a strong JWT secret, got %v", err)
		}
	}
}

func TestNonGlobalHostnameClassification(t *testing.T) {
	tests := []struct {
		name      string
		host      string
		nonGlobal bool
	}{
		{"remote DNS", "api.example.com", false},
		{"remote DNS root dot", "api.example.com.", false},
		{"public IPv4", "8.8.8.8", false},
		{"public IPv6", "2001:4860:4860::8888", false},
		{"public IPv6 brackets", "[2001:4860:4860::8888]", false},
		{"localhost root dot", "localhost.", true},
		{"localhost subdomain root dot", "api.localhost.", true},
		{"IPv4 link local", "169.254.169.254", true},
		{"IPv6 loopback", "::1", true},
		{"IPv6 loopback brackets", "[::1]", true},
		{"IPv4 unspecified", "0.0.0.0", true},
		{"RFC1918 10", "10.0.0.1", true},
		{"RFC1918 172", "172.16.0.1", true},
		{"RFC1918 192", "192.168.1.1", true},
		{"IPv6 private", "fd00::1", true},
		{"IPv6 link local", "fe80::1", true},
		{"IPv6 multicast", "ff02::1", true},
		{"IPv4 mapped loopback", "::ffff:127.0.0.1", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isNonGlobalHostname(tt.host); got != tt.nonGlobal {
				t.Fatalf("isNonGlobalHostname(%q) = %v, want %v", tt.host, got, tt.nonGlobal)
			}
		})
	}
}

func TestValidateProductionDatabaseURLPolicy(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		wantErr bool
	}{
		{"remote DNS", "postgres://user:strong-password@db.example.com:5432/db?sslmode=verify-full", false},
		{"remote DNS root dot", "postgres://user:strong-password@db.example.com.:5432/db?sslmode=verify-full", false},
		{"public IPv4", "postgres://user:strong-password@8.8.8.8:5432/db?sslmode=verify-full", false},
		{"public IPv6", "postgres://user:strong-password@[2001:4860:4860::8888]:5432/db?sslmode=verify-full", false},
		{"localhost root dot", "postgres://user:strong-password@localhost.:5432/db?sslmode=verify-full", true},
		{"IPv4 link local", "postgres://user:strong-password@169.254.169.254:5432/db?sslmode=verify-full", true},
		{"IPv6 loopback", "postgres://user:strong-password@[::1]:5432/db?sslmode=verify-full", true},
		{"IPv4 unspecified", "postgres://user:strong-password@0.0.0.0:5432/db?sslmode=verify-full", true},
		{"RFC1918 10", "postgres://user:strong-password@10.0.0.1:5432/db?sslmode=verify-full", true},
		{"RFC1918 172", "postgres://user:strong-password@172.16.0.1:5432/db?sslmode=verify-full", true},
		{"RFC1918 192", "postgres://user:strong-password@192.168.1.1:5432/db?sslmode=verify-full", true},
		{"IPv6 private", "postgres://user:strong-password@[fd00::1]:5432/db?sslmode=verify-full", true},
		{"TLS require only", "postgres://user:strong-password@db.example.com:5432/db?sslmode=require", true},
		{"TLS verify CA only", "postgres://user:strong-password@db.example.com:5432/db?sslmode=verify-ca", true},
		{"duplicate TLS modes", "postgres://user:strong-password@db.example.com:5432/db?sslmode=verify-full&sslmode=disable", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateProductionDatabaseURL(tt.raw)
			if (err != nil) != tt.wantErr {
				t.Fatalf("validateProductionDatabaseURL(%q) error = %v, wantErr %v", tt.raw, err, tt.wantErr)
			}
		})
	}
}

func TestValidateRuntimeProductionRejectsNonGlobalServiceEndpoints(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*Config)
		want   string
	}{
		{"database localhost root dot", func(c *Config) { c.DatabaseURL = "postgres://user:pass@localhost.:5432/db?sslmode=verify-full" }, "DATABASE_URL"},
		{"database link local", func(c *Config) { c.DatabaseURL = "postgres://user:pass@169.254.169.254:5432/db?sslmode=verify-full" }, "DATABASE_URL"},
		{"storage private IPv4", func(c *Config) { c.S3Endpoint = "https://192.168.1.20" }, "document storage"},
		{"storage unspecified IPv4", func(c *Config) { c.S3Endpoint = "https://0.0.0.0" }, "document storage"},
		{"chain loopback IPv6", func(c *Config) { c.ChainRPCURL = "https://[::1]" }, "CHAIN_RPC_URL"},
		{"chain private IPv6", func(c *Config) { c.ChainRPCURL = "wss://[fd00::1]" }, "CHAIN_RPC_URL"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := productionShapedConfig()
			tt.mutate(&cfg)
			err := cfg.ValidateRuntime("api")
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("expected error containing %q, got %v", tt.want, err)
			}
		})
	}
}

func TestValidateProductionCORSRequiresRemoteHTTPSOrigins(t *testing.T) {
	tests := []struct {
		name    string
		origins string
		wantErr bool
	}{
		{"remote HTTPS", "https://app.example.com", false},
		{"remote HTTPS with port", "https://app.example.com:8443", false},
		{"multiple remote HTTPS", "https://app.example.com,https://admin.example.com", false},
		{"HTTP", "http://app.example.com", true},
		{"websocket", "wss://app.example.com", true},
		{"localhost root dot", "https://localhost.", true},
		{"IPv4 link local", "https://169.254.169.254", true},
		{"IPv6 loopback", "https://[::1]", true},
		{"IPv4 unspecified", "https://0.0.0.0", true},
		{"RFC1918 private", "https://10.0.0.1", true},
		{"path is not an origin", "https://app.example.com/login", true},
		{"query is not an origin", "https://app.example.com?tenant=one", true},
		{"userinfo is not an origin", "https://user@app.example.com", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateProductionCORS(tt.origins)
			if (len(err) != 0) != tt.wantErr {
				t.Fatalf("validateProductionCORS(%q) errors = %v, wantErr %v", tt.origins, err, tt.wantErr)
			}
		})
	}
}

func TestValidateRuntimeMigrateChecksDatabaseBeforeConnection(t *testing.T) {
	cfg := Config{AppEnv: "production", DatabaseURL: "postgres://migration-user:strong-password@db.internal.example:5432/blockxone?sslmode=verify-full"}
	if err := cfg.ValidateRuntime("migrate"); err != nil {
		t.Fatalf("production migration shape should validate without application-only blockers: %v", err)
	}
	cfg.DatabaseURL = "postgres://blockxone:blockxone@localhost:5432/blockxone?sslmode=disable"
	if err := cfg.ValidateRuntime("migrate"); err == nil || !strings.Contains(err.Error(), "DATABASE_URL") {
		t.Fatalf("expected insecure migration database to fail, got %v", err)
	}
}

func TestValidateRuntimeProductionWorkerUsesLeastPrivilegeContract(t *testing.T) {
	cfg := Config{
		AppEnv:      "production",
		DatabaseURL: "postgres://worker-user:strong-password@db.internal.example:5432/blockxone?sslmode=verify-full",
		NatsURL:     "tls://nats.internal.example:4222",
	}
	if err := cfg.ValidateRuntime("worker"); err != nil {
		t.Fatalf("production worker should require only a secure database and NATS contract: %v", err)
	}

	cfg.NatsURL = "nats://nats.internal.example:4222"
	if err := cfg.ValidateRuntime("worker"); err == nil || !strings.Contains(err.Error(), "NATS_URL") {
		t.Fatalf("expected plaintext worker NATS endpoint to fail, got %v", err)
	}

	cfg.NatsURL = "tls://nats.internal.example:4222"
	cfg.DatabaseURL = "postgres://worker:worker@localhost:5432/blockxone?sslmode=disable"
	if err := cfg.ValidateRuntime("worker"); err == nil || !strings.Contains(err.Error(), "DATABASE_URL") {
		t.Fatalf("expected insecure worker database endpoint to fail, got %v", err)
	}
}

func TestLoadMalformedProductionValuesCannotSilentlyFallBack(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	t.Setenv("ENABLE_MARKETPLACE", "maybe")
	t.Setenv("CHAIN_ID", "not-a-number")
	t.Setenv("RATE_LIMIT_API", "many")

	err := Load().ValidateRuntime("api")
	if err == nil {
		t.Fatal("malformed production values must fail validation")
	}
	for _, key := range []string{"ENABLE_MARKETPLACE", "CHAIN_ID", "RATE_LIMIT_API"} {
		if !strings.Contains(err.Error(), key) {
			t.Fatalf("expected malformed key %s in %v", key, err)
		}
	}
}

func TestLoadExplicitBlankCriticalValuesCannotSilentlyFallBack(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	t.Setenv("AUTH_MODE", " ")
	t.Setenv("DEV_ALLOW_ROLE_OVERRIDE", "")
	t.Setenv("RATE_LIMIT_API", "")

	err := Load().ValidateRuntime("api")
	if err == nil {
		t.Fatal("explicit blank critical values must fail validation")
	}
	for _, key := range []string{"AUTH_MODE", "DEV_ALLOW_ROLE_OVERRIDE", "RATE_LIMIT_API"} {
		if !strings.Contains(err.Error(), key) {
			t.Fatalf("expected blank key %s in %v", key, err)
		}
	}
}

func TestLoadExplicitBlankEnvironmentDoesNotBecomeDevelopment(t *testing.T) {
	t.Setenv("APP_ENV", "")
	err := Load().ValidateRuntime("api")
	if err == nil || !strings.Contains(err.Error(), "APP_ENV") {
		t.Fatalf("expected blank APP_ENV to fail, got %v", err)
	}
}

func TestValidateRuntimeRejectsUnknownEnvironment(t *testing.T) {
	cfg := productionShapedConfig()
	cfg.AppEnv = "prodution"
	if err := cfg.ValidateRuntime("api"); err == nil || !strings.Contains(err.Error(), "APP_ENV") {
		t.Fatalf("expected unknown APP_ENV to fail, got %v", err)
	}
}

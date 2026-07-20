package config

import (
	"os"
	"testing"
)

func unsetEnv(t *testing.T, names ...string) {
	t.Helper()
	for _, name := range names {
		value, existed := os.LookupEnv(name)
		if err := os.Unsetenv(name); err != nil {
			t.Fatalf("unset %s: %v", name, err)
		}
		t.Cleanup(func() {
			var err error
			if existed {
				err = os.Setenv(name, value)
			} else {
				err = os.Unsetenv(name)
			}
			if err != nil {
				t.Errorf("restore %s: %v", name, err)
			}
		})
	}
}

func TestLoad_Defaults(t *testing.T) {
	envVars := []string{
		"APP_ENV", "HTTP_ADDR", "AUTH_MODE", "JWT_SECRET", "DEV_ALLOW_ROLE_OVERRIDE",
		"DATABASE_URL", "NATS_URL", "REDIS_URL", "CORS_ALLOWED_ORIGINS", "RATE_LIMIT_API", "RATE_LIMIT_AUTH",
		"S3_ENDPOINT", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_BUCKET", "S3_REGION", "S3_USE_SSL",
		"CHAIN_MODE", "CHAIN_ID", "CHAIN_RPC_URL", "CHAIN_PRIVATE_KEY", "TOKEN_FACTORY_ADDRESS",
		"ENABLE_MARKETPLACE",
	}
	unsetEnv(t, envVars...)

	cfg := Load()

	if cfg.AppEnv != "dev" {
		t.Errorf("expected AppEnv 'dev', got %q", cfg.AppEnv)
	}
	if cfg.HTTPAddr != ":8080" {
		t.Errorf("expected HTTPAddr ':8080', got %q", cfg.HTTPAddr)
	}
	if cfg.AuthMode != "dev" {
		t.Errorf("expected AuthMode 'dev', got %q", cfg.AuthMode)
	}
	if cfg.JWTSecret != "dev-jwt-secret" {
		t.Errorf("expected JWTSecret 'dev-jwt-secret', got %q", cfg.JWTSecret)
	}
	if !cfg.DevAllowRoleOverride {
		t.Error("expected DevAllowRoleOverride to be true")
	}
	if cfg.DatabaseURL == "" {
		t.Error("expected DatabaseURL to have default value")
	}
	if cfg.CORSAllowedOrigins != "http://localhost:3000,http://localhost:8080" {
		t.Errorf("expected default CORS origins, got %q", cfg.CORSAllowedOrigins)
	}
	if cfg.RateLimitAPI != 60 {
		t.Errorf("expected RateLimitAPI 60, got %d", cfg.RateLimitAPI)
	}
	if cfg.RateLimitAuth != 10 {
		t.Errorf("expected RateLimitAuth 10, got %d", cfg.RateLimitAuth)
	}
	if cfg.S3Bucket != "blockxone-kyc" {
		t.Errorf("expected S3Bucket 'blockxone-kyc', got %q", cfg.S3Bucket)
	}
	if cfg.ChainMode != "mock" {
		t.Errorf("expected ChainMode 'mock', got %q", cfg.ChainMode)
	}
	if cfg.ChainID != 137 {
		t.Errorf("expected ChainID 137, got %d", cfg.ChainID)
	}
	if !cfg.EnableMarketplace {
		t.Error("expected EnableMarketplace to be true")
	}
}

func TestLoad_ProductionLikeDefaults(t *testing.T) {
	envVars := []string{"APP_ENV", "AUTH_MODE", "JWT_SECRET", "DEV_ALLOW_ROLE_OVERRIDE"}
	unsetEnv(t, envVars...)

	t.Setenv("APP_ENV", "production")

	cfg := Load()

	if cfg.AuthMode != "jwt" {
		t.Errorf("expected production-like default AuthMode 'jwt', got %q", cfg.AuthMode)
	}
	if cfg.JWTSecret != "" {
		t.Errorf("expected empty JWTSecret by default in production-like env, got %q", cfg.JWTSecret)
	}
	if cfg.DevAllowRoleOverride {
		t.Error("expected DevAllowRoleOverride to be false in production-like env")
	}
}

func TestLoad_FromEnvironment(t *testing.T) {
	envVars := []string{
		"APP_ENV", "HTTP_ADDR", "AUTH_MODE", "JWT_SECRET", "DEV_ALLOW_ROLE_OVERRIDE",
		"DATABASE_URL", "NATS_URL", "REDIS_URL", "CORS_ALLOWED_ORIGINS", "RATE_LIMIT_API", "RATE_LIMIT_AUTH",
		"S3_ENDPOINT", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_BUCKET", "S3_REGION", "S3_USE_SSL",
		"CHAIN_MODE", "CHAIN_ID", "CHAIN_RPC_URL", "CHAIN_PRIVATE_KEY", "TOKEN_FACTORY_ADDRESS",
		"ENABLE_MARKETPLACE",
	}
	unsetEnv(t, envVars...)

	// Set custom env vars
	t.Setenv("APP_ENV", "production")
	t.Setenv("HTTP_ADDR", ":9000")
	t.Setenv("AUTH_MODE", "jwt")
	t.Setenv("JWT_SECRET", "custom-secret-key")
	t.Setenv("DATABASE_URL", "postgres://prod:pass@prod.db:5432/blockxone")
	t.Setenv("CORS_ALLOWED_ORIGINS", "https://app.blockxone.com")
	t.Setenv("RATE_LIMIT_API", "250")
	t.Setenv("RATE_LIMIT_AUTH", "25")
	t.Setenv("S3_BUCKET", "custom-bucket")
	t.Setenv("CHAIN_MODE", "evm")
	t.Setenv("CHAIN_ID", "1")
	t.Setenv("ENABLE_MARKETPLACE", "false")

	cfg := Load()

	if cfg.AppEnv != "production" {
		t.Errorf("expected AppEnv 'production', got %q", cfg.AppEnv)
	}
	if cfg.HTTPAddr != ":9000" {
		t.Errorf("expected HTTPAddr ':9000', got %q", cfg.HTTPAddr)
	}
	if cfg.AuthMode != "jwt" {
		t.Errorf("expected AuthMode 'jwt', got %q", cfg.AuthMode)
	}
	if cfg.JWTSecret != "custom-secret-key" {
		t.Errorf("expected JWTSecret 'custom-secret-key', got %q", cfg.JWTSecret)
	}
	if cfg.DatabaseURL != "postgres://prod:pass@prod.db:5432/blockxone" {
		t.Errorf("expected custom DatabaseURL, got %q", cfg.DatabaseURL)
	}
	if cfg.CORSAllowedOrigins != "https://app.blockxone.com" {
		t.Errorf("expected custom CORS origins, got %q", cfg.CORSAllowedOrigins)
	}
	if cfg.RateLimitAPI != 250 {
		t.Errorf("expected RateLimitAPI 250, got %d", cfg.RateLimitAPI)
	}
	if cfg.RateLimitAuth != 25 {
		t.Errorf("expected RateLimitAuth 25, got %d", cfg.RateLimitAuth)
	}
	if cfg.S3Bucket != "custom-bucket" {
		t.Errorf("expected S3Bucket 'custom-bucket', got %q", cfg.S3Bucket)
	}
	if cfg.ChainMode != "evm" {
		t.Errorf("expected ChainMode 'evm', got %q", cfg.ChainMode)
	}
	if cfg.ChainID != 1 {
		t.Errorf("expected ChainID 1, got %d", cfg.ChainID)
	}
	if cfg.EnableMarketplace {
		t.Error("expected EnableMarketplace to be false")
	}
}

func TestGetEnvBool_TrueValues(t *testing.T) {
	tests := []struct {
		name     string
		envValue string
		expected bool
	}{
		{"1", "1", true},
		{"true", "true", true},
		{"TRUE", "TRUE", true},
		{"yes", "yes", true},
		{"YES", "YES", true},
		{"y", "y", true},
		{"Y", "Y", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("TEST_BOOL", tt.envValue)

			result := getEnvBool("TEST_BOOL", false)
			if result != tt.expected {
				t.Errorf("expected %v, got %v", tt.expected, result)
			}
		})
	}
}

func TestGetEnvBool_FalseValues(t *testing.T) {
	tests := []struct {
		name     string
		envValue string
		expected bool
	}{
		{"0", "0", false},
		{"false", "false", false},
		{"FALSE", "FALSE", false},
		{"no", "no", false},
		{"NO", "NO", false},
		{"n", "n", false},
		{"N", "N", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("TEST_BOOL", tt.envValue)

			result := getEnvBool("TEST_BOOL", true)
			if result != tt.expected {
				t.Errorf("expected %v, got %v", tt.expected, result)
			}
		})
	}
}

func TestGetEnvBool_DefaultValue(t *testing.T) {
	t.Run("empty env uses default true", func(t *testing.T) {
		unsetEnv(t, "TEST_BOOL_EMPTY")
		result := getEnvBool("TEST_BOOL_EMPTY", true)
		if !result {
			t.Error("expected true as default")
		}
	})

	t.Run("empty env uses default false", func(t *testing.T) {
		unsetEnv(t, "TEST_BOOL_EMPTY")
		result := getEnvBool("TEST_BOOL_EMPTY", false)
		if result {
			t.Error("expected false as default")
		}
	})

	t.Run("invalid value uses default", func(t *testing.T) {
		t.Setenv("TEST_BOOL_INVALID", "maybe")

		result := getEnvBool("TEST_BOOL_INVALID", true)
		if !result {
			t.Error("expected true as default for invalid value")
		}

		result = getEnvBool("TEST_BOOL_INVALID", false)
		if result {
			t.Error("expected false as default for invalid value")
		}
	})
}

func TestGetEnvInt64_Valid(t *testing.T) {
	tests := []struct {
		name     string
		envValue string
		expected int64
	}{
		{"zero", "0", 0},
		{"positive", "42", 42},
		{"negative", "-100", -100},
		{"large", "999999999", 999999999},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("TEST_INT", tt.envValue)

			result := getEnvInt64("TEST_INT", 999)
			if result != tt.expected {
				t.Errorf("expected %d, got %d", tt.expected, result)
			}
		})
	}
}

func TestGetEnvInt64_InvalidUsesDefault(t *testing.T) {
	t.Setenv("TEST_INT_INVALID", "not-a-number")

	result := getEnvInt64("TEST_INT_INVALID", 137)
	if result != 137 {
		t.Errorf("expected default 137, got %d", result)
	}
}

func TestGetEnvInt64_EmptyUsesDefault(t *testing.T) {
	unsetEnv(t, "TEST_INT_EMPTY")

	result := getEnvInt64("TEST_INT_EMPTY", 42)
	if result != 42 {
		t.Errorf("expected default 42, got %d", result)
	}
}

func TestGetEnv_CustomValue(t *testing.T) {
	t.Setenv("TEST_STR", "custom-value")

	result := getEnv("TEST_STR", "default")
	if result != "custom-value" {
		t.Errorf("expected 'custom-value', got %q", result)
	}
}

func TestGetEnv_DefaultValue(t *testing.T) {
	unsetEnv(t, "TEST_STR_EMPTY")

	result := getEnv("TEST_STR_EMPTY", "default-value")
	if result != "default-value" {
		t.Errorf("expected 'default-value', got %q", result)
	}
}

func TestLoad_S3Configuration(t *testing.T) {
	s3Vars := []string{"S3_ENDPOINT", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_BUCKET", "S3_REGION", "S3_USE_SSL"}
	unsetEnv(t, s3Vars...)

	t.Setenv("S3_ENDPOINT", "https://s3.amazonaws.com")
	t.Setenv("S3_BUCKET", "my-bucket")
	t.Setenv("S3_REGION", "us-west-2")
	t.Setenv("S3_USE_SSL", "true")

	cfg := Load()

	if cfg.S3Endpoint != "https://s3.amazonaws.com" {
		t.Errorf("expected custom S3_ENDPOINT, got %q", cfg.S3Endpoint)
	}
	if cfg.S3Bucket != "my-bucket" {
		t.Errorf("expected custom S3_BUCKET, got %q", cfg.S3Bucket)
	}
	if cfg.S3Region != "us-west-2" {
		t.Errorf("expected custom S3_REGION, got %q", cfg.S3Region)
	}
	if !cfg.S3UseSSL {
		t.Error("expected S3UseSSL to be true")
	}
}

func TestLoad_ChainConfiguration(t *testing.T) {
	chainVars := []string{"CHAIN_MODE", "CHAIN_ID", "CHAIN_RPC_URL", "CHAIN_PRIVATE_KEY", "TOKEN_FACTORY_ADDRESS"}
	unsetEnv(t, chainVars...)

	t.Setenv("CHAIN_MODE", "evm")
	t.Setenv("CHAIN_ID", "80001")
	t.Setenv("CHAIN_RPC_URL", "https://rpc.test.com")
	t.Setenv("CHAIN_PRIVATE_KEY", "0xabc123")
	t.Setenv("TOKEN_FACTORY_ADDRESS", "0xfactory123")

	cfg := Load()

	if cfg.ChainMode != "evm" {
		t.Errorf("expected ChainMode 'evm', got %q", cfg.ChainMode)
	}
	if cfg.ChainID != 80001 {
		t.Errorf("expected ChainID 80001, got %d", cfg.ChainID)
	}
	if cfg.ChainRPCURL != "https://rpc.test.com" {
		t.Errorf("expected custom ChainRPCURL, got %q", cfg.ChainRPCURL)
	}
	if cfg.ChainPrivateKey != "0xabc123" {
		t.Errorf("expected custom ChainPrivateKey, got %q", cfg.ChainPrivateKey)
	}
	if cfg.TokenFactoryAddress != "0xfactory123" {
		t.Errorf("expected custom TokenFactoryAddress, got %q", cfg.TokenFactoryAddress)
	}
}

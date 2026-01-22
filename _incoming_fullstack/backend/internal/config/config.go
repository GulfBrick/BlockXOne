package config

import (
	"fmt"
	"os"
)

type Config struct {
	AppEnv   string
	HTTPAddr string

	AuthMode             string
	DevAllowRoleOverride bool

	DatabaseURL string
	NatsURL     string
	RedisURL    string

	S3Endpoint  string
	S3AccessKey string
	S3SecretKey string
	S3Bucket    string
	S3Region    string
	S3UseSSL    bool

	ChainMode string
	ChainID   int64

	EnableMarketplace bool
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

func Load() Config {
	return Config{
		AppEnv:   getEnv("APP_ENV", "dev"),
		HTTPAddr: getEnv("HTTP_ADDR", ":8080"),

		AuthMode:             getEnv("AUTH_MODE", "dev"),
		DevAllowRoleOverride: getEnvBool("DEV_ALLOW_ROLE_OVERRIDE", true),

		DatabaseURL: getEnv("DATABASE_URL", "postgres://blockxone:blockxone@localhost:5432/blockxone?sslmode=disable"),
		NatsURL:     getEnv("NATS_URL", "nats://localhost:4222"),
		RedisURL:    getEnv("REDIS_URL", "redis://localhost:6379/0"),

		S3Endpoint:  getEnv("S3_ENDPOINT", "http://localhost:9000"),
		S3AccessKey: getEnv("S3_ACCESS_KEY", "minioadmin"),
		S3SecretKey: getEnv("S3_SECRET_KEY", "minioadmin"),
		S3Bucket:    getEnv("S3_BUCKET", "blockxone-kyc"),
		S3Region:    getEnv("S3_REGION", "us-east-1"),
		S3UseSSL:    getEnvBool("S3_USE_SSL", false),

		ChainMode: getEnv("CHAIN_MODE", "mock"),
		ChainID:   getEnvInt64("CHAIN_ID", 137),

		EnableMarketplace: getEnvBool("ENABLE_MARKETPLACE", true),
	}
}

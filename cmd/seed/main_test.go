package main

import "testing"

func TestValidateSeedTargetAllowsExplicitLocalDevelopmentOnly(t *testing.T) {
	t.Parallel()

	for _, databaseURL := range []string{
		"postgres://user:pass@localhost:5432/blockxone?sslmode=disable",
		"postgresql://user:pass@127.0.0.1:5432/blockxone?sslmode=disable",
		"postgres://user:pass@[::1]:5432/blockxone?sslmode=disable",
	} {
		if err := validateSeedTarget(" dev ", " TRUE ", databaseURL); err != nil {
			t.Errorf("expected %q to allow explicitly opted-in local seeding: %v", databaseURL, err)
		}
	}
}

func TestValidateSeedTargetRejectsUnsafeInputs(t *testing.T) {
	t.Parallel()

	localURL := "postgres://user:pass@localhost:5432/blockxone?sslmode=disable"
	tests := []struct {
		name         string
		appEnv       string
		allowDevSeed string
		databaseURL  string
	}{
		{"defaulted environment", "", "true", localURL},
		{"production environment", "production", "true", localURL},
		{"missing opt in", "dev", "", localURL},
		{"false opt in", "dev", "false", localURL},
		{"remote hostname", "dev", "true", "postgres://user:pass@db.example.com:5432/blockxone"},
		{"private network address", "dev", "true", "postgres://user:pass@192.168.1.20:5432/blockxone"},
		{"unspecified address", "dev", "true", "postgres://user:pass@0.0.0.0:5432/blockxone"},
		{"non PostgreSQL scheme", "dev", "true", "mysql://user:pass@localhost:3306/blockxone"},
		{"malformed URL", "dev", "true", "://not-a-url"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if err := validateSeedTarget(tt.appEnv, tt.allowDevSeed, tt.databaseURL); err == nil {
				t.Fatal("expected unsafe seed target to be refused")
			}
		})
	}
}

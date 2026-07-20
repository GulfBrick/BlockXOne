package migrate

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestDiscoverSQLFilesExcludesDevelopmentUsersOutsideDev(t *testing.T) {
	t.Parallel()
	dir := migrationFixture(t)

	got, err := DiscoverSQLFiles(dir, "production")
	if err != nil {
		t.Fatalf("DiscoverSQLFiles: %v", err)
	}
	want := []string{"001_init.sql", "002_seed_roles.sql", "007_reference_data.sql"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("production migrations mismatch\nwant: %#v\n got: %#v", want, got)
	}
}

func TestDiscoverSQLFilesPreservesDevelopmentSeedsInDev(t *testing.T) {
	t.Parallel()
	dir := migrationFixture(t)

	got, err := DiscoverSQLFiles(dir, "dev")
	if err != nil {
		t.Fatalf("DiscoverSQLFiles: %v", err)
	}
	want := []string{
		"001_init.sql",
		"002_seed_roles.sql",
		"004_seed_admin.sql",
		"006_seed_dev_users.sql",
		"007_reference_data.sql",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("development migrations mismatch\nwant: %#v\n got: %#v", want, got)
	}
}

func TestRepositoryProductionDiscoveryExcludesKnownCredentialSeeds(t *testing.T) {
	t.Parallel()
	dir := filepath.Join("..", "..", "migrations")
	files, err := DiscoverSQLFiles(dir, "production")
	if err != nil {
		t.Fatalf("DiscoverSQLFiles repository migrations: %v", err)
	}
	rolesPresent := false
	for _, file := range files {
		if file == "004_seed_admin.sql" || file == "006_seed_dev_users.sql" {
			t.Fatalf("development credential migration discovered in production: %s", file)
		}
		if file == "002_seed_roles.sql" {
			rolesPresent = true
		}
	}
	if !rolesPresent {
		t.Fatal("required role/permission reference data was excluded from production")
	}
}

func TestProductionDiscoveryRejectsCredentialSeedUnderUnrecognizedName(t *testing.T) {
	t.Parallel()
	dir := migrationFixture(t)
	credentialSeed := []byte("INSERT INTO users (email, password_hash) VALUES ('operator@example.test', 'known-hash');")
	if err := os.WriteFile(filepath.Join(dir, "008_bootstrap.sql"), credentialSeed, 0o600); err != nil {
		t.Fatalf("write disguised credential seed: %v", err)
	}

	_, err := DiscoverSQLFiles(dir, "production")
	if err == nil || !strings.Contains(err.Error(), "credential seed") {
		t.Fatalf("expected disguised credential seed to fail production discovery, got %v", err)
	}
}

func migrationFixture(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	for _, name := range []string{
		"001_init.sql",
		"002_seed_roles.sql",
		"004_seed_admin.sql",
		"006_seed_dev_users.sql",
		"007_reference_data.sql",
		"README.md",
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("-- fixture"), 0o600); err != nil {
			t.Fatalf("write fixture %s: %v", name, err)
		}
	}
	return dir
}

package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

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

func TestAdminMigrationCreatesDemoOrganizationsBeforeRoleAssignments(t *testing.T) {
	t.Parallel()

	contents, err := os.ReadFile(filepath.Join("..", "..", "migrations", "004_seed_admin.sql"))
	if err != nil {
		t.Fatalf("read admin migration: %v", err)
	}
	sql := strings.ToLower(string(contents))
	orgInsert := strings.Index(sql, "insert into orgs")
	roleInsert := strings.Index(sql, "insert into user_org_roles")
	if orgInsert < 0 {
		t.Fatal("admin migration must create its referenced demo organizations")
	}
	if roleInsert < 0 {
		t.Fatal("admin migration must assign the SuperAdmin role")
	}
	if orgInsert > roleInsert {
		t.Fatal("admin migration assigns a role before creating its referenced organization")
	}

	for _, orgID := range []string{
		"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
		"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
		"cccccccc-cccc-cccc-cccc-cccccccccccc",
		"dddddddd-dddd-dddd-dddd-dddddddddddd",
		"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
	} {
		if !strings.Contains(sql[:roleInsert], orgID) {
			t.Errorf("demo organization %s is not created before role assignment", orgID)
		}
	}
}

func TestSeedDataUsesDatabaseUserIDsForRolesAndInvestorProfile(t *testing.T) {
	t.Parallel()

	usersByEmail := map[string]string{
		"investor@blockxone.local":         "70000000-0000-0000-0000-000000000001",
		"offering.manager@blockxone.local": "70000000-0000-0000-0000-000000000002",
		"compliance@blockxone.local":       "70000000-0000-0000-0000-000000000003",
		"issuer@blockxone.local":           "70000000-0000-0000-0000-000000000004",
		"transfer.agent@blockxone.local":   "70000000-0000-0000-0000-000000000005",
		"token.agent@blockxone.local":      "70000000-0000-0000-0000-000000000006",
		"admin@blockxone.local":            "70000000-0000-0000-0000-000000000009",
	}
	q := newFakeSeedQuerier(usersByEmail)

	if err := seedData(context.Background(), q); err != nil {
		t.Fatalf("seedData: %v", err)
	}

	roleEmail := map[string]string{
		"Investor":          "investor@blockxone.local",
		"OfferingManager":   "offering.manager@blockxone.local",
		"ComplianceOfficer": "compliance@blockxone.local",
		"IssuerFundManager": "issuer@blockxone.local",
		"TransferAgent":     "transfer.agent@blockxone.local",
		"TokenisationAgent": "token.agent@blockxone.local",
		"SuperAdmin":        "admin@blockxone.local",
	}
	assignedRoles := 0
	profileUserID := ""
	for _, call := range q.execCalls {
		switch {
		case strings.Contains(call.sql, "insert into user_org_roles"):
			assignedRoles++
			roleID := call.args[2].(string)
			role := strings.TrimSuffix(roleID, "-role-id")
			wantUserID := usersByEmail[roleEmail[role]]
			if gotUserID := call.args[0]; gotUserID != wantUserID {
				t.Errorf("role %s assigned to %v, want database-returned user ID %s", role, gotUserID, wantUserID)
			}
		case strings.Contains(call.sql, "insert into investor_profile"):
			profileUserID = call.args[0].(string)
		}
	}
	if assignedRoles != len(roleEmail) {
		t.Fatalf("assigned %d roles, want %d", assignedRoles, len(roleEmail))
	}
	if want := usersByEmail["investor@blockxone.local"]; profileUserID != want {
		t.Fatalf("investor profile uses %q, want database-returned user ID %q", profileUserID, want)
	}
	if q.userUpserts != len(usersByEmail) {
		t.Fatalf("executed %d user upserts, want %d", q.userUpserts, len(usersByEmail))
	}
}

func TestSeedDataReturnsUserUpsertFailureBeforeAssigningThatRole(t *testing.T) {
	t.Parallel()

	q := newFakeSeedQuerier(map[string]string{
		"investor@blockxone.local":         "70000000-0000-0000-0000-000000000001",
		"offering.manager@blockxone.local": "70000000-0000-0000-0000-000000000002",
	})
	q.failUserEmail = "compliance@blockxone.local"

	err := seedData(context.Background(), q)
	if err == nil || !strings.Contains(err.Error(), q.failUserEmail) {
		t.Fatalf("expected user upsert failure with email context, got %v", err)
	}
	for _, call := range q.execCalls {
		if strings.Contains(call.sql, "insert into user_org_roles") &&
			call.args[0] == "33333333-3333-3333-3333-333333333333" {
			t.Fatal("seed assigned a role to the fixed UUID after its user upsert failed")
		}
	}
}

type seedCall struct {
	sql  string
	args []any
}

type fakeSeedQuerier struct {
	usersByEmail  map[string]string
	execCalls     []seedCall
	userUpserts   int
	failUserEmail string
}

func newFakeSeedQuerier(usersByEmail map[string]string) *fakeSeedQuerier {
	return &fakeSeedQuerier{usersByEmail: usersByEmail}
}

func (q *fakeSeedQuerier) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	q.execCalls = append(q.execCalls, seedCall{sql: normalizeSQL(sql), args: append([]any(nil), args...)})
	return pgconn.NewCommandTag("INSERT 0 1"), nil
}

func (q *fakeSeedQuerier) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	normalized := normalizeSQL(sql)
	switch {
	case strings.Contains(normalized, "insert into users"):
		q.userUpserts++
		email := args[1].(string)
		if email == q.failUserEmail {
			return fakeSeedRow{err: errors.New("simulated user upsert failure")}
		}
		userID, ok := q.usersByEmail[email]
		if !ok {
			return fakeSeedRow{err: fmt.Errorf("no fake user ID for %s", email)}
		}
		if !strings.Contains(normalized, "on conflict (email)") || !strings.Contains(normalized, "returning id") {
			return fakeSeedRow{err: errors.New("user upsert must resolve conflicts by email and return the persisted ID")}
		}
		return fakeSeedRow{value: userID}
	case strings.Contains(normalized, "select id from roles"):
		return fakeSeedRow{value: args[0].(string) + "-role-id"}
	default:
		return fakeSeedRow{err: fmt.Errorf("unexpected query: %s", normalized)}
	}
}

type fakeSeedRow struct {
	value string
	err   error
}

func (r fakeSeedRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	if len(dest) != 1 {
		return fmt.Errorf("fake row expected one scan destination, got %d", len(dest))
	}
	target, ok := dest[0].(*string)
	if !ok {
		return fmt.Errorf("fake row expected *string destination, got %T", dest[0])
	}
	*target = r.value
	return nil
}

func normalizeSQL(sql string) string {
	return strings.Join(strings.Fields(strings.ToLower(sql)), " ")
}

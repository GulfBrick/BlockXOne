package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"strings"

	"blockxone/internal/config"
	"blockxone/internal/db"
	"blockxone/internal/logging"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"
	"golang.org/x/crypto/bcrypt"
)

type SeedUser struct {
	ID    string
	Email string
	Role  string
}

type seedQuerier interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

func main() {
	cfg := config.Load()
	logging.Init(cfg.AppEnv)
	if err := validateSeedTarget(os.Getenv("APP_ENV"), os.Getenv("ALLOW_DEV_SEED"), cfg.DatabaseURL); err != nil {
		log.Fatal().Err(err).Msg("seed refused")
	}

	ctx := context.Background()
	d, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatal().Err(err).Msg("db connect failed")
	}
	defer d.Close()

	if err := seedDatabase(ctx, d.Pool); err != nil {
		log.Fatal().Err(err).Msg("seed failed")
	}

	fmt.Println("seed completed")
}

func seedDatabase(ctx context.Context, pool *pgxpool.Pool) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin seed transaction: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	if err := seedData(ctx, tx); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit seed transaction: %w", err)
	}
	return nil
}

func seedData(ctx context.Context, q seedQuerier) error {
	platformOrgID := "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
	issuerOrgID := "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
	transferOrgID := "cccccccc-cccc-cccc-cccc-cccccccccccc"
	tokenOrgID := "dddddddd-dddd-dddd-dddd-dddddddddddd"
	investorOrgID := "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"

	orgs := []struct {
		id, name, typ string
	}{
		{platformOrgID, "BlockXOne Platform", "PLATFORM"},
		{issuerOrgID, "Example Issuer Co", "ISSUER"},
		{transferOrgID, "Example Transfer Agent", "AGENT"},
		{tokenOrgID, "Example Tokenisation Agent", "AGENT"},
		{investorOrgID, "Example Investor Org", "INVESTOR_ORG"},
	}

	for _, o := range orgs {
		if _, err := q.Exec(ctx, `
			INSERT INTO orgs(id,name,type) VALUES($1,$2,$3)
			ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, type=EXCLUDED.type
		`, o.id, o.name, o.typ); err != nil {
			return fmt.Errorf("seed organization %q: %w", o.name, err)
		}
	}

	users := []SeedUser{
		{ID: "11111111-1111-1111-1111-111111111111", Email: "investor@blockxone.local", Role: "Investor"},
		{ID: "22222222-2222-2222-2222-222222222222", Email: "offering.manager@blockxone.local", Role: "OfferingManager"},
		{ID: "33333333-3333-3333-3333-333333333333", Email: "compliance@blockxone.local", Role: "ComplianceOfficer"},
		{ID: "44444444-4444-4444-4444-444444444444", Email: "issuer@blockxone.local", Role: "IssuerFundManager"},
		{ID: "55555555-5555-5555-5555-555555555555", Email: "transfer.agent@blockxone.local", Role: "TransferAgent"},
		{ID: "66666666-6666-6666-6666-666666666666", Email: "token.agent@blockxone.local", Role: "TokenisationAgent"},
		{ID: "99999999-9999-9999-9999-999999999999", Email: "admin@blockxone.local", Role: "SuperAdmin"},
	}

	// All seeded local demo users share the same password for reproducible dev login flows.
	demoPasswordHash, err := bcrypt.GenerateFromPassword([]byte("Admin123!"), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("hash demo password: %w", err)
	}

	userIDs := make(map[string]string, len(users))
	for _, u := range users {
		var userID string
		if err := q.QueryRow(ctx, `
			INSERT INTO users(id,email,password_hash,status) VALUES($1,$2,$3,'ACTIVE')
			ON CONFLICT (email) DO UPDATE SET
				password_hash=EXCLUDED.password_hash,
				status='ACTIVE'
			RETURNING id
		`, u.ID, u.Email, string(demoPasswordHash)).Scan(&userID); err != nil {
			return fmt.Errorf("seed user %q: %w", u.Email, err)
		}
		userIDs[u.Email] = userID

		// Determine org by role (simple dev mapping)
		orgID := platformOrgID
		switch u.Role {
		case "Investor":
			orgID = investorOrgID
		case "OfferingManager":
			orgID = platformOrgID
		case "ComplianceOfficer":
			orgID = platformOrgID
		case "IssuerFundManager":
			orgID = issuerOrgID
		case "TransferAgent":
			orgID = transferOrgID
		case "TokenisationAgent":
			orgID = tokenOrgID
		case "SuperAdmin":
			orgID = platformOrgID
		}

		var roleID string
		if err := q.QueryRow(ctx, `
			SELECT id FROM roles WHERE name=$1
		`, u.Role).Scan(&roleID); err != nil {
			return fmt.Errorf("load role %q for %q: %w", u.Role, u.Email, err)
		}
		if _, err := q.Exec(ctx, `
			INSERT INTO user_org_roles(user_id,org_id,role_id)
			VALUES($1,$2,$3)
			ON CONFLICT DO NOTHING
		`, userID, orgID, roleID); err != nil {
			return fmt.Errorf("assign role %q to %q: %w", u.Role, u.Email, err)
		}
	}

	// Investor profile defaults
	investorUserID := userIDs["investor@blockxone.local"]
	if investorUserID == "" {
		return errors.New("seed investor user ID was not returned")
	}
	if _, err := q.Exec(ctx, `
		INSERT INTO investor_profile(user_id, investor_status, accredited_flag, qualified_flag, jurisdiction)
		VALUES($1,'RETAIL', false, false, 'US')
		ON CONFLICT (user_id) DO NOTHING
	`, investorUserID); err != nil {
		return fmt.Errorf("seed investor profile: %w", err)
	}
	return nil
}

func validateSeedTarget(appEnv, allowDevSeed, databaseURL string) error {
	if !strings.EqualFold(strings.TrimSpace(appEnv), "dev") {
		return errors.New("development seed command requires APP_ENV=dev to be set explicitly")
	}
	if !strings.EqualFold(strings.TrimSpace(allowDevSeed), "true") {
		return errors.New("development seed command requires ALLOW_DEV_SEED=true")
	}

	databaseURL = strings.TrimSpace(databaseURL)
	parsed, err := url.Parse(databaseURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return errors.New("development seed command requires a valid PostgreSQL URL")
	}
	if !strings.EqualFold(parsed.Scheme, "postgres") && !strings.EqualFold(parsed.Scheme, "postgresql") {
		return errors.New("development seed command only supports PostgreSQL URLs")
	}

	hostname := strings.TrimSpace(parsed.Hostname())
	if hostname == "" {
		return errors.New("development seed command requires a database hostname")
	}
	if !strings.EqualFold(hostname, "localhost") {
		ip := net.ParseIP(hostname)
		if ip == nil || !ip.IsLoopback() {
			return errors.New("development seed command only permits a loopback database")
		}
	}

	return nil
}

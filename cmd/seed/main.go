package main

import (
	"context"
	"fmt"

	"blockxone/internal/config"
	"blockxone/internal/db"
	"blockxone/internal/logging"

	"github.com/rs/zerolog/log"
	"golang.org/x/crypto/bcrypt"
)

type SeedUser struct {
	ID    string
	Email string
	Role  string
}

func main() {
	cfg := config.Load()
	logging.Init(cfg.AppEnv)

	ctx := context.Background()
	d, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatal().Err(err).Msg("db connect failed")
	}
	defer d.Close()

	// Orgs
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
		_, _ = d.Pool.Exec(ctx, `
			INSERT INTO orgs(id,name,type) VALUES($1,$2,$3)
			ON CONFLICT (id) DO NOTHING
		`, o.id, o.name, o.typ)
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

	// Create admin password hash for Admin123!
	adminPasswordHash, err := bcrypt.GenerateFromPassword([]byte("Admin123!"), bcrypt.DefaultCost)
	if err != nil {
		log.Fatal().Err(err).Msg("failed to hash admin password")
	}

	for _, u := range users {
		// Set password hash only for admin user
		passwordHash := ""
		if u.Email == "admin@blockxone.local" {
			passwordHash = string(adminPasswordHash)
		}

		if passwordHash != "" {
			_, _ = d.Pool.Exec(ctx, `
				INSERT INTO users(id,email,password_hash,status) VALUES($1,$2,$3,'ACTIVE')
				ON CONFLICT (id) DO UPDATE SET password_hash=$3, email=$2, status='ACTIVE'
			`, u.ID, u.Email, passwordHash)
		} else {
			_, _ = d.Pool.Exec(ctx, `
				INSERT INTO users(id,email,status) VALUES($1,$2,'ACTIVE')
				ON CONFLICT (id) DO UPDATE SET email=$2, status='ACTIVE'
			`, u.ID, u.Email)
		}

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

		_, err = d.Pool.Exec(ctx, `
			INSERT INTO user_org_roles(user_id,org_id,role_id)
			SELECT $1, $2, r.id FROM roles r WHERE r.name=$3
			ON CONFLICT DO NOTHING
		`, u.ID, orgID, u.Role)
		if err != nil {
			log.Fatal().Err(err).Str("role", u.Role).Msg("assign role failed")
		}
	}

	// Investor profile defaults
	_, _ = d.Pool.Exec(ctx, `
		INSERT INTO investor_profile(user_id, investor_status, accredited_flag, qualified_flag, jurisdiction)
		VALUES($1,'RETAIL', false, false, 'US')
		ON CONFLICT (user_id) DO NOTHING
	`, "11111111-1111-1111-1111-111111111111")

	fmt.Println("seed completed")
}

package main

import (
	"net/http"
	"strconv"
	"time"

	"blockxone/internal/audit"
	"blockxone/internal/auth"
	"blockxone/internal/ethsig"
	"blockxone/internal/events"
	"blockxone/internal/policy"

	"blockxone/internal/app"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
)

// RegisterRoutes wires the MVP endpoints.
// All endpoints are under /v1 except /healthz.
func RegisterRoutes(r *gin.Engine, a *app.App) {
	r.GET("/healthz", func(c *gin.Context) {
		c.JSON(200, gin.H{"ok": true, "service": "blockxone-api"})
	})

	// Lightweight in-browser API console (dev only).
	registerDevConsole(r, a)

	v1 := r.Group("/v1")
	{
		v1.GET("/me", func(c *gin.Context) {
			p := auth.MustPrincipal(c)
			c.JSON(200, p)
		})

		v1.GET("/health", func(c *gin.Context) {
			c.JSON(200, gin.H{"ok": true, "service": "blockxone-api"})
		})

		// --- Compliance / KYC ---
		v1.POST("/kyc/cases", func(c *gin.Context) {
			p := auth.MustPrincipal(c)

			var req struct {
				Type     string `json:"type"`      // KYC|KYB
				CaseType string `json:"case_type"` // compatibility with frontend
			}
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
				return
			}
			typ := req.Type
			if typ == "" {
				typ = req.CaseType
			}
			if typ != "KYC" && typ != "KYB" {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
				return
			}

			var id string
			row := a.DB.Pool.QueryRow(c.Request.Context(), `
				INSERT INTO kyc_cases(user_id,type,status) VALUES($1,$2,'DRAFT')
				RETURNING id
			`, p.UserID, typ)
			if err := row.Scan(&id); err != nil {
				c.JSON(500, gin.H{"error": "db error"})
				return
			}

			_ = audit.Log(c.Request.Context(), a.DB.Pool, p.UserID, "KYC_CASE_CREATED", "kyc_cases", id, nil, req, c.ClientIP())
			_, _ = events.Enqueue(c.Request.Context(), a.DB.Pool, "KYC_CASE_CREATED", gin.H{"kyc_case_id": id, "user_id": p.UserID})

			c.JSON(201, gin.H{"id": id, "status": "DRAFT"})
		})

		v1.POST("/kyc/cases/:id/submit", func(c *gin.Context) {
			p := auth.MustPrincipal(c)
			caseID := c.Param("id")
			if _, err := uuid.Parse(caseID); err != nil {
				c.JSON(400, gin.H{"error": "invalid case id"})
				return
			}

			cmd, err := a.DB.Pool.Exec(c.Request.Context(), `
				UPDATE kyc_cases SET status='SUBMITTED', submitted_at=now(), updated_at=now()
				WHERE id=$1 AND user_id=$2 AND status IN ('DRAFT','REJECTED')
			`, caseID, p.UserID)
			if err != nil || cmd.RowsAffected() == 0 {
				c.JSON(400, gin.H{"error": "cannot submit case"})
				return
			}

			_ = audit.Log(c.Request.Context(), a.DB.Pool, p.UserID, "KYC_SUBMITTED", "kyc_cases", caseID, nil, gin.H{"status": "SUBMITTED"}, c.ClientIP())
			_, _ = events.Enqueue(c.Request.Context(), a.DB.Pool, "KYC_SUBMITTED", gin.H{"kyc_case_id": caseID, "user_id": p.UserID})
			c.JSON(200, gin.H{"id": caseID, "status": "SUBMITTED"})
		})

		v1.GET("/compliance/queue", auth.RequirePermission("compliance:queue:view"), func(c *gin.Context) {
			rows, err := a.DB.Pool.Query(c.Request.Context(), `
				SELECT id, user_id, type, status, submitted_at, created_at
				FROM kyc_cases
				WHERE status='SUBMITTED'
				ORDER BY submitted_at ASC NULLS LAST, created_at ASC
				LIMIT 200
			`)
			if err != nil {
				c.JSON(500, gin.H{"error": "db error"})
				return
			}
			defer rows.Close()
			var out []gin.H
			for rows.Next() {
				var id, userID, typ, status string
				var submittedAt *time.Time
				var createdAt time.Time
				if err := rows.Scan(&id, &userID, &typ, &status, &submittedAt, &createdAt); err != nil {
					c.JSON(500, gin.H{"error": "scan error"})
					return
				}
				out = append(out, gin.H{
					"id": id, "user_id": userID, "type": typ, "status": status,
					"submitted_at": submittedAt, "created_at": createdAt,
				})
			}
			c.JSON(200, out)
		})

		v1.POST("/compliance/cases/:id/approve", auth.RequirePermission("compliance:case:approve"), func(c *gin.Context) {
			p := auth.MustPrincipal(c)
			caseID := c.Param("id")
			if _, err := uuid.Parse(caseID); err != nil {
				c.JSON(400, gin.H{"error": "invalid case id"})
				return
			}

			// Approve the case
			cmd, err := a.DB.Pool.Exec(c.Request.Context(), `
				UPDATE kyc_cases SET status='APPROVED', updated_at=now()
				WHERE id=$1 AND status='SUBMITTED'
			`, caseID)
			if err != nil || cmd.RowsAffected() == 0 {
				c.JSON(400, gin.H{"error": "cannot approve case"})
				return
			}

			// Find user_id for profile update
			var userID string
			row := a.DB.Pool.QueryRow(c.Request.Context(), `SELECT user_id FROM kyc_cases WHERE id=$1`, caseID)
			if err := row.Scan(&userID); err != nil {
				c.JSON(500, gin.H{"error": "db error"})
				return
			}

			// Minimal investor profile update (in real life this is based on vendor data)
			_, _ = a.DB.Pool.Exec(c.Request.Context(), `
				INSERT INTO investor_profile(user_id, investor_status, accredited_flag, qualified_flag, jurisdiction)
				VALUES($1,'APPROVED', false, false, 'US')
				ON CONFLICT (user_id) DO UPDATE
				SET investor_status='APPROVED', updated_at=now()
			`, userID)

			_ = audit.Log(c.Request.Context(), a.DB.Pool, p.UserID, "KYC_APPROVED", "kyc_cases", caseID, nil, gin.H{"status": "APPROVED"}, c.ClientIP())
			_, _ = events.Enqueue(c.Request.Context(), a.DB.Pool, "KYC_APPROVED", gin.H{"kyc_case_id": caseID, "user_id": userID})
			c.JSON(200, gin.H{"id": caseID, "status": "APPROVED"})
		})

		v1.POST("/compliance/cases/:id/reject", auth.RequirePermission("compliance:case:approve"), func(c *gin.Context) {
			p := auth.MustPrincipal(c)
			caseID := c.Param("id")
			if _, err := uuid.Parse(caseID); err != nil {
				c.JSON(400, gin.H{"error": "invalid case id"})
				return
			}
			cmd, err := a.DB.Pool.Exec(c.Request.Context(), `
				UPDATE kyc_cases SET status='REJECTED', updated_at=now()
				WHERE id=$1 AND status='SUBMITTED'
			`, caseID)
			if err != nil || cmd.RowsAffected() == 0 {
				c.JSON(400, gin.H{"error": "cannot reject case"})
				return
			}
			_ = audit.Log(c.Request.Context(), a.DB.Pool, p.UserID, "KYC_REJECTED", "kyc_cases", caseID, nil, gin.H{"status": "REJECTED"}, c.ClientIP())
			_, _ = events.Enqueue(c.Request.Context(), a.DB.Pool, "KYC_REJECTED", gin.H{"kyc_case_id": caseID})
			c.JSON(200, gin.H{"id": caseID, "status": "REJECTED"})
		})

		// --- Wallet connect + approve ---

		// --- Frontend compatibility aliases (UI expects /kyc/cases/*) ---
		v1.GET("/kyc/cases/:id", func(c *gin.Context) {
			p := auth.MustPrincipal(c)
			caseID := c.Param("id")
			if _, err := uuid.Parse(caseID); err != nil {
				c.JSON(400, gin.H{"error": "invalid case id"})
				return
			}
			var userID, typ, status string
			var submittedAt *time.Time
			err := a.DB.Pool.QueryRow(c.Request.Context(), `
		SELECT user_id, type, status, submitted_at
		FROM kyc_cases
		WHERE id=$1
	`, caseID).Scan(&userID, &typ, &status, &submittedAt)
			if err != nil {
				c.JSON(404, gin.H{"error": "not found"})
				return
			}
			if userID != p.UserID && !auth.HasPermission(p, "compliance:queue:view") && !auth.HasPermission(p, "compliance:case:approve") {
				c.JSON(403, gin.H{"error": "forbidden"})
				return
			}
			c.JSON(200, gin.H{"id": caseID, "user_id": userID, "type": typ, "status": status, "submitted_at": submittedAt})
		})

		v1.POST("/kyc/cases/:id/approve", auth.RequirePermission("compliance:case:approve"), func(c *gin.Context) {
			p := auth.MustPrincipal(c)
			caseID := c.Param("id")
			if _, err := uuid.Parse(caseID); err != nil {
				c.JSON(400, gin.H{"error": "invalid case id"})
				return
			}
			cmd, err := a.DB.Pool.Exec(c.Request.Context(), `
		UPDATE kyc_cases SET status='APPROVED', reviewed_by=$2, reviewed_at=now(), updated_at=now()
		WHERE id=$1 AND status='SUBMITTED'
	`, caseID, p.UserID)
			if err != nil || cmd.RowsAffected() == 0 {
				c.JSON(400, gin.H{"error": "cannot approve case"})
				return
			}
			var userID string
			_ = a.DB.Pool.QueryRow(c.Request.Context(), `SELECT user_id FROM kyc_cases WHERE id=$1`, caseID).Scan(&userID)
			_, _ = a.DB.Pool.Exec(c.Request.Context(), `
		INSERT INTO investor_profile(user_id, investor_status, accredited_flag, qualified_flag, jurisdiction)
		VALUES($1,'APPROVED',false,false,'NA')
		ON CONFLICT (user_id) DO UPDATE SET investor_status='APPROVED', updated_at=now()
	`, userID)

			_ = audit.Log(c.Request.Context(), a.DB.Pool, p.UserID, "KYC_APPROVED", "kyc_cases", caseID, nil, gin.H{"status": "APPROVED"}, c.ClientIP())
			_, _ = events.Enqueue(c.Request.Context(), a.DB.Pool, "KYC_APPROVED", gin.H{"kyc_case_id": caseID, "user_id": userID})
			c.JSON(200, gin.H{"id": caseID, "status": "APPROVED"})
		})

		v1.POST("/kyc/cases/:id/reject", auth.RequirePermission("compliance:case:approve"), func(c *gin.Context) {
			p := auth.MustPrincipal(c)
			caseID := c.Param("id")
			if _, err := uuid.Parse(caseID); err != nil {
				c.JSON(400, gin.H{"error": "invalid case id"})
				return
			}
			var req struct {
				Reason string `json:"reason"`
			}
			_ = c.ShouldBindJSON(&req)
			cmd, err := a.DB.Pool.Exec(c.Request.Context(), `
		UPDATE kyc_cases SET status='REJECTED', reviewed_by=$2, reviewed_at=now(), updated_at=now()
		WHERE id=$1 AND status='SUBMITTED'
	`, caseID, p.UserID)
			if err != nil || cmd.RowsAffected() == 0 {
				c.JSON(400, gin.H{"error": "cannot reject case"})
				return
			}
			var userID string
			_ = a.DB.Pool.QueryRow(c.Request.Context(), `SELECT user_id FROM kyc_cases WHERE id=$1`, caseID).Scan(&userID)
			_ = audit.Log(c.Request.Context(), a.DB.Pool, p.UserID, "KYC_REJECTED", "kyc_cases", caseID, nil, gin.H{"status": "REJECTED", "reason": req.Reason}, c.ClientIP())
			_, _ = events.Enqueue(c.Request.Context(), a.DB.Pool, "KYC_REJECTED", gin.H{"kyc_case_id": caseID, "user_id": userID, "reason": req.Reason})
			c.JSON(200, gin.H{"id": caseID, "status": "REJECTED"})
		})

		v1.POST("/wallets/connect", func(c *gin.Context) {
			p := auth.MustPrincipal(c)

			var req struct {
				Address    string `json:"address"`
				ChainID    int64  `json:"chain_id"`
				ChainIDAlt int64  `json:"chainId"` // frontend compatibility
				Message    string `json:"message"`
				Signature  string `json:"signature"`
			}
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
				return
			}
			if req.ChainID == 0 {
				req.ChainID = req.ChainIDAlt
			}
			if req.Address == "" || req.ChainID == 0 || req.Message == "" || req.Signature == "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
				return
			}

			// Dev escape hatch: signature="devskip"
			if req.Signature != "devskip" {
				if err := ethsig.VerifyPersonalSign(req.Message, req.Signature, req.Address); err != nil {
					c.JSON(400, gin.H{"error": "signature verification failed"})
					return
				}
			}

			var walletID string
			row := a.DB.Pool.QueryRow(c.Request.Context(), `
				INSERT INTO wallets(user_id,address,chain_id,status,signed_message,message)
				VALUES($1,$2,$3,'PENDING',$4,$5)
				ON CONFLICT (user_id,address,chain_id) DO UPDATE
				SET signed_message=EXCLUDED.signed_message, message=EXCLUDED.message
				RETURNING id
			`, p.UserID, req.Address, req.ChainID, req.Signature, req.Message)
			if err := row.Scan(&walletID); err != nil {
				c.JSON(500, gin.H{"error": "db error"})
				return
			}

			_ = audit.Log(c.Request.Context(), a.DB.Pool, p.UserID, "WALLET_CONNECTED", "wallets", walletID, nil, req, c.ClientIP())
			_, _ = events.Enqueue(c.Request.Context(), a.DB.Pool, "WALLET_CONNECTED", gin.H{"wallet_id": walletID, "user_id": p.UserID})
			c.JSON(201, gin.H{"id": walletID, "status": "PENDING"})
		})

		v1.POST("/wallets/:id/approve", auth.RequirePermission("wallet:approve"), func(c *gin.Context) {
			p := auth.MustPrincipal(c)
			walletID := c.Param("id")
			if _, err := uuid.Parse(walletID); err != nil {
				c.JSON(400, gin.H{"error": "invalid wallet id"})
				return
			}

			// Check KYC approved for wallet owner
			var userID string
			var chainID int64
			row := a.DB.Pool.QueryRow(c.Request.Context(), `SELECT user_id, chain_id FROM wallets WHERE id=$1`, walletID)
			if err := row.Scan(&userID, &chainID); err != nil {
				c.JSON(404, gin.H{"error": "wallet not found"})
				return
			}
			dec, err := policy.CanApproveWallet(c.Request.Context(), a.DB.Pool, userID)
			if err != nil {
				c.JSON(500, gin.H{"error": "policy error"})
				return
			}
			if !dec.Allowed {
				c.JSON(400, gin.H{"error": "wallet owner not eligible", "reasons": dec.Reasons})
				return
			}

			cmd, err := a.DB.Pool.Exec(c.Request.Context(), `
				UPDATE wallets
				SET status='APPROVED', approved_by=$2, approved_at=now()
				WHERE id=$1
			`, walletID, p.UserID)
			if err != nil || cmd.RowsAffected() == 0 {
				c.JSON(500, gin.H{"error": "db error"})
				return
			}
			_ = audit.Log(c.Request.Context(), a.DB.Pool, p.UserID, "WALLET_APPROVED", "wallets", walletID, nil, gin.H{"status": "APPROVED"}, c.ClientIP())
			_, _ = events.Enqueue(c.Request.Context(), a.DB.Pool, "WALLET_APPROVED", gin.H{"wallet_id": walletID, "user_id": userID})
			c.JSON(200, gin.H{"id": walletID, "status": "APPROVED"})
		})

		v1.POST("/wallets/:id/reject", auth.RequirePermission("wallet:approve"), func(c *gin.Context) {
			p := auth.MustPrincipal(c)
			walletID := c.Param("id")
			if _, err := uuid.Parse(walletID); err != nil {
				c.JSON(400, gin.H{"error": "invalid wallet id"})
				return
			}
			cmd, err := a.DB.Pool.Exec(c.Request.Context(), `
				UPDATE wallets SET status='REJECTED', approved_by=$2, approved_at=now()
				WHERE id=$1
			`, walletID, p.UserID)
			if err != nil || cmd.RowsAffected() == 0 {
				c.JSON(500, gin.H{"error": "db error"})
				return
			}
			_ = audit.Log(c.Request.Context(), a.DB.Pool, p.UserID, "WALLET_REJECTED", "wallets", walletID, nil, gin.H{"status": "REJECTED"}, c.ClientIP())
			_, _ = events.Enqueue(c.Request.Context(), a.DB.Pool, "WALLET_REJECTED", gin.H{"wallet_id": walletID})
			c.JSON(200, gin.H{"id": walletID, "status": "REJECTED"})
		})

		// --- Offerings ---
		v1.POST("/offerings", auth.RequirePermission("offering:create"), func(c *gin.Context) {
			p := auth.MustPrincipal(c)
			var req struct {
				AssetType              string  `json:"asset_type"`
				Name                   string  `json:"name"`
				Description            string  `json:"description"`
				ChainID                int64   `json:"chain_id"`
				ChainIDAlt             int64   `json:"chainId"` // frontend compatibility
				Price                  string  `json:"price"`
				PriceNumber            float64 `json:"priceNumber"`  // optional
				CurrencyCode           string  `json:"currencyCode"` // frontend compatibility
				Currency               string  `json:"currency"`
				TransferAgentOrgID     string  `json:"transfer_agent_org_id"`
				TokenisationAgentOrgID string  `json:"tokenisation_agent_org_id"`
			}
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(400, gin.H{"error": "invalid request"})
				return
			}
			if req.AssetType == "" {
				req.AssetType = "FUND"
			}
			if req.ChainID == 0 {
				req.ChainID = req.ChainIDAlt
			}
			if req.Currency == "" {
				req.Currency = req.CurrencyCode
			}
			if req.Price == "" && req.PriceNumber > 0 {
				req.Price = strconv.FormatFloat(req.PriceNumber, 'f', 2, 64)
			}
			if req.Name == "" {
				c.JSON(400, gin.H{"error": "invalid request"})
				return
			}

			tx, err := a.DB.Pool.Begin(c.Request.Context())
			if err != nil {
				c.JSON(500, gin.H{"error": "db error"})
				return
			}
			defer func() { _ = tx.Rollback(c.Request.Context()) }()

			var assetID string
			row := tx.QueryRow(c.Request.Context(), `
				INSERT INTO assets(asset_type,name,description) VALUES($1,$2,$3)
				RETURNING id
			`, req.AssetType, req.Name, req.Description)
			if err := row.Scan(&assetID); err != nil {
				c.JSON(500, gin.H{"error": "db error"})
				return
			}

			var offeringID string
			row = tx.QueryRow(c.Request.Context(), `
				INSERT INTO offerings(asset_id,status,chain_id,price,currency)
				VALUES($1,'DRAFT',$2, NULLIF($3,'')::numeric, NULLIF($4,''))
				RETURNING id
			`, assetID, req.ChainID, req.Price, req.Currency)
			if err := row.Scan(&offeringID); err != nil {
				c.JSON(500, gin.H{"error": "db error"})
				return
			}

			_, _ = tx.Exec(c.Request.Context(), `
				INSERT INTO offering_agents(offering_id, transfer_agent_org_id, tokenisation_agent_org_id, offering_manager_user_id)
				VALUES($1, NULLIF($2,'')::uuid, NULLIF($3,'')::uuid, $4)
				ON CONFLICT (offering_id) DO UPDATE
				SET transfer_agent_org_id=EXCLUDED.transfer_agent_org_id,
				    tokenisation_agent_org_id=EXCLUDED.tokenisation_agent_org_id,
				    offering_manager_user_id=EXCLUDED.offering_manager_user_id
			`, offeringID, req.TransferAgentOrgID, req.TokenisationAgentOrgID, p.UserID)

			if err := tx.Commit(c.Request.Context()); err != nil {
				c.JSON(500, gin.H{"error": "db error"})
				return
			}

			_ = audit.Log(c.Request.Context(), a.DB.Pool, p.UserID, "OFFERING_CREATED", "offerings", offeringID, nil, req, c.ClientIP())
			_, _ = events.Enqueue(c.Request.Context(), a.DB.Pool, "OFFERING_CREATED", gin.H{"offering_id": offeringID})

			c.JSON(201, gin.H{"id": offeringID, "status": "DRAFT"})
		})

		v1.PUT("/offerings/:id", auth.RequirePermission("offering:edit"), func(c *gin.Context) {
			p := auth.MustPrincipal(c)
			offeringID := c.Param("id")
			if _, err := uuid.Parse(offeringID); err != nil {
				c.JSON(400, gin.H{"error": "invalid offering id"})
				return
			}

			var req struct {
				Price    string `json:"price"`
				Currency string `json:"currency"`
				Status   string `json:"status"` // ignored
			}
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(400, gin.H{"error": "invalid request"})
				return
			}

			cmd, err := a.DB.Pool.Exec(c.Request.Context(), `
				UPDATE offerings
				SET price = COALESCE(NULLIF($2,'')::numeric, price),
				    currency = COALESCE(NULLIF($3,''), currency),
				    updated_at=now()
				WHERE id=$1
			`, offeringID, req.Price, req.Currency)
			if err != nil || cmd.RowsAffected() == 0 {
				c.JSON(400, gin.H{"error": "cannot update offering"})
				return
			}
			_ = audit.Log(c.Request.Context(), a.DB.Pool, p.UserID, "OFFERING_UPDATED", "offerings", offeringID, nil, req, c.ClientIP())
			_, _ = events.Enqueue(c.Request.Context(), a.DB.Pool, "OFFERING_UPDATED", gin.H{"offering_id": offeringID})
			c.JSON(200, gin.H{"id": offeringID})
		})

		v1.POST("/offerings/:id/publish", auth.RequirePermission("offering:publish"), func(c *gin.Context) {
			p := auth.MustPrincipal(c)
			offeringID := c.Param("id")
			if _, err := uuid.Parse(offeringID); err != nil {
				c.JSON(400, gin.H{"error": "invalid offering id"})
				return
			}
			cmd, err := a.DB.Pool.Exec(c.Request.Context(), `
				UPDATE offerings SET status='LIVE', updated_at=now()
				WHERE id=$1 AND status='DRAFT'
			`, offeringID)
			if err != nil || cmd.RowsAffected() == 0 {
				c.JSON(400, gin.H{"error": "cannot publish offering"})
				return
			}
			_ = audit.Log(c.Request.Context(), a.DB.Pool, p.UserID, "OFFERING_PUBLISHED", "offerings", offeringID, nil, gin.H{"status": "LIVE"}, c.ClientIP())
			_, _ = events.Enqueue(c.Request.Context(), a.DB.Pool, "OFFERING_PUBLISHED", gin.H{"offering_id": offeringID})
			c.JSON(200, gin.H{"id": offeringID, "status": "LIVE"})
		})

		v1.GET("/offerings", func(c *gin.Context) {
			rows, err := a.DB.Pool.Query(c.Request.Context(), `
				SELECT o.id, o.status, o.chain_id, o.price, o.currency, a.asset_type, a.name, a.description
				FROM offerings o
				JOIN assets a ON a.id=o.asset_id
				WHERE o.status='LIVE'
				ORDER BY o.created_at DESC
				LIMIT 200
			`)
			if err != nil {
				c.JSON(500, gin.H{"error": "db error"})
				return
			}
			defer rows.Close()

			var out []gin.H
			for rows.Next() {
				var id, status, currency, assetType, name, desc string
				var chainID *int64
				var price *string
				if err := rows.Scan(&id, &status, &chainID, &price, &currency, &assetType, &name, &desc); err != nil {
					c.JSON(500, gin.H{"error": "scan error"})
					return
				}
				out = append(out, gin.H{
					"id": id, "status": status, "chain_id": chainID, "price": price, "currency": currency,
					"asset_type": assetType, "name": name, "description": desc,
				})
			}
			c.JSON(200, out)
		})

		// --- Subscription + payments ---
		v1.POST("/offerings/:id/subscribe", func(c *gin.Context) {
			p := auth.MustPrincipal(c)
			offeringID := c.Param("id")
			if _, err := uuid.Parse(offeringID); err != nil {
				c.JSON(400, gin.H{"error": "invalid offering id"})
				return
			}

			var req struct {
				Units  string `json:"units"`
				Amount string `json:"amount"`
			}
			if err := c.ShouldBindJSON(&req); err != nil || req.Units == "" || req.Amount == "" {
				c.JSON(400, gin.H{"error": "invalid request"})
				return
			}

			// Load offering chain_id
			var chainID int64
			row := a.DB.Pool.QueryRow(c.Request.Context(), `SELECT chain_id FROM offerings WHERE id=$1 AND status='LIVE'`, offeringID)
			if err := row.Scan(&chainID); err != nil {
				c.JSON(404, gin.H{"error": "offering not found"})
				return
			}

			dec, err := policy.CanSubscribe(c.Request.Context(), a.DB.Pool, p.UserID, chainID)
			if err != nil {
				c.JSON(500, gin.H{"error": "policy error"})
				return
			}
			if !dec.Allowed {
				c.JSON(403, gin.H{"error": "not eligible to subscribe", "reasons": dec.Reasons})
				return
			}

			var subID string
			row = a.DB.Pool.QueryRow(c.Request.Context(), `
				INSERT INTO subscriptions(offering_id,user_id,units,amount,status)
				VALUES($1,$2,$3::numeric,$4::numeric,'REQUESTED')
				ON CONFLICT (offering_id, user_id) DO UPDATE
				SET units=EXCLUDED.units, amount=EXCLUDED.amount, updated_at=now()
				RETURNING id
			`, offeringID, p.UserID, req.Units, req.Amount)
			if err := row.Scan(&subID); err != nil {
				c.JSON(500, gin.H{"error": "db error"})
				return
			}

			// Create payment instruction if missing
			_, _ = a.DB.Pool.Exec(c.Request.Context(), `
				INSERT INTO payment_instructions(subscription_id, method, bank_ref, due_at)
				VALUES($1,'BANK', 'BX1-'||substring($1::text,1,8), now() + interval '7 day')
				ON CONFLICT DO NOTHING
			`, subID)

			_ = audit.Log(c.Request.Context(), a.DB.Pool, p.UserID, "SUBSCRIPTION_REQUESTED", "subscriptions", subID, nil, req, c.ClientIP())
			_, _ = events.Enqueue(c.Request.Context(), a.DB.Pool, "SUBSCRIPTION_REQUESTED", gin.H{"subscription_id": subID, "offering_id": offeringID, "user_id": p.UserID})

			c.JSON(201, gin.H{"id": subID, "status": "REQUESTED"})
		})

		v1.POST("/subscriptions/:id/approve", auth.RequirePermission("subscription:approve"), func(c *gin.Context) {
			p := auth.MustPrincipal(c)
			subID := c.Param("id")
			if _, err := uuid.Parse(subID); err != nil {
				c.JSON(400, gin.H{"error": "invalid subscription id"})
				return
			}

			// Approve subscription
			cmd, err := a.DB.Pool.Exec(c.Request.Context(), `
				UPDATE subscriptions SET status='APPROVED', updated_at=now()
				WHERE id=$1 AND status='REQUESTED'
			`, subID)
			if err != nil || cmd.RowsAffected() == 0 {
				c.JSON(400, gin.H{"error": "cannot approve subscription"})
				return
			}

			// Determine offering + user to create whitelist request
			var offeringID string
			var userID string
			row := a.DB.Pool.QueryRow(c.Request.Context(), `SELECT offering_id, user_id FROM subscriptions WHERE id=$1`, subID)
			if err := row.Scan(&offeringID, &userID); err != nil {
				c.JSON(500, gin.H{"error": "db error"})
				return
			}

			// Find approved wallet for chain
			var walletID string
			row = a.DB.Pool.QueryRow(c.Request.Context(), `
				SELECT w.id
				FROM wallets w
				JOIN offerings o ON o.id=$1
				WHERE w.user_id=$2 AND w.chain_id=o.chain_id AND w.status='APPROVED'
				LIMIT 1
			`, offeringID, userID)
			_ = row.Scan(&walletID)

			if walletID != "" {
				_, _ = a.DB.Pool.Exec(c.Request.Context(), `
					INSERT INTO whitelist_requests(offering_id,wallet_id,status,requested_by,approved_by)
					VALUES($1,$2,'REQUESTED',$3,$3)
					ON CONFLICT (offering_id,wallet_id) DO NOTHING
				`, offeringID, walletID, p.UserID)
				_, _ = events.Enqueue(c.Request.Context(), a.DB.Pool, "WHITELIST_REQUESTED", gin.H{"offering_id": offeringID, "wallet_id": walletID})
			}

			_ = audit.Log(c.Request.Context(), a.DB.Pool, p.UserID, "SUBSCRIPTION_APPROVED", "subscriptions", subID, nil, gin.H{"status": "APPROVED"}, c.ClientIP())
			_, _ = events.Enqueue(c.Request.Context(), a.DB.Pool, "SUBSCRIPTION_APPROVED", gin.H{"subscription_id": subID, "offering_id": offeringID, "user_id": userID})

			c.JSON(200, gin.H{"id": subID, "status": "APPROVED"})
		})

		v1.GET("/subscriptions/:id/payment-instructions", func(c *gin.Context) {
			p := auth.MustPrincipal(c)
			subID := c.Param("id")
			if _, err := uuid.Parse(subID); err != nil {
				c.JSON(400, gin.H{"error": "invalid subscription id"})
				return
			}

			// Owner or privileged roles can view; MVP: owner only
			var ownerID string
			row := a.DB.Pool.QueryRow(c.Request.Context(), `SELECT user_id FROM subscriptions WHERE id=$1`, subID)
			if err := row.Scan(&ownerID); err != nil {
				c.JSON(404, gin.H{"error": "not found"})
				return
			}
			if ownerID != p.UserID && !p.Permissions["payment:notify"] {
				c.JSON(403, gin.H{"error": "forbidden"})
				return
			}

			row = a.DB.Pool.QueryRow(c.Request.Context(), `
				SELECT method, bank_ref, wallet_address, due_at
				FROM payment_instructions
				WHERE subscription_id=$1
				ORDER BY created_at DESC
				LIMIT 1
			`, subID)
			var method, bankRef, walletAddr *string
			var dueAt *time.Time
			if err := row.Scan(&method, &bankRef, &walletAddr, &dueAt); err != nil {
				c.JSON(404, gin.H{"error": "no payment instructions"})
				return
			}
			c.JSON(200, gin.H{"method": method, "bank_ref": bankRef, "wallet_address": walletAddr, "due_at": dueAt})
		})

		v1.POST("/payments/notify", auth.RequirePermission("payment:notify"), func(c *gin.Context) {
			p := auth.MustPrincipal(c)
			var req struct {
				SubscriptionID string `json:"subscription_id"`
				Method         string `json:"method"`
				Amount         string `json:"amount"`
				Reference      string `json:"reference"`
			}
			if err := c.ShouldBindJSON(&req); err != nil || req.SubscriptionID == "" || req.Amount == "" {
				c.JSON(400, gin.H{"error": "invalid request"})
				return
			}
			if _, err := uuid.Parse(req.SubscriptionID); err != nil {
				c.JSON(400, gin.H{"error": "invalid subscription id"})
				return
			}

			// Insert payment
			var payID string
			row := a.DB.Pool.QueryRow(c.Request.Context(), `
				INSERT INTO payments(subscription_id, method, amount, received_at, reference, status)
				VALUES($1, COALESCE(NULLIF($2,''),'BANK'), $3::numeric, now(), $4, 'RECEIVED')
				RETURNING id
			`, req.SubscriptionID, req.Method, req.Amount, req.Reference)
			if err := row.Scan(&payID); err != nil {
				c.JSON(500, gin.H{"error": "db error"})
				return
			}

			// Update subscription status to PAID if not rejected/cancelled
			_, _ = a.DB.Pool.Exec(c.Request.Context(), `
				UPDATE subscriptions
				SET status = CASE
					WHEN status IN ('REQUESTED','APPROVED') THEN 'PAID'
					ELSE status
				END,
				updated_at=now()
				WHERE id=$1
			`, req.SubscriptionID)

			_ = audit.Log(c.Request.Context(), a.DB.Pool, p.UserID, "PAYMENT_RECEIVED", "payments", payID, nil, req, c.ClientIP())
			_, _ = events.Enqueue(c.Request.Context(), a.DB.Pool, "PAYMENT_RECEIVED", gin.H{"payment_id": payID, "subscription_id": req.SubscriptionID})

			c.JSON(201, gin.H{"id": payID, "status": "RECEIVED"})
		})

		v1.POST("/reconciliation/run", auth.RequirePermission("payment:notify"), func(c *gin.Context) {
			c.JSON(200, gin.H{"status": "ok", "note": "MVP stub - implement bank reconciliation here"})
		})

		// --- Whitelisting & token ops ---
		v1.POST("/whitelist-requests/:id/execute", auth.RequirePermission("tokenops:whitelist"), func(c *gin.Context) {
			p := auth.MustPrincipal(c)
			reqID := c.Param("id")
			if _, err := uuid.Parse(reqID); err != nil {
				c.JSON(400, gin.H{"error": "invalid whitelist request id"})
				return
			}

			// Load request + wallet address
			var offeringID, walletID, walletAddr string
			row := a.DB.Pool.QueryRow(c.Request.Context(), `
				SELECT wr.offering_id, wr.wallet_id, w.address
				FROM whitelist_requests wr
				JOIN wallets w ON w.id = wr.wallet_id
				WHERE wr.id=$1 AND wr.status IN ('REQUESTED','FAILED')
			`, reqID)
			if err := row.Scan(&offeringID, &walletID, &walletAddr); err != nil {
				c.JSON(404, gin.H{"error": "whitelist request not found or not executable"})
				return
			}

			// Execute on chain (mock)
			txHash, err := a.Chain.Whitelist(c.Request.Context(), offeringID, walletAddr)
			if err != nil {
				c.JSON(500, gin.H{"error": "chain error"})
				return
			}

			_, _ = a.DB.Pool.Exec(c.Request.Context(), `
				UPDATE whitelist_requests SET status='CONFIRMED', updated_at=now(), approved_by=$2
				WHERE id=$1
			`, reqID, p.UserID)

			_ = audit.Log(c.Request.Context(), a.DB.Pool, p.UserID, "WHITELIST_CONFIRMED", "whitelist_requests", reqID, nil, gin.H{"tx_hash": txHash}, c.ClientIP())
			_, _ = events.Enqueue(c.Request.Context(), a.DB.Pool, "WHITELISTED_ONCHAIN", gin.H{"whitelist_request_id": reqID, "offering_id": offeringID, "wallet_id": walletID, "tx_hash": txHash})

			c.JSON(200, gin.H{"id": reqID, "status": "CONFIRMED", "tx_hash": txHash})
		})

		v1.POST("/token-batches/mint", auth.RequirePermission("tokenops:mint"), func(c *gin.Context) {
			p := auth.MustPrincipal(c)
			var req struct {
				SubscriptionID string `json:"subscription_id"`
			}
			if err := c.ShouldBindJSON(&req); err != nil || req.SubscriptionID == "" {
				c.JSON(400, gin.H{"error": "invalid request"})
				return
			}
			if _, err := uuid.Parse(req.SubscriptionID); err != nil {
				c.JSON(400, gin.H{"error": "invalid subscription id"})
				return
			}

			// Load subscription + wallet
			var offeringID, userID string
			var units string
			row := a.DB.Pool.QueryRow(c.Request.Context(), `SELECT offering_id, user_id, units::text FROM subscriptions WHERE id=$1`, req.SubscriptionID)
			if err := row.Scan(&offeringID, &userID, &units); err != nil {
				c.JSON(404, gin.H{"error": "subscription not found"})
				return
			}

			// Must be PAID
			var status string
			row = a.DB.Pool.QueryRow(c.Request.Context(), `SELECT status FROM subscriptions WHERE id=$1`, req.SubscriptionID)
			_ = row.Scan(&status)
			if status != "PAID" && status != "APPROVED" {
				c.JSON(400, gin.H{"error": "subscription not paid/approved", "status": status})
				return
			}

			// Find wallet + confirmed whitelist
			var walletID, walletAddr string
			row = a.DB.Pool.QueryRow(c.Request.Context(), `
				SELECT w.id, w.address
				FROM wallets w
				JOIN offerings o ON o.id=$1
				WHERE w.user_id=$2 AND w.chain_id=o.chain_id AND w.status='APPROVED'
				LIMIT 1
			`, offeringID, userID)
			if err := row.Scan(&walletID, &walletAddr); err != nil {
				c.JSON(400, gin.H{"error": "no approved wallet"})
				return
			}
			var whitelisted bool
			row = a.DB.Pool.QueryRow(c.Request.Context(), `
				SELECT EXISTS(
					SELECT 1 FROM whitelist_requests
					WHERE offering_id=$1 AND wallet_id=$2 AND status='CONFIRMED'
				)
			`, offeringID, walletID)
			_ = row.Scan(&whitelisted)
			if !whitelisted {
				c.JSON(400, gin.H{"error": "wallet not whitelisted"})
				return
			}

			// Create batch + item
			var batchID string
			row = a.DB.Pool.QueryRow(c.Request.Context(), `
				INSERT INTO token_batches(offering_id,type,status,created_by)
				VALUES($1,'MINT','EXECUTING',$2)
				RETURNING id
			`, offeringID, p.UserID)
			_ = row.Scan(&batchID)

			var itemID string
			row = a.DB.Pool.QueryRow(c.Request.Context(), `
				INSERT INTO token_batch_items(batch_id,wallet_id,amount,status)
				VALUES($1,$2,$3::numeric,'EXECUTING')
				RETURNING id
			`, batchID, walletID, units)
			_ = row.Scan(&itemID)

			txHash, err := a.Chain.Mint(c.Request.Context(), offeringID, walletAddr, units)
			if err != nil {
				_, _ = a.DB.Pool.Exec(c.Request.Context(), `UPDATE token_batches SET status='FAILED', updated_at=now() WHERE id=$1`, batchID)
				c.JSON(500, gin.H{"error": "chain error"})
				return
			}

			// Record chain tx
			_, _ = a.DB.Pool.Exec(c.Request.Context(), `
				INSERT INTO chain_transactions(batch_item_id, chain_id, tx_hash, status, confirmations)
				VALUES($1, (SELECT chain_id FROM offerings WHERE id=$2), $3, 'CONFIRMED', 1)
			`, itemID, offeringID, txHash)

			// Update holdings
			_, _ = a.DB.Pool.Exec(c.Request.Context(), `
				INSERT INTO holdings(user_id,offering_id,wallet_id,balance)
				VALUES($1,$2,$3,$4::numeric)
				ON CONFLICT (user_id,offering_id,wallet_id) DO UPDATE
				SET balance = holdings.balance + EXCLUDED.balance,
				    updated_at=now()
			`, userID, offeringID, walletID, units)

			// Mark subscription minted
			_, _ = a.DB.Pool.Exec(c.Request.Context(), `
				UPDATE subscriptions SET status='MINTED', updated_at=now()
				WHERE id=$1
			`, req.SubscriptionID)

			// Close batch
			_, _ = a.DB.Pool.Exec(c.Request.Context(), `UPDATE token_batch_items SET status='CONFIRMED', updated_at=now() WHERE id=$1`, itemID)
			_, _ = a.DB.Pool.Exec(c.Request.Context(), `UPDATE token_batches SET status='CONFIRMED', updated_at=now() WHERE id=$1`, batchID)

			_ = audit.Log(c.Request.Context(), a.DB.Pool, p.UserID, "TOKENS_MINTED", "token_batches", batchID, nil, gin.H{"tx_hash": txHash}, c.ClientIP())
			_, _ = events.Enqueue(c.Request.Context(), a.DB.Pool, "TOKENS_DISTRIBUTED", gin.H{"subscription_id": req.SubscriptionID, "tx_hash": txHash, "offering_id": offeringID, "user_id": userID})

			c.JSON(200, gin.H{"batch_id": batchID, "tx_hash": txHash})
		})

		v1.POST("/token-batches/burn", auth.RequirePermission("tokenops:burn"), func(c *gin.Context) {
			p := auth.MustPrincipal(c)
			var req struct {
				RedemptionID string `json:"redemption_id"`
			}
			if err := c.ShouldBindJSON(&req); err != nil || req.RedemptionID == "" {
				c.JSON(400, gin.H{"error": "invalid request"})
				return
			}
			if _, err := uuid.Parse(req.RedemptionID); err != nil {
				c.JSON(400, gin.H{"error": "invalid redemption id"})
				return
			}

			// Load redemption + wallet
			var offeringID, userID string
			var amountTokens string
			var status string
			row := a.DB.Pool.QueryRow(c.Request.Context(), `SELECT offering_id, user_id, amount_tokens::text, status FROM redemptions WHERE id=$1`, req.RedemptionID)
			if err := row.Scan(&offeringID, &userID, &amountTokens, &status); err != nil {
				c.JSON(404, gin.H{"error": "redemption not found"})
				return
			}
			if status != "APPROVED" {
				c.JSON(400, gin.H{"error": "redemption not approved", "status": status})
				return
			}

			// Find wallet + holdings row
			var walletID, walletAddr string
			row = a.DB.Pool.QueryRow(c.Request.Context(), `
				SELECT h.wallet_id, w.address
				FROM holdings h
				JOIN wallets w ON w.id=h.wallet_id
				WHERE h.user_id=$1 AND h.offering_id=$2
				ORDER BY h.updated_at DESC
				LIMIT 1
			`, userID, offeringID)
			if err := row.Scan(&walletID, &walletAddr); err != nil {
				c.JSON(400, gin.H{"error": "no holdings wallet"})
				return
			}

			txHash, err := a.Chain.Burn(c.Request.Context(), offeringID, walletAddr, amountTokens)
			if err != nil {
				c.JSON(500, gin.H{"error": "chain error"})
				return
			}

			// Create batch + item
			var batchID string
			row = a.DB.Pool.QueryRow(c.Request.Context(), `
				INSERT INTO token_batches(offering_id,type,status,created_by)
				VALUES($1,'BURN','CONFIRMED',$2)
				RETURNING id
			`, offeringID, p.UserID)
			_ = row.Scan(&batchID)

			var itemID string
			row = a.DB.Pool.QueryRow(c.Request.Context(), `
				INSERT INTO token_batch_items(batch_id,wallet_id,amount,status)
				VALUES($1,$2,$3::numeric,'CONFIRMED')
				RETURNING id
			`, batchID, walletID, amountTokens)
			_ = row.Scan(&itemID)

			_, _ = a.DB.Pool.Exec(c.Request.Context(), `
				INSERT INTO chain_transactions(batch_item_id, chain_id, tx_hash, status, confirmations)
				VALUES($1, (SELECT chain_id FROM offerings WHERE id=$2), $3, 'CONFIRMED', 1)
			`, itemID, offeringID, txHash)

			// Update holdings (subtract)
			_, _ = a.DB.Pool.Exec(c.Request.Context(), `
				UPDATE holdings
				SET balance = balance - $4::numeric,
				    updated_at=now()
				WHERE user_id=$1 AND offering_id=$2 AND wallet_id=$3
			`, userID, offeringID, walletID, amountTokens)

			// Mark redemption burn confirmed
			_, _ = a.DB.Pool.Exec(c.Request.Context(), `
				UPDATE redemptions SET status='BURN_CONFIRMED', updated_at=now()
				WHERE id=$1
			`, req.RedemptionID)

			// Create payout placeholder
			var payoutID string
			row = a.DB.Pool.QueryRow(c.Request.Context(), `
				INSERT INTO payouts(user_id, method, amount, status, reference)
				VALUES($1,'OFFCHAIN', COALESCE((SELECT amount_cash FROM redemptions WHERE id=$2), 0), 'PENDING', 'REDEEM-'||substring($2::text,1,8))
				RETURNING id
			`, userID, req.RedemptionID)
			_ = row.Scan(&payoutID)

			_ = audit.Log(c.Request.Context(), a.DB.Pool, p.UserID, "BURN_CONFIRMED", "redemptions", req.RedemptionID, nil, gin.H{"tx_hash": txHash}, c.ClientIP())
			_, _ = events.Enqueue(c.Request.Context(), a.DB.Pool, "BURN_CONFIRMED", gin.H{"redemption_id": req.RedemptionID, "payout_id": payoutID, "tx_hash": txHash})

			c.JSON(200, gin.H{"batch_id": batchID, "tx_hash": txHash, "payout_id": payoutID})
		})

		v1.POST("/token-batches/freeze", auth.RequirePermission("tokenops:freeze"), func(c *gin.Context) {
			p := auth.MustPrincipal(c)
			var req struct {
				OfferingID    string `json:"offering_id"`
				WalletAddress string `json:"wallet_address"`
				Freeze        bool   `json:"freeze"`
			}
			if err := c.ShouldBindJSON(&req); err != nil || req.OfferingID == "" || req.WalletAddress == "" {
				c.JSON(400, gin.H{"error": "invalid request"})
				return
			}
			if _, err := uuid.Parse(req.OfferingID); err != nil {
				c.JSON(400, gin.H{"error": "invalid offering id"})
				return
			}

			txHash, err := a.Chain.Freeze(c.Request.Context(), req.OfferingID, req.WalletAddress, req.Freeze)
			if err != nil {
				c.JSON(500, gin.H{"error": "chain error"})
				return
			}

			_ = audit.Log(c.Request.Context(), a.DB.Pool, p.UserID, "FREEZE_UPDATED", "offerings", req.OfferingID, nil, req, c.ClientIP())
			_, _ = events.Enqueue(c.Request.Context(), a.DB.Pool, "FREEZE_UPDATED", gin.H{"offering_id": req.OfferingID, "wallet_address": req.WalletAddress, "freeze": req.Freeze, "tx_hash": txHash})

			c.JSON(200, gin.H{"tx_hash": txHash})
		})

		v1.POST("/token-batches/force-transfer", auth.RequirePermission("tokenops:force_transfer"), func(c *gin.Context) {
			p := auth.MustPrincipal(c)
			var req struct {
				OfferingID string `json:"offering_id"`
				FromWallet string `json:"from_wallet"`
				ToWallet   string `json:"to_wallet"`
				Amount     string `json:"amount"`
			}
			if err := c.ShouldBindJSON(&req); err != nil || req.OfferingID == "" || req.FromWallet == "" || req.ToWallet == "" || req.Amount == "" {
				c.JSON(400, gin.H{"error": "invalid request"})
				return
			}

			txHash, err := a.Chain.ForceTransfer(c.Request.Context(), req.OfferingID, req.FromWallet, req.ToWallet, req.Amount)
			if err != nil {
				c.JSON(500, gin.H{"error": "chain error"})
				return
			}

			// MVP ledger update: attempt to map wallet addresses to holdings rows and adjust balances.
			// In production, this should be driven by on-chain indexer events.
			_, _ = a.DB.Pool.Exec(c.Request.Context(), `
				INSERT INTO transfers(offering_id, from_wallet, to_wallet, amount, tx_hash, occurred_at)
				VALUES($1,$2,$3,$4::numeric,$5,now())
			`, req.OfferingID, req.FromWallet, req.ToWallet, req.Amount, txHash)

			_ = audit.Log(c.Request.Context(), a.DB.Pool, p.UserID, "FORCE_TRANSFER_EXECUTED", "offerings", req.OfferingID, nil, req, c.ClientIP())
			_, _ = events.Enqueue(c.Request.Context(), a.DB.Pool, "TRANSFER_DETECTED_ONCHAIN", gin.H{"offering_id": req.OfferingID, "tx_hash": txHash})

			c.JSON(200, gin.H{"tx_hash": txHash})
		})

		v1.GET("/tx/:hash/status", func(c *gin.Context) {
			hash := c.Param("hash")
			row := a.DB.Pool.QueryRow(c.Request.Context(), `
				SELECT status, confirmations, error
				FROM chain_transactions
				WHERE tx_hash=$1
				ORDER BY created_at DESC
				LIMIT 1
			`, hash)
			var status string
			var conf int
			var errMsg *string
			if err := row.Scan(&status, &conf, &errMsg); err != nil {
				c.JSON(404, gin.H{"error": "tx not found"})
				return
			}
			c.JSON(200, gin.H{"tx_hash": hash, "status": status, "confirmations": conf, "error": errMsg})
		})

		// --- Portfolio / cap table ---
		v1.GET("/portfolio", auth.RequirePermission("ledger:portfolio:view"), func(c *gin.Context) {
			p := auth.MustPrincipal(c)
			rows, err := a.DB.Pool.Query(c.Request.Context(), `
				SELECT h.offering_id, h.wallet_id, h.balance::text, a.name
				FROM holdings h
				JOIN offerings o ON o.id=h.offering_id
				JOIN assets a ON a.id=o.asset_id
				WHERE h.user_id=$1
				ORDER BY h.updated_at DESC
			`, p.UserID)
			if err != nil {
				c.JSON(500, gin.H{"error": "db error"})
				return
			}
			defer rows.Close()

			var out []gin.H
			for rows.Next() {
				var offeringID, walletID, balance, name string
				if err := rows.Scan(&offeringID, &walletID, &balance, &name); err != nil {
					c.JSON(500, gin.H{"error": "scan error"})
					return
				}
				out = append(out, gin.H{"offering_id": offeringID, "wallet_id": walletID, "balance": balance, "offering_name": name})
			}
			c.JSON(200, out)
		})

		v1.GET("/cap-table/:offering_id", auth.RequirePermission("ledger:cap_table:view"), func(c *gin.Context) {
			offeringID := c.Param("offering_id")
			if _, err := uuid.Parse(offeringID); err != nil {
				c.JSON(400, gin.H{"error": "invalid offering id"})
				return
			}
			rows, err := a.DB.Pool.Query(c.Request.Context(), `
				SELECT u.email, w.address, h.balance::text
				FROM holdings h
				JOIN users u ON u.id=h.user_id
				JOIN wallets w ON w.id=h.wallet_id
				WHERE h.offering_id=$1
				ORDER BY h.balance DESC
			`, offeringID)
			if err != nil {
				c.JSON(500, gin.H{"error": "db error"})
				return
			}
			defer rows.Close()

			var out []gin.H
			for rows.Next() {
				var email, addr, bal string
				if err := rows.Scan(&email, &addr, &bal); err != nil {
					c.JSON(500, gin.H{"error": "scan error"})
					return
				}
				out = append(out, gin.H{"investor": email, "wallet": addr, "balance": bal})
			}
			c.JSON(200, out)
		})

		v1.GET("/statements", func(c *gin.Context) {
			c.JSON(200, gin.H{"status": "ok", "note": "MVP stub - implement PDF statements later"})
		})

		// --- Corporate actions ---
		v1.POST("/distributions", auth.RequirePermission("corpactions:distribution:create"), func(c *gin.Context) {
			p := auth.MustPrincipal(c)
			var req struct {
				OfferingID  string `json:"offering_id"`
				RecordDate  string `json:"record_date"` // YYYY-MM-DD
				TotalAmount string `json:"total_amount"`
			}
			if err := c.ShouldBindJSON(&req); err != nil || req.OfferingID == "" || req.RecordDate == "" || req.TotalAmount == "" {
				c.JSON(400, gin.H{"error": "invalid request"})
				return
			}

			// Create distribution
			var distID string
			row := a.DB.Pool.QueryRow(c.Request.Context(), `
				INSERT INTO distributions(offering_id, record_date, total_amount, status, created_by)
				VALUES($1, $2::date, $3::numeric, 'PAYOUTS_PENDING', $4)
				RETURNING id
			`, req.OfferingID, req.RecordDate, req.TotalAmount, p.UserID)
			if err := row.Scan(&distID); err != nil {
				c.JSON(500, gin.H{"error": "db error"})
				return
			}

			// Allocate pro-rata from current holdings (MVP)
			// total_supply = sum balances
			var totalSupplyStr string
			row = a.DB.Pool.QueryRow(c.Request.Context(), `
				SELECT COALESCE(SUM(balance),0)::text FROM holdings WHERE offering_id=$1
			`, req.OfferingID)
			_ = row.Scan(&totalSupplyStr)

			// naive allocation: each holder gets (balance/totalSupply)*totalAmount
			// in SQL for MVP
			_, _ = a.DB.Pool.Exec(c.Request.Context(), `
				INSERT INTO distribution_items(distribution_id,user_id,amount,status)
				SELECT $1, h.user_id,
					CASE
						WHEN (SELECT COALESCE(SUM(balance),0) FROM holdings WHERE offering_id=$2) = 0 THEN 0
						ELSE ($3::numeric) * (h.balance / (SELECT SUM(balance) FROM holdings WHERE offering_id=$2))
					END AS amount,
					'PENDING'
				FROM holdings h
				WHERE h.offering_id=$2
			`, distID, req.OfferingID, req.TotalAmount)

			_ = audit.Log(c.Request.Context(), a.DB.Pool, p.UserID, "DISTRIBUTION_CREATED", "distributions", distID, nil, req, c.ClientIP())
			_, _ = events.Enqueue(c.Request.Context(), a.DB.Pool, "DISTRIBUTION_CREATED", gin.H{"distribution_id": distID})

			c.JSON(201, gin.H{"id": distID, "status": "PAYOUTS_PENDING"})
		})

		v1.POST("/redemptions/request", func(c *gin.Context) {
			p := auth.MustPrincipal(c)
			var req struct {
				OfferingID   string `json:"offering_id"`
				AmountTokens string `json:"amount_tokens"`
				AmountCash   string `json:"amount_cash"`
			}
			if err := c.ShouldBindJSON(&req); err != nil || req.OfferingID == "" || req.AmountTokens == "" {
				c.JSON(400, gin.H{"error": "invalid request"})
				return
			}

			var id string
			row := a.DB.Pool.QueryRow(c.Request.Context(), `
				INSERT INTO redemptions(offering_id,user_id,amount_tokens,amount_cash,status)
				VALUES($1,$2,$3::numeric,NULLIF($4,'')::numeric,'REQUESTED')
				RETURNING id
			`, req.OfferingID, p.UserID, req.AmountTokens, req.AmountCash)
			if err := row.Scan(&id); err != nil {
				c.JSON(500, gin.H{"error": "db error"})
				return
			}
			_ = audit.Log(c.Request.Context(), a.DB.Pool, p.UserID, "REDEMPTION_REQUESTED", "redemptions", id, nil, req, c.ClientIP())
			_, _ = events.Enqueue(c.Request.Context(), a.DB.Pool, "REDEMPTION_REQUESTED", gin.H{"redemption_id": id})
			c.JSON(201, gin.H{"id": id, "status": "REQUESTED"})
		})

		v1.POST("/redemptions/:id/approve", auth.RequirePermission("corpactions:redemption:approve"), func(c *gin.Context) {
			p := auth.MustPrincipal(c)
			id := c.Param("id")
			if _, err := uuid.Parse(id); err != nil {
				c.JSON(400, gin.H{"error": "invalid redemption id"})
				return
			}
			cmd, err := a.DB.Pool.Exec(c.Request.Context(), `
				UPDATE redemptions SET status='APPROVED', updated_at=now()
				WHERE id=$1 AND status='REQUESTED'
			`, id)
			if err != nil || cmd.RowsAffected() == 0 {
				c.JSON(400, gin.H{"error": "cannot approve redemption"})
				return
			}
			_ = audit.Log(c.Request.Context(), a.DB.Pool, p.UserID, "REDEMPTION_APPROVED", "redemptions", id, nil, gin.H{"status": "APPROVED"}, c.ClientIP())
			_, _ = events.Enqueue(c.Request.Context(), a.DB.Pool, "REDEMPTION_APPROVED", gin.H{"redemption_id": id})
			c.JSON(200, gin.H{"id": id, "status": "APPROVED"})
		})

		v1.POST("/payouts/execute", auth.RequirePermission("corpactions:payout:execute"), func(c *gin.Context) {
			p := auth.MustPrincipal(c)

			// Execute pending payouts (MVP marks as sent)
			cmd, err := a.DB.Pool.Exec(c.Request.Context(), `
				UPDATE payouts
				SET status='SENT', updated_at=now()
				WHERE status='PENDING'
			`)
			if err != nil {
				c.JSON(500, gin.H{"error": "db error"})
				return
			}
			_ = audit.Log(c.Request.Context(), a.DB.Pool, p.UserID, "PAYOUTS_EXECUTED", "payouts", "", nil, gin.H{"rows": cmd.RowsAffected()}, c.ClientIP())

			// Update redemptions linked by reference prefix (MVP heuristic)
			_, _ = a.DB.Pool.Exec(c.Request.Context(), `
				UPDATE redemptions
				SET status='COMPLETED', updated_at=now()
				WHERE status='BURN_CONFIRMED'
			`)

			c.JSON(200, gin.H{"status": "ok", "payouts_marked_sent": cmd.RowsAffected()})
		})

		// --- Marketplace RFQ (v1) ---
		if a.Cfg.EnableMarketplace {
			v1.POST("/marketplace/listings", auth.RequirePermission("marketplace:listing:create"), func(c *gin.Context) {
				p := auth.MustPrincipal(c)
				var req struct {
					OfferingID string `json:"offering_id"`
					WalletID   string `json:"wallet_id"`
					Units      string `json:"units"`
					Price      string `json:"price"`
					Currency   string `json:"currency"`
				}
				if err := c.ShouldBindJSON(&req); err != nil || req.OfferingID == "" || req.WalletID == "" || req.Units == "" || req.Price == "" {
					c.JSON(400, gin.H{"error": "invalid request"})
					return
				}

				// Ensure holdings >= units
				var balStr string
				row := a.DB.Pool.QueryRow(c.Request.Context(), `
					SELECT balance::text FROM holdings
					WHERE user_id=$1 AND offering_id=$2 AND wallet_id=$3
				`, p.UserID, req.OfferingID, req.WalletID)
				if err := row.Scan(&balStr); err != nil {
					c.JSON(400, gin.H{"error": "no holdings"})
					return
				}
				// naive compare by float parsing (MVP). Replace with decimal lib.
				bal, _ := strconv.ParseFloat(balStr, 64)
				u, _ := strconv.ParseFloat(req.Units, 64)
				if bal < u {
					c.JSON(400, gin.H{"error": "insufficient balance"})
					return
				}

				var id string
				row = a.DB.Pool.QueryRow(c.Request.Context(), `
					INSERT INTO marketplace_listings(offering_id,seller_user_id,seller_wallet_id,units,price,currency,status)
					VALUES($1,$2,$3,$4::numeric,$5::numeric,COALESCE(NULLIF($6,''),'USD'),'OPEN')
					RETURNING id
				`, req.OfferingID, p.UserID, req.WalletID, req.Units, req.Price, req.Currency)
				_ = row.Scan(&id)

				_ = audit.Log(c.Request.Context(), a.DB.Pool, p.UserID, "LISTING_CREATED", "marketplace_listings", id, nil, req, c.ClientIP())
				_, _ = events.Enqueue(c.Request.Context(), a.DB.Pool, "LISTING_CREATED", gin.H{"listing_id": id})

				c.JSON(201, gin.H{"id": id, "status": "OPEN"})
			})

			v1.POST("/marketplace/rfq", auth.RequirePermission("marketplace:rfq:create"), func(c *gin.Context) {
				p := auth.MustPrincipal(c)
				var req struct {
					OfferingID string `json:"offering_id"`
					WalletID   string `json:"wallet_id"`
					Units      string `json:"units"`
					MaxPrice   string `json:"max_price"`
					Currency   string `json:"currency"`
				}
				if err := c.ShouldBindJSON(&req); err != nil || req.OfferingID == "" || req.WalletID == "" || req.Units == "" || req.MaxPrice == "" {
					c.JSON(400, gin.H{"error": "invalid request"})
					return
				}

				// Buyer must be eligible to trade
				var chainID int64
				row := a.DB.Pool.QueryRow(c.Request.Context(), `SELECT chain_id FROM offerings WHERE id=$1`, req.OfferingID)
				_ = row.Scan(&chainID)
				dec, err := policy.CanTrade(c.Request.Context(), a.DB.Pool, p.UserID, chainID)
				if err != nil {
					c.JSON(500, gin.H{"error": "policy error"})
					return
				}
				if !dec.Allowed {
					c.JSON(403, gin.H{"error": "not eligible to trade", "reasons": dec.Reasons})
					return
				}

				var id string
				row = a.DB.Pool.QueryRow(c.Request.Context(), `
					INSERT INTO marketplace_rfqs(offering_id,buyer_user_id,buyer_wallet_id,units,max_price,currency,status)
					VALUES($1,$2,$3,$4::numeric,$5::numeric,COALESCE(NULLIF($6,''),'USD'),'OPEN')
					RETURNING id
				`, req.OfferingID, p.UserID, req.WalletID, req.Units, req.MaxPrice, req.Currency)
				_ = row.Scan(&id)

				_ = audit.Log(c.Request.Context(), a.DB.Pool, p.UserID, "RFQ_CREATED", "marketplace_rfqs", id, nil, req, c.ClientIP())
				_, _ = events.Enqueue(c.Request.Context(), a.DB.Pool, "RFQ_CREATED", gin.H{"rfq_id": id})

				c.JSON(201, gin.H{"id": id, "status": "OPEN"})
			})

			v1.POST("/marketplace/match", auth.RequirePermission("marketplace:match"), func(c *gin.Context) {
				p := auth.MustPrincipal(c)
				var req struct {
					ListingID string `json:"listing_id"`
					RFQID     string `json:"rfq_id"`
				}
				if err := c.ShouldBindJSON(&req); err != nil || req.ListingID == "" || req.RFQID == "" {
					c.JSON(400, gin.H{"error": "invalid request"})
					return
				}

				// Load listing + rfq details
				var offeringID, sellerUserID, buyerUserID, sellerWalletID, buyerWalletID string
				var units, price, maxPrice string

				row := a.DB.Pool.QueryRow(c.Request.Context(), `
					SELECT offering_id, seller_user_id, seller_wallet_id, units::text, price::text
					FROM marketplace_listings
					WHERE id=$1 AND status='OPEN'
				`, req.ListingID)
				if err := row.Scan(&offeringID, &sellerUserID, &sellerWalletID, &units, &price); err != nil {
					c.JSON(404, gin.H{"error": "listing not found/open"})
					return
				}

				row = a.DB.Pool.QueryRow(c.Request.Context(), `
					SELECT buyer_user_id, buyer_wallet_id, units::text, max_price::text
					FROM marketplace_rfqs
					WHERE id=$1 AND status='OPEN'
				`, req.RFQID)
				if err := row.Scan(&buyerUserID, &buyerWalletID, &units, &maxPrice); err != nil {
					c.JSON(404, gin.H{"error": "rfq not found/open"})
					return
				}

				// Price check (MVP)
				pf, _ := strconv.ParseFloat(price, 64)
				mf, _ := strconv.ParseFloat(maxPrice, 64)
				if pf > mf {
					c.JSON(400, gin.H{"error": "price exceeds max_price"})
					return
				}

				// Wallet addresses
				var sellerAddr, buyerAddr string
				_ = a.DB.Pool.QueryRow(c.Request.Context(), `SELECT address FROM wallets WHERE id=$1`, sellerWalletID).Scan(&sellerAddr)
				_ = a.DB.Pool.QueryRow(c.Request.Context(), `SELECT address FROM wallets WHERE id=$1`, buyerWalletID).Scan(&buyerAddr)

				// Execute settlement via force-transfer (MVP).
				txHash, err := a.Chain.ForceTransfer(c.Request.Context(), offeringID, sellerAddr, buyerAddr, units)
				if err != nil {
					c.JSON(500, gin.H{"error": "chain error"})
					return
				}

				// Create trade
				var tradeID string
				row = a.DB.Pool.QueryRow(c.Request.Context(), `
					INSERT INTO marketplace_trades(offering_id, listing_id, rfq_id, seller_user_id, buyer_user_id, seller_wallet, buyer_wallet, units, price, currency, status, settlement_tx_hash)
					VALUES($1,$2,$3,$4,$5,$6,$7,$8::numeric,$9::numeric,'USD','SETTLED',$10)
					RETURNING id
				`, offeringID, req.ListingID, req.RFQID, sellerUserID, buyerUserID, sellerAddr, buyerAddr, units, price, txHash)
				_ = row.Scan(&tradeID)

				// Update listing/rfq statuses
				_, _ = a.DB.Pool.Exec(c.Request.Context(), `UPDATE marketplace_listings SET status='FILLED', updated_at=now() WHERE id=$1`, req.ListingID)
				_, _ = a.DB.Pool.Exec(c.Request.Context(), `UPDATE marketplace_rfqs SET status='MATCHED', updated_at=now() WHERE id=$1`, req.RFQID)

				// Update ledger (MVP). Production: indexer-driven.
				_, _ = a.DB.Pool.Exec(c.Request.Context(), `
					UPDATE holdings SET balance = balance - $4::numeric, updated_at=now()
					WHERE user_id=$1 AND offering_id=$2 AND wallet_id=$3
				`, sellerUserID, offeringID, sellerWalletID, units)
				_, _ = a.DB.Pool.Exec(c.Request.Context(), `
					INSERT INTO holdings(user_id,offering_id,wallet_id,balance)
					VALUES($1,$2,$3,$4::numeric)
					ON CONFLICT (user_id,offering_id,wallet_id) DO UPDATE
					SET balance = holdings.balance + EXCLUDED.balance, updated_at=now()
				`, buyerUserID, offeringID, buyerWalletID, units)

				_, _ = a.DB.Pool.Exec(c.Request.Context(), `
					INSERT INTO transfers(offering_id, from_wallet, to_wallet, amount, tx_hash, occurred_at)
					VALUES($1,$2,$3,$4::numeric,$5,now())
				`, offeringID, sellerAddr, buyerAddr, units, txHash)

				_ = audit.Log(c.Request.Context(), a.DB.Pool, p.UserID, "TRADE_SETTLED", "marketplace_trades", tradeID, nil, gin.H{"tx_hash": txHash}, c.ClientIP())
				_, _ = events.Enqueue(c.Request.Context(), a.DB.Pool, "TRADE_SETTLED", gin.H{"trade_id": tradeID, "tx_hash": txHash})

				c.JSON(200, gin.H{"trade_id": tradeID, "status": "SETTLED", "tx_hash": txHash})
			})
		}

		// --- Debug: list whitelist requests (useful for e2e) ---
		v1.GET("/debug/whitelist-requests", auth.RequirePermission("tokenops:whitelist"), func(c *gin.Context) {
			rows, err := a.DB.Pool.Query(c.Request.Context(), `
				SELECT wr.id, wr.offering_id, wr.wallet_id, wr.status, w.address
				FROM whitelist_requests wr
				JOIN wallets w ON w.id=wr.wallet_id
				ORDER BY wr.created_at DESC
				LIMIT 200
			`)
			if err != nil {
				c.JSON(500, gin.H{"error": "db error"})
				return
			}
			defer rows.Close()
			var out []gin.H
			for rows.Next() {
				var id, offeringID, walletID, status, addr string
				if err := rows.Scan(&id, &offeringID, &walletID, &status, &addr); err != nil {
					c.JSON(500, gin.H{"error": "scan error"})
					return
				}
				out = append(out, gin.H{"id": id, "offering_id": offeringID, "wallet_id": walletID, "status": status, "address": addr})
			}
			c.JSON(200, out)
		})

		// Debug: list subscriptions (useful for e2e)
		v1.GET("/debug/subscriptions", auth.RequirePermission("payment:notify"), func(c *gin.Context) {
			rows, err := a.DB.Pool.Query(c.Request.Context(), `
				SELECT id, offering_id, user_id, status, units::text, amount::text, created_at
				FROM subscriptions
				ORDER BY created_at DESC
				LIMIT 200
			`)
			if err != nil {
				c.JSON(500, gin.H{"error": "db error"})
				return
			}
			defer rows.Close()
			var out []gin.H
			for rows.Next() {
				var id, offeringID, userID, status, units, amount string
				var createdAt time.Time
				if err := rows.Scan(&id, &offeringID, &userID, &status, &units, &amount, &createdAt); err != nil {
					c.JSON(500, gin.H{"error": "scan error"})
					return
				}
				out = append(out, gin.H{"id": id, "offering_id": offeringID, "user_id": userID, "status": status, "units": units, "amount": amount, "created_at": createdAt})
			}
			c.JSON(200, out)
		})

		// --- Extra integrations (chains, onramp/offramp) ---
		registerExtraRoutes(v1, a)

	}

	log.Debug().Msg("routes registered")
}

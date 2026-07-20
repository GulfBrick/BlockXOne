package main

import (
	"blockxone/internal/app"
	"blockxone/internal/audit"
	"blockxone/internal/auth"
	"blockxone/internal/chain"
	"blockxone/internal/chainlog"
	"blockxone/internal/events"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// RegisterERC3643Routes adds the ERC-3643 security token lifecycle
// endpoints to the v1 API group. These cover:
//   - Proper ERC-3643 token deployment (DeployToken via BXOSecurityTokenFactory)
//   - Token pause/unpause (emergency controls)
//   - Token recovery (lost wallet recovery)
//   - Frozen status check
//   - Identity registry management (register/delete/verify)
//   - Compliance module management (add/remove/check)
func RegisterERC3643Routes(v1 *gin.RouterGroup, a *app.App) {

	// ─── ERC-3643 Token Deployment ──────────────────────────────────────

	// POST /offerings/:id/deploy-erc3643
	// Deploys a complete ERC-3643 security token via BXOSecurityTokenFactory.
	// Requires pre-deployed IdentityRegistry and ModularCompliance addresses.
	v1.POST("/offerings/:id/deploy-erc3643", auth.RequirePermission("tokenops:deploy_erc3643"), func(c *gin.Context) {
		p := auth.MustPrincipal(c)
		offeringID := c.Param("id")
		if _, err := uuid.Parse(offeringID); err != nil {
			c.JSON(400, gin.H{"error": "invalid offering id"})
			return
		}

		var req struct {
			Symbol           string `json:"symbol"`
			Decimals         uint8  `json:"decimals"`
			IdentityRegistry string `json:"identity_registry"`
			Compliance       string `json:"compliance"`
			InitialSupply    string `json:"initial_supply"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "invalid request body"})
			return
		}
		if req.IdentityRegistry == "" || req.Compliance == "" {
			c.JSON(400, gin.H{"error": "identity_registry and compliance contract addresses required"})
			return
		}
		if req.Decimals == 0 {
			req.Decimals = 18 // ERC-20 standard default
		}
		if req.Decimals > 18 {
			c.JSON(400, gin.H{"error": "decimals must be <= 18"})
			return
		}

		// Load offering name from DB
		var name string
		row := a.DB.Pool.QueryRow(c.Request.Context(), `
			SELECT a.name
			FROM offerings o
			JOIN assets a ON a.id=o.asset_id
			WHERE o.id=$1 AND o.status='DRAFT'
		`, offeringID)
		if err := row.Scan(&name); err != nil {
			c.JSON(404, gin.H{"error": "offering not found or not in DRAFT"})
			return
		}

		symbol := req.Symbol
		if symbol == "" {
			c.JSON(400, gin.H{"error": "symbol is required"})
			return
		}

		tokenAddr, txHash, err := a.Chain.DeployToken(c.Request.Context(), chain.DeployTokenRequest{
			Name:             name,
			Symbol:           symbol,
			Decimals:         req.Decimals,
			IdentityRegistry: req.IdentityRegistry,
			Compliance:       req.Compliance,
			InitialSupply:    req.InitialSupply,
		})
		if err != nil {
			c.JSON(500, gin.H{"error": "chain deploy failed: " + err.Error()})
			return
		}

		// Store token address, identity registry, and compliance contract
		_, err = a.DB.Pool.Exec(c.Request.Context(), `
			UPDATE offerings
			SET token_contract=$2, identity_registry=$3, compliance_contract=$4, updated_at=now()
			WHERE id=$1
		`, offeringID, tokenAddr, req.IdentityRegistry, req.Compliance)
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to update offering"})
			return
		}

		_ = audit.Log(c.Request.Context(), a.DB.Pool, p.UserID, "ERC3643_DEPLOYED", "offerings", offeringID, nil, gin.H{
			"token_contract":    tokenAddr,
			"identity_registry": req.IdentityRegistry,
			"compliance":        req.Compliance,
			"tx_hash":           txHash,
			"decimals":          req.Decimals,
			"initial_supply":    req.InitialSupply,
		}, c.ClientIP())
		_ = chainlog.Record(c.Request.Context(), a.DB.Pool, chainlog.Entry{
			OfferingID:    offeringID,
			Operation:     chainlog.OpDeployERC3643,
			TxHash:        txHash,
			ActorUserID:   p.UserID,
			TargetAddress: tokenAddr,
			Metadata: map[string]interface{}{
				"symbol":            symbol,
				"decimals":          req.Decimals,
				"identity_registry": req.IdentityRegistry,
				"compliance":        req.Compliance,
				"initial_supply":    req.InitialSupply,
			},
		})
		_, _ = events.Enqueue(c.Request.Context(), a.DB.Pool, "ERC3643_DEPLOYED", gin.H{
			"offering_id":    offeringID,
			"token_contract": tokenAddr,
			"tx_hash":        txHash,
		})

		c.JSON(200, gin.H{
			"id":                offeringID,
			"token_contract":    tokenAddr,
			"identity_registry": req.IdentityRegistry,
			"compliance":        req.Compliance,
			"tx_hash":           txHash,
		})
	})

	// ─── Token Emergency Controls ───────────────────────────────────────

	// POST /offerings/:id/pause
	// Halts all token transfers on the offering's security token.
	v1.POST("/offerings/:id/pause", auth.RequirePermission("tokenops:pause"), func(c *gin.Context) {
		p := auth.MustPrincipal(c)
		offeringID := c.Param("id")
		if _, err := uuid.Parse(offeringID); err != nil {
			c.JSON(400, gin.H{"error": "invalid offering id"})
			return
		}

		txHash, err := a.Chain.Pause(c.Request.Context(), offeringID)
		if err != nil {
			c.JSON(500, gin.H{"error": "chain error: " + err.Error()})
			return
		}

		_ = audit.Log(c.Request.Context(), a.DB.Pool, p.UserID, "TOKEN_PAUSED", "offerings", offeringID, nil, gin.H{"tx_hash": txHash}, c.ClientIP())
		_ = chainlog.Record(c.Request.Context(), a.DB.Pool, chainlog.Entry{
			OfferingID:  offeringID,
			Operation:   chainlog.OpPause,
			TxHash:      txHash,
			ActorUserID: p.UserID,
		})
		_, _ = events.Enqueue(c.Request.Context(), a.DB.Pool, "TOKEN_PAUSED", gin.H{"offering_id": offeringID, "tx_hash": txHash})

		c.JSON(200, gin.H{"offering_id": offeringID, "tx_hash": txHash, "paused": true})
	})

	// POST /offerings/:id/unpause
	// Resumes token transfers on the offering's security token.
	v1.POST("/offerings/:id/unpause", auth.RequirePermission("tokenops:unpause"), func(c *gin.Context) {
		p := auth.MustPrincipal(c)
		offeringID := c.Param("id")
		if _, err := uuid.Parse(offeringID); err != nil {
			c.JSON(400, gin.H{"error": "invalid offering id"})
			return
		}

		txHash, err := a.Chain.Unpause(c.Request.Context(), offeringID)
		if err != nil {
			c.JSON(500, gin.H{"error": "chain error: " + err.Error()})
			return
		}

		_ = audit.Log(c.Request.Context(), a.DB.Pool, p.UserID, "TOKEN_UNPAUSED", "offerings", offeringID, nil, gin.H{"tx_hash": txHash}, c.ClientIP())
		_ = chainlog.Record(c.Request.Context(), a.DB.Pool, chainlog.Entry{
			OfferingID:  offeringID,
			Operation:   chainlog.OpUnpause,
			TxHash:      txHash,
			ActorUserID: p.UserID,
		})
		_, _ = events.Enqueue(c.Request.Context(), a.DB.Pool, "TOKEN_UNPAUSED", gin.H{"offering_id": offeringID, "tx_hash": txHash})

		c.JSON(200, gin.H{"offering_id": offeringID, "tx_hash": txHash, "paused": false})
	})

	// POST /offerings/:id/recover-tokens
	// Recovers tokens from a lost wallet to a recovery address.
	v1.POST("/offerings/:id/recover-tokens", auth.RequirePermission("tokenops:recover"), func(c *gin.Context) {
		p := auth.MustPrincipal(c)
		offeringID := c.Param("id")
		if _, err := uuid.Parse(offeringID); err != nil {
			c.JSON(400, gin.H{"error": "invalid offering id"})
			return
		}

		var req struct {
			LostAddress     string `json:"lost_address"`
			RecoveryAddress string `json:"recovery_address"`
			Amount          string `json:"amount"`
		}
		if err := c.ShouldBindJSON(&req); err != nil || req.LostAddress == "" || req.RecoveryAddress == "" || req.Amount == "" {
			c.JSON(400, gin.H{"error": "lost_address, recovery_address, and amount required"})
			return
		}

		txHash, err := a.Chain.RecoverTokens(c.Request.Context(), offeringID, req.LostAddress, req.RecoveryAddress, req.Amount)
		if err != nil {
			c.JSON(500, gin.H{"error": "chain error: " + err.Error()})
			return
		}

		// Record the forced transfer in the transfers ledger
		_, _ = a.DB.Pool.Exec(c.Request.Context(), `
			INSERT INTO transfers(offering_id, from_wallet, to_wallet, amount, tx_hash, occurred_at)
			VALUES($1,$2,$3,$4::numeric,$5,now())
		`, offeringID, req.LostAddress, req.RecoveryAddress, req.Amount, txHash)

		_ = audit.Log(c.Request.Context(), a.DB.Pool, p.UserID, "TOKENS_RECOVERED", "offerings", offeringID, nil, gin.H{
			"lost_address":     req.LostAddress,
			"recovery_address": req.RecoveryAddress,
			"amount":           req.Amount,
			"tx_hash":          txHash,
		}, c.ClientIP())
		_ = chainlog.Record(c.Request.Context(), a.DB.Pool, chainlog.Entry{
			OfferingID:       offeringID,
			Operation:        chainlog.OpRecoverTokens,
			TxHash:           txHash,
			ActorUserID:      p.UserID,
			TargetAddress:    req.LostAddress,
			SecondaryAddress: req.RecoveryAddress,
			Amount:           req.Amount,
		})
		_, _ = events.Enqueue(c.Request.Context(), a.DB.Pool, "TOKENS_RECOVERED", gin.H{
			"offering_id": offeringID,
			"tx_hash":     txHash,
		})

		c.JSON(200, gin.H{
			"offering_id":      offeringID,
			"lost_address":     req.LostAddress,
			"recovery_address": req.RecoveryAddress,
			"amount":           req.Amount,
			"tx_hash":          txHash,
		})
	})

	// GET /offerings/:id/frozen/:address
	// Checks if a specific address is frozen on the offering's token (read-only).
	v1.GET("/offerings/:id/frozen/:address", auth.RequirePermission("tokenops:freeze"), func(c *gin.Context) {
		offeringID := c.Param("id")
		address := c.Param("address")
		if _, err := uuid.Parse(offeringID); err != nil {
			c.JSON(400, gin.H{"error": "invalid offering id"})
			return
		}

		frozen, err := a.Chain.IsFrozen(c.Request.Context(), offeringID, address)
		if err != nil {
			c.JSON(500, gin.H{"error": "chain error: " + err.Error()})
			return
		}

		c.JSON(200, gin.H{"offering_id": offeringID, "address": address, "frozen": frozen})
	})

	// ─── Identity Registry ──────────────────────────────────────────────

	// POST /offerings/:id/identity
	// Registers an investor in the offering's on-chain IdentityRegistry.
	v1.POST("/offerings/:id/identity", auth.RequirePermission("tokenops:identity_register"), func(c *gin.Context) {
		p := auth.MustPrincipal(c)
		offeringID := c.Param("id")
		if _, err := uuid.Parse(offeringID); err != nil {
			c.JSON(400, gin.H{"error": "invalid offering id"})
			return
		}

		var req struct {
			Investor string `json:"investor"` // Wallet address
			Identity string `json:"identity"` // IIdentity contract address
			Country  uint16 `json:"country"`  // ISO 3166-1 numeric country code
		}
		if err := c.ShouldBindJSON(&req); err != nil || req.Investor == "" || req.Identity == "" {
			c.JSON(400, gin.H{"error": "investor address and identity contract required"})
			return
		}

		txHash, err := a.Chain.RegisterIdentity(c.Request.Context(), offeringID, req.Investor, req.Identity, req.Country)
		if err != nil {
			c.JSON(500, gin.H{"error": "chain error: " + err.Error()})
			return
		}

		_ = audit.Log(c.Request.Context(), a.DB.Pool, p.UserID, "IDENTITY_REGISTERED", "offerings", offeringID, nil, gin.H{
			"investor": req.Investor,
			"identity": req.Identity,
			"country":  req.Country,
			"tx_hash":  txHash,
		}, c.ClientIP())
		_ = chainlog.Record(c.Request.Context(), a.DB.Pool, chainlog.Entry{
			OfferingID:       offeringID,
			Operation:        chainlog.OpIdentityRegister,
			TxHash:           txHash,
			ActorUserID:      p.UserID,
			TargetAddress:    req.Investor,
			SecondaryAddress: req.Identity,
			Metadata:         map[string]interface{}{"country": req.Country},
		})
		_, _ = events.Enqueue(c.Request.Context(), a.DB.Pool, "IDENTITY_REGISTERED", gin.H{
			"offering_id": offeringID,
			"investor":    req.Investor,
			"tx_hash":     txHash,
		})

		c.JSON(200, gin.H{
			"offering_id": offeringID,
			"investor":    req.Investor,
			"tx_hash":     txHash,
		})
	})

	// DELETE /offerings/:id/identity/:investor
	// Removes an investor from the offering's on-chain IdentityRegistry.
	v1.DELETE("/offerings/:id/identity/:investor", auth.RequirePermission("tokenops:identity_delete"), func(c *gin.Context) {
		p := auth.MustPrincipal(c)
		offeringID := c.Param("id")
		investor := c.Param("investor")
		if _, err := uuid.Parse(offeringID); err != nil {
			c.JSON(400, gin.H{"error": "invalid offering id"})
			return
		}

		txHash, err := a.Chain.DeleteIdentity(c.Request.Context(), offeringID, investor)
		if err != nil {
			c.JSON(500, gin.H{"error": "chain error: " + err.Error()})
			return
		}

		_ = audit.Log(c.Request.Context(), a.DB.Pool, p.UserID, "IDENTITY_DELETED", "offerings", offeringID, nil, gin.H{
			"investor": investor,
			"tx_hash":  txHash,
		}, c.ClientIP())
		_ = chainlog.Record(c.Request.Context(), a.DB.Pool, chainlog.Entry{
			OfferingID:    offeringID,
			Operation:     chainlog.OpIdentityDelete,
			TxHash:        txHash,
			ActorUserID:   p.UserID,
			TargetAddress: investor,
		})

		c.JSON(200, gin.H{
			"offering_id": offeringID,
			"investor":    investor,
			"tx_hash":     txHash,
		})
	})

	// GET /offerings/:id/identity/:investor/verified
	// Checks if an investor is verified in the offering's IdentityRegistry (read-only).
	v1.GET("/offerings/:id/identity/:investor/verified", auth.RequirePermission("tokenops:identity_register"), func(c *gin.Context) {
		offeringID := c.Param("id")
		investor := c.Param("investor")
		if _, err := uuid.Parse(offeringID); err != nil {
			c.JSON(400, gin.H{"error": "invalid offering id"})
			return
		}

		verified, err := a.Chain.IsIdentityVerified(c.Request.Context(), offeringID, investor)
		if err != nil {
			c.JSON(500, gin.H{"error": "chain error: " + err.Error()})
			return
		}

		c.JSON(200, gin.H{"offering_id": offeringID, "investor": investor, "verified": verified})
	})

	// ─── Compliance Module Management ───────────────────────────────────

	// POST /offerings/:id/compliance/modules
	// Adds a compliance module to the offering's ModularCompliance contract.
	v1.POST("/offerings/:id/compliance/modules", auth.RequirePermission("tokenops:compliance_module"), func(c *gin.Context) {
		p := auth.MustPrincipal(c)
		offeringID := c.Param("id")
		if _, err := uuid.Parse(offeringID); err != nil {
			c.JSON(400, gin.H{"error": "invalid offering id"})
			return
		}

		var req struct {
			ModuleAddress string `json:"module_address"`
		}
		if err := c.ShouldBindJSON(&req); err != nil || req.ModuleAddress == "" {
			c.JSON(400, gin.H{"error": "module_address required"})
			return
		}

		txHash, err := a.Chain.AddComplianceModule(c.Request.Context(), offeringID, req.ModuleAddress)
		if err != nil {
			c.JSON(500, gin.H{"error": "chain error: " + err.Error()})
			return
		}

		_ = audit.Log(c.Request.Context(), a.DB.Pool, p.UserID, "COMPLIANCE_MODULE_ADDED", "offerings", offeringID, nil, gin.H{
			"module_address": req.ModuleAddress,
			"tx_hash":        txHash,
		}, c.ClientIP())
		_ = chainlog.Record(c.Request.Context(), a.DB.Pool, chainlog.Entry{
			OfferingID:    offeringID,
			Operation:     chainlog.OpComplianceModuleAdd,
			TxHash:        txHash,
			ActorUserID:   p.UserID,
			TargetAddress: req.ModuleAddress,
		})
		_, _ = events.Enqueue(c.Request.Context(), a.DB.Pool, "COMPLIANCE_MODULE_ADDED", gin.H{
			"offering_id":    offeringID,
			"module_address": req.ModuleAddress,
			"tx_hash":        txHash,
		})

		c.JSON(200, gin.H{
			"offering_id":    offeringID,
			"module_address": req.ModuleAddress,
			"tx_hash":        txHash,
		})
	})

	// DELETE /offerings/:id/compliance/modules/:address
	// Removes a compliance module from the offering's ModularCompliance contract.
	v1.DELETE("/offerings/:id/compliance/modules/:address", auth.RequirePermission("tokenops:compliance_module"), func(c *gin.Context) {
		p := auth.MustPrincipal(c)
		offeringID := c.Param("id")
		moduleAddress := c.Param("address")
		if _, err := uuid.Parse(offeringID); err != nil {
			c.JSON(400, gin.H{"error": "invalid offering id"})
			return
		}

		txHash, err := a.Chain.RemoveComplianceModule(c.Request.Context(), offeringID, moduleAddress)
		if err != nil {
			c.JSON(500, gin.H{"error": "chain error: " + err.Error()})
			return
		}

		_ = audit.Log(c.Request.Context(), a.DB.Pool, p.UserID, "COMPLIANCE_MODULE_REMOVED", "offerings", offeringID, nil, gin.H{
			"module_address": moduleAddress,
			"tx_hash":        txHash,
		}, c.ClientIP())
		_ = chainlog.Record(c.Request.Context(), a.DB.Pool, chainlog.Entry{
			OfferingID:    offeringID,
			Operation:     chainlog.OpComplianceModuleRem,
			TxHash:        txHash,
			ActorUserID:   p.UserID,
			TargetAddress: moduleAddress,
		})

		c.JSON(200, gin.H{
			"offering_id":    offeringID,
			"module_address": moduleAddress,
			"tx_hash":        txHash,
		})
	})

	// GET /offerings/:id/compliance/can-transfer
	// Checks if a transfer between two addresses would be allowed by all
	// compliance modules on the offering's token (read-only).
	v1.GET("/offerings/:id/compliance/can-transfer", auth.RequirePermission("tokenops:compliance_module"), func(c *gin.Context) {
		offeringID := c.Param("id")
		from := c.Query("from")
		to := c.Query("to")
		amount := c.Query("amount")

		if _, err := uuid.Parse(offeringID); err != nil {
			c.JSON(400, gin.H{"error": "invalid offering id"})
			return
		}
		if from == "" || to == "" || amount == "" {
			c.JSON(400, gin.H{"error": "from, to, and amount query parameters required"})
			return
		}

		allowed, err := a.Chain.CanTransfer(c.Request.Context(), offeringID, from, to, amount)
		if err != nil {
			c.JSON(500, gin.H{"error": "chain error: " + err.Error()})
			return
		}

		c.JSON(200, gin.H{
			"offering_id": offeringID,
			"from":        from,
			"to":          to,
			"amount":      amount,
			"allowed":     allowed,
		})
	})
}

package main

import (
	"net/http"
	"time"

	"blockxone/internal/app"
	"blockxone/internal/audit"
	"blockxone/internal/auth"
	"blockxone/internal/events"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// registerExtraRoutes adds integrations that the UI expects (chains list + on/off-ramp stubs).
// These are safe in dev/testnet mode and can be swapped to real providers later.
func registerExtraRoutes(v1 *gin.RouterGroup, a *app.App) {
	// Multi-chain selector list (testnets + mainnets)
	v1.GET("/chains", func(c *gin.Context) {
		chains := []gin.H{
			{"chain_id": int64(1), "name": "Ethereum", "is_testnet": false, "metamask_chain_id": "0x1"},
			{"chain_id": int64(11155111), "name": "Sepolia", "is_testnet": true, "metamask_chain_id": "0xaa36a7"},
			{"chain_id": int64(137), "name": "Polygon", "is_testnet": false, "metamask_chain_id": "0x89"},
			{"chain_id": int64(80002), "name": "Polygon Amoy", "is_testnet": true, "metamask_chain_id": "0x13882"},
			{"chain_id": int64(8453), "name": "Base", "is_testnet": false, "metamask_chain_id": "0x2105"},
			{"chain_id": int64(84532), "name": "Base Sepolia", "is_testnet": true, "metamask_chain_id": "0x14a34"},
			{"chain_id": int64(42161), "name": "Arbitrum One", "is_testnet": false, "metamask_chain_id": "0xa4b1"},
			{"chain_id": int64(421614), "name": "Arbitrum Sepolia", "is_testnet": true, "metamask_chain_id": "0x66eee"},
		}
		c.JSON(http.StatusOK, chains)
	})

	// Onramp quote (stub)
	v1.POST("/onramp/quote", func(c *gin.Context) {
		p := auth.MustPrincipal(c)
		var req struct {
			Provider       string `json:"provider"`
			FiatCurrency   string `json:"fiat_currency"`
			CryptoCurrency string `json:"crypto_currency"`
			FiatAmount     string `json:"fiat_amount"`
			ChainID        int64  `json:"chain_id"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
			return
		}
		resp := gin.H{
			"provider":                req.Provider,
			"fiat_currency":           req.FiatCurrency,
			"crypto_currency":         req.CryptoCurrency,
			"fiat_amount":             req.FiatAmount,
			"estimated_crypto_amount": req.FiatAmount, // stub estimate
			"chain_id":                req.ChainID,
		}
		_ = audit.Log(c.Request.Context(), a.DB.Pool, p.UserID, "ONRAMP_QUOTED", "onramp", "", nil, req, c.ClientIP())
		_, _ = events.Enqueue(c.Request.Context(), a.DB.Pool, "ONRAMP_QUOTED", resp)
		c.JSON(http.StatusOK, resp)
	})

	// Onramp session (stub)
	v1.POST("/onramp/session", func(c *gin.Context) {
		p := auth.MustPrincipal(c)
		var req struct {
			Provider string `json:"provider"`
			ChainID  int64  `json:"chain_id"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
			return
		}
		id := uuid.New().String()
		resp := gin.H{
			"id":           id,
			"provider":     req.Provider,
			"status":       "CREATED",
			"redirect_url": "https://example.invalid/onramp/session/" + id,
			"expires_at":   time.Now().Add(10 * time.Minute),
			"chain_id":     req.ChainID,
		}
		_ = audit.Log(c.Request.Context(), a.DB.Pool, p.UserID, "ONRAMP_SESSION_CREATED", "onramp", id, nil, req, c.ClientIP())
		_, _ = events.Enqueue(c.Request.Context(), a.DB.Pool, "ONRAMP_SESSION_CREATED", resp)
		c.JSON(http.StatusOK, resp)
	})

	// Offramp quote (stub)
	v1.POST("/offramp/quote", func(c *gin.Context) {
		p := auth.MustPrincipal(c)
		var req struct {
			Provider       string `json:"provider"`
			FiatCurrency   string `json:"fiat_currency"`
			CryptoCurrency string `json:"crypto_currency"`
			CryptoAmount   string `json:"crypto_amount"`
			ChainID        int64  `json:"chain_id"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
			return
		}
		resp := gin.H{
			"provider":              req.Provider,
			"fiat_currency":         req.FiatCurrency,
			"crypto_currency":       req.CryptoCurrency,
			"crypto_amount":         req.CryptoAmount,
			"estimated_fiat_amount": req.CryptoAmount, // stub estimate
			"chain_id":              req.ChainID,
		}
		_ = audit.Log(c.Request.Context(), a.DB.Pool, p.UserID, "OFFRAMP_QUOTED", "offramp", "", nil, req, c.ClientIP())
		_, _ = events.Enqueue(c.Request.Context(), a.DB.Pool, "OFFRAMP_QUOTED", resp)
		c.JSON(http.StatusOK, resp)
	})

	// Offramp payout (stub)
	v1.POST("/offramp/payout", func(c *gin.Context) {
		p := auth.MustPrincipal(c)
		var req struct {
			Provider string `json:"provider"`
			Amount   string `json:"amount"`
			Currency string `json:"currency"`
			Method   string `json:"method"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
			return
		}
		id := uuid.New().String()
		resp := gin.H{"id": id, "provider": req.Provider, "status": "SUBMITTED", "reference": "OFFRAMP-" + id}
		_ = audit.Log(c.Request.Context(), a.DB.Pool, p.UserID, "OFFRAMP_PAYOUT_SUBMITTED", "offramp", id, nil, req, c.ClientIP())
		_, _ = events.Enqueue(c.Request.Context(), a.DB.Pool, "OFFRAMP_PAYOUT_SUBMITTED", resp)
		c.JSON(http.StatusOK, resp)
	})
}

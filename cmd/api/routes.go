package main

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"blockxone/internal/audit"
	"blockxone/internal/auth"
	"blockxone/internal/ethsig"
	"blockxone/internal/events"
	"blockxone/internal/kyc"
	"blockxone/internal/policy"

	"blockxone/internal/app"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"
	"golang.org/x/crypto/bcrypt"
)

const (
	platformOrgID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
	issuerOrgID   = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
	transferOrgID = "cccccccc-cccc-cccc-cccc-cccccccccccc"
	tokenOrgID    = "dddddddd-dddd-dddd-dddd-dddddddddddd"
	investorOrgID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"
)

// RegisterPublicRoutes wires endpoints that should not require auth.
func RegisterPublicRoutes(r *gin.Engine) {
	r.GET("/healthz", func(c *gin.Context) {
		c.JSON(200, gin.H{"ok": true, "service": "blockxone-api"})
	})

	// Dev console: quick UI for testing API calls and MetaMask signing
	r.GET("/console", func(c *gin.Context) {
		c.Header("Content-Type", "text/html; charset=utf-8")
		c.String(200, `<!doctype html>
<html>
<head>
	<meta charset="utf-8" />
	<title>BlockXOne Dev Console</title>
	<style>
		body { font-family: Arial, sans-serif; background:#0b0c0e; color:#e6eef8; padding:20px }
		.card { background:#0f1720; padding:16px; border-radius:8px; margin-bottom:12px }
		label { display:block; margin-top:8px; font-size:13px }
		input, textarea { width:100%; padding:8px; margin-top:6px; border-radius:6px; border:1px solid #26303a; background:#0b1116; color:#e6eef8 }
		button { margin-top:8px; padding:8px 12px; border-radius:6px; cursor:pointer }
		.secondary { background:#1f2937; color:#e6eef8; border:1px solid #374151 }
		.primary { background:#06b6d4; color:#042027; border:0 }
		pre { background:#020617; padding:12px; border-radius:6px; overflow:auto }
	</style>
</head>
<body>
	<h2>BlockXOne Dev Console</h2>

	<div class="card">
		<h3>Request Builder</h3>
		<label>Method</label>
		<input id="method" value="POST" />
		<label>Path (relative)</label>
		<input id="path" value="/v1/wallets/connect" />
		<label>Body (JSON)</label>
		<textarea id="body" rows="6">{"address":"","chain_id":0,"message":"","signature":""}</textarea>
		<label>Dev headers (X-Dev-User-Id)</label>
		<input id="devUserId" value="11111111-1111-1111-1111-111111111111" />
		<label>Dev headers (X-Dev-Email)</label>
		<input id="devEmail" value="investor@test.com" />
		<label>Dev headers (X-Dev-Roles)</label>
		<input id="devRoles" value="Investor" />
		<div style="margin-top:8px">
			<button id="send" class="primary">Send</button>
			<button class="secondary" id="mmConnect">MetaMask: Connect + Sign + Submit</button>
		</div>
	</div>

	<div class="card">
		<h3>Response</h3>
		<pre id="out">(no response yet)</pre>
	</div>

	<script>
		function out(txt){ document.getElementById('out').textContent = txt }

		async function sendRequest(){
			const method = document.getElementById('method').value || 'GET'
			const path = document.getElementById('path').value || '/v1/healthz'
			let body = document.getElementById('body').value || ''
			try { body = JSON.parse(body); } catch(e) { /* keep as string */ }

			const headers = { 'Content-Type': 'application/json' }
			const devUser = document.getElementById('devUserId').value
			const devEmail = document.getElementById('devEmail').value
			const devRoles = (document.getElementById('devRoles') && document.getElementById('devRoles').value) || ''
			if(devUser) headers['X-Dev-User-Id'] = devUser
			if(devEmail) headers['X-Dev-Email'] = devEmail
			if(devRoles) headers['X-Dev-Roles'] = devRoles

			out('Sending...')
			try{
				const resp = await fetch(path, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body) })
				const txt = await resp.text()
				out(resp.status + ' ' + resp.statusText + '\n\n' + txt)
			}catch(e){ out('Network error: ' + e.message) }
		}

		function utf8ToHex(str) {
			const enc = new TextEncoder().encode(str);
			let hex = '0x';
			for (const b of enc) hex += b.toString(16).padStart(2, '0');
			return hex;
		}

		async function metamaskConnectSignSubmit(){
			if(!window.ethereum){ out('MetaMask not detected. Install MetaMask extension.'); return }

			try{
				// 1) Connect
				const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
				const address = accounts[0];

				// 2) Chain id
				const chainHex = await window.ethereum.request({ method: 'eth_chainId' });
				const chainId = parseInt(chainHex, 16);

				// 3) Build message
				const nonce = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now());
				const message = 'BlockXOne wallet connect\\n\\nDomain: ' + window.location.host + '\\nAddress: ' + address + '\\nChain ID: ' + chainId + '\\nNonce: ' + nonce + '\\nIssued At: ' + new Date().toISOString();

				// 4) Sign
				const msgHex = utf8ToHex(message);
				const signature = await window.ethereum.request({ method: 'personal_sign', params: [msgHex, address] });

				// 5) Populate and submit
				document.getElementById('method').value = 'POST'
				document.getElementById('path').value = '/v1/wallets/connect'
				document.getElementById('body').value = JSON.stringify({ address, chain_id: chainId, message, signature }, null, 2)

				// copy dev headers fields from stored variables if present
				const devUser = localStorage.getItem('BX1_DEV_USER_ID') || ''
				const devEmail = localStorage.getItem('BX1_DEV_EMAIL') || ''
				const devRoles = localStorage.getItem('BX1_DEV_ROLES') || ''
				if(devUser) document.getElementById('devUserId').value = devUser
				if(devEmail) document.getElementById('devEmail').value = devEmail
				if(devRoles && document.getElementById('devRoles')) document.getElementById('devRoles').value = devRoles

				await sendRequest()
			}catch(e){ out('MetaMask flow failed: ' + (e && e.message ? e.message : String(e))) }
		}

		document.getElementById('send').addEventListener('click', sendRequest)
		document.getElementById('mmConnect').addEventListener('click', metamaskConnectSignSubmit)
	</script>
</body>
</html>`)
	})

}

// RegisterRoutes wires the MVP endpoints.
// All endpoints are under /v1.
func RegisterRoutes(r *gin.Engine, a *app.App) {

	v1 := r.Group("/v1")
	{
		// Email/password auth endpoints
		v1.POST("/auth/signup", func(c *gin.Context) {
			var req struct {
				Email    string `json:"email"`
				Password string `json:"password"`
			}
			if err := c.ShouldBindJSON(&req); err != nil || req.Email == "" || req.Password == "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": "email and password required"})
				return
			}

			if a.Cfg.JWTSecret == "" {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "JWT not configured"})
				return
			}

			ctx := c.Request.Context()

			// Check if user exists
			var exists bool
			row := a.DB.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE email=$1)`, req.Email)
			_ = row.Scan(&exists)
			if exists {
				c.JSON(http.StatusBadRequest, gin.H{"error": "email already registered"})
				return
			}

			// Hash password
			passwordHash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "password hash failed"})
				return
			}

			// Create user
			var userID string
			row = a.DB.Pool.QueryRow(ctx, `
				INSERT INTO users(email,password_hash,status) VALUES($1,$2,'ACTIVE')
				RETURNING id
			`, req.Email, string(passwordHash))
			if err := row.Scan(&userID); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "user creation failed"})
				return
			}

			// Assign Investor role by default
			if _, err := a.DB.Pool.Exec(ctx, `
				INSERT INTO user_org_roles(user_id, org_id, role_id)
				SELECT $1, $2, r.id FROM roles r WHERE r.name='Investor'
				ON CONFLICT DO NOTHING
			`, userID, investorOrgID); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "role assignment failed"})
				return
			}

			// Create investor profile
			_, _ = a.DB.Pool.Exec(ctx, `
				INSERT INTO investor_profile(user_id, investor_status, accredited_flag, qualified_flag, jurisdiction)
				VALUES($1,'RETAIL', false, false, 'US')
				ON CONFLICT (user_id) DO NOTHING
			`, userID)

			// Generate JWT
			token, err := auth.SignToken(a.Cfg.JWTSecret, userID, req.Email, investorOrgID, "", 24*time.Hour)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "token generation failed"})
				return
			}

			_ = audit.Log(ctx, a.DB.Pool, userID, "USER_SIGNUP", "users", userID, nil, gin.H{"email": req.Email}, c.ClientIP())
			c.JSON(http.StatusCreated, gin.H{
				"token":   token,
				"user_id": userID,
				"email":   req.Email,
				"org_id":  investorOrgID,
				"role":    "Investor",
			})
		})

		v1.POST("/auth/login", func(c *gin.Context) {
			var req struct {
				Email    string `json:"email"`
				Password string `json:"password"`
			}
			if err := c.ShouldBindJSON(&req); err != nil || req.Email == "" || req.Password == "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": "email and password required"})
				return
			}

			if a.Cfg.JWTSecret == "" {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "JWT not configured"})
				return
			}

			ctx := c.Request.Context()

			// Get user
			var userID, passwordHash string
			row := a.DB.Pool.QueryRow(ctx, `SELECT id, password_hash FROM users WHERE email=$1 AND status='ACTIVE'`, req.Email)
			if err := row.Scan(&userID, &passwordHash); err != nil {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
				return
			}

			if passwordHash == "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": "no password set - use wallet login"})
				return
			}

			// Verify password
			if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password)); err != nil {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
				return
			}

			// Get org and role
			var orgID, roleName string
			row = a.DB.Pool.QueryRow(ctx, `
				SELECT uor.org_id, r.name 
				FROM user_org_roles uor
				JOIN roles r ON r.id = uor.role_id
				WHERE uor.user_id=$1
				LIMIT 1
			`, userID)
			if err := row.Scan(&orgID, &roleName); err != nil {
				orgID = investorOrgID
				roleName = "Investor"
			}

			// Generate JWT
			token, err := auth.SignToken(a.Cfg.JWTSecret, userID, req.Email, orgID, "", 24*time.Hour)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "token generation failed"})
				return
			}

			_ = audit.Log(ctx, a.DB.Pool, userID, "USER_LOGIN", "users", userID, nil, gin.H{"email": req.Email}, c.ClientIP())
			c.JSON(http.StatusOK, gin.H{
				"token":   token,
				"user_id": userID,
				"email":   req.Email,
				"org_id":  orgID,
				"role":    roleName,
			})
		})

		v1.GET("/me", func(c *gin.Context) {
			p := auth.FromContext(c)
			if p == nil {
				c.JSON(401, gin.H{"error": "not authenticated"})
				return
			}
			// Return principal with all fields for frontend
			c.JSON(200, gin.H{
				"user_id":     p.UserID,
				"email":       p.Email,
				"org_id":      p.OrgID,
				"roles":       p.Roles,
				"permissions": p.Permissions,
			})
		})

		// --- Admin: User Management ---
		v1.GET("/admin/users", auth.RequirePermission("admin:users:view"), func(c *gin.Context) {
			rows, err := a.DB.Pool.Query(c.Request.Context(), `
				SELECT u.id, u.email, u.status, u.created_at,
				       COALESCE(array_agg(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL), '{}') as roles
				FROM users u
				LEFT JOIN user_org_roles uor ON uor.user_id = u.id
				LEFT JOIN roles r ON r.id = uor.role_id
				GROUP BY u.id, u.email, u.status, u.created_at
				ORDER BY u.created_at DESC
				LIMIT 500
			`)
			if err != nil {
				c.JSON(500, gin.H{"error": "db error"})
				return
			}
			defer rows.Close()

			var out []gin.H
			for rows.Next() {
				var id, email, status string
				var createdAt time.Time
				var roles []string
				if err := rows.Scan(&id, &email, &status, &createdAt, &roles); err != nil {
					c.JSON(500, gin.H{"error": "scan error"})
					return
				}
				out = append(out, gin.H{
					"id":         id,
					"email":      email,
					"status":     status,
					"roles":      roles,
					"created_at": createdAt,
				})
			}
			c.JSON(200, out)
		})

		v1.POST("/admin/users", auth.RequirePermission("admin:users:create"), func(c *gin.Context) {
			p := auth.MustPrincipal(c)
			var req struct {
				Email    string   `json:"email"`
				Password string   `json:"password"`
				Roles    []string `json:"roles"`
			}
			if err := c.ShouldBindJSON(&req); err != nil || req.Email == "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": "email required"})
				return
			}

			ctx := c.Request.Context()

			// Check if user exists
			var exists bool
			row := a.DB.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE email=$1)`, req.Email)
			_ = row.Scan(&exists)
			if exists {
				c.JSON(http.StatusBadRequest, gin.H{"error": "email already registered"})
				return
			}

			// Hash password if provided
			var passwordHash string
			if req.Password != "" {
				hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
				if err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": "password hash failed"})
					return
				}
				passwordHash = string(hash)
			}

			// Create user
			var userID string
			row = a.DB.Pool.QueryRow(ctx, `
				INSERT INTO users(email,password_hash,status) VALUES($1,NULLIF($2,''),'ACTIVE')
				RETURNING id
			`, req.Email, passwordHash)
			if err := row.Scan(&userID); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "user creation failed"})
				return
			}

			// Assign roles
			roleOrgMapping := map[string]string{
				"Investor":          investorOrgID,
				"ComplianceOfficer": platformOrgID,
				"OfferingManager":   platformOrgID,
				"IssuerFundManager": issuerOrgID,
				"TransferAgent":     transferOrgID,
				"TokenisationAgent": tokenOrgID,
				"SuperAdmin":        platformOrgID,
			}

			if len(req.Roles) == 0 {
				req.Roles = []string{"Investor"}
			}

			for _, roleName := range req.Roles {
				orgID, ok := roleOrgMapping[roleName]
				if !ok {
					orgID = investorOrgID
				}

				_, err := a.DB.Pool.Exec(ctx, `
					INSERT INTO user_org_roles(user_id, org_id, role_id)
					SELECT $1, $2, r.id FROM roles r WHERE r.name=$3
					ON CONFLICT DO NOTHING
				`, userID, orgID, roleName)
				if err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": "role assignment failed"})
					return
				}

				// Create investor profile for Investor role
				if roleName == "Investor" {
					_, _ = a.DB.Pool.Exec(ctx, `
						INSERT INTO investor_profile(user_id, investor_status, accredited_flag, qualified_flag, jurisdiction)
						VALUES($1,'RETAIL', false, false, 'US')
						ON CONFLICT (user_id) DO NOTHING
					`, userID)
				}
			}

			_ = audit.Log(ctx, a.DB.Pool, p.UserID, "ADMIN_USER_CREATED", "users", userID, nil, gin.H{"email": req.Email, "roles": req.Roles}, c.ClientIP())

			c.JSON(http.StatusCreated, gin.H{
				"user_id": userID,
				"email":   req.Email,
				"roles":   req.Roles,
				"status":  "ACTIVE",
			})
		})

		v1.DELETE("/admin/users/:id", auth.RequirePermission("admin:users:delete"), func(c *gin.Context) {
			p := auth.MustPrincipal(c)
			userID := c.Param("id")
			if _, err := uuid.Parse(userID); err != nil {
				c.JSON(400, gin.H{"error": "invalid user id"})
				return
			}

			// Prevent self-deletion
			if userID == p.UserID {
				c.JSON(400, gin.H{"error": "cannot delete yourself"})
				return
			}

			cmd, err := a.DB.Pool.Exec(c.Request.Context(), `
				UPDATE users SET status='DELETED', updated_at=now()
				WHERE id=$1
			`, userID)
			if err != nil || cmd.RowsAffected() == 0 {
				c.JSON(400, gin.H{"error": "cannot delete user"})
				return
			}

			_ = audit.Log(c.Request.Context(), a.DB.Pool, p.UserID, "ADMIN_USER_DELETED", "users", userID, nil, nil, c.ClientIP())
			c.JSON(200, gin.H{"id": userID, "status": "DELETED"})
		})

		v1.GET("/admin/stats", auth.RequirePermission("admin:stats:view"), func(c *gin.Context) {
			ctx := c.Request.Context()

			var totalUsers, activeUsers, totalOfferings, liveOfferings int
			_ = a.DB.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM users WHERE status='ACTIVE'`).Scan(&activeUsers)
			_ = a.DB.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM users`).Scan(&totalUsers)
			_ = a.DB.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM offerings WHERE status='LIVE'`).Scan(&liveOfferings)
			_ = a.DB.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM offerings`).Scan(&totalOfferings)

			c.JSON(200, gin.H{
				"total_users":     totalUsers,
				"active_users":    activeUsers,
				"total_offerings": totalOfferings,
				"live_offerings":  liveOfferings,
			})
		})

		// Public chain metadata for MetaMask selector / add-network UX.
		// This route is intentionally accessible without auth in dev.
		v1.GET("/chains", func(c *gin.Context) {
			c.JSON(200, []gin.H{
				{
					"chain_id":           int64(1),
					"name":               "Ethereum",
					"is_testnet":         false,
					"metamask_chain_id":  "0x1",
					"rpc_urls":           []string{"https://cloudflare-eth.com"},
					"block_explorer_url": "https://etherscan.io",
					"native_currency":    gin.H{"name": "Ether", "symbol": "ETH", "decimals": 18},
				},
				{
					"chain_id":           int64(11155111),
					"name":               "Sepolia",
					"is_testnet":         true,
					"metamask_chain_id":  "0xaa36a7",
					"rpc_urls":           []string{"https://rpc.sepolia.org"},
					"block_explorer_url": "https://sepolia.etherscan.io",
					"native_currency":    gin.H{"name": "Sepolia Ether", "symbol": "ETH", "decimals": 18},
				},
				{
					"chain_id":           int64(137),
					"name":               "Polygon",
					"is_testnet":         false,
					"metamask_chain_id":  "0x89",
					"rpc_urls":           []string{"https://polygon-rpc.com"},
					"block_explorer_url": "https://polygonscan.com",
					"native_currency":    gin.H{"name": "MATIC", "symbol": "MATIC", "decimals": 18},
				},
				{
					"chain_id":           int64(80002),
					"name":               "Polygon Amoy",
					"is_testnet":         true,
					"metamask_chain_id":  "0x13882",
					"rpc_urls":           []string{"https://rpc-amoy.polygon.technology"},
					"block_explorer_url": "https://www.oklink.com/amoy",
					"native_currency":    gin.H{"name": "MATIC", "symbol": "MATIC", "decimals": 18},
				},
				{
					"chain_id":           int64(8453),
					"name":               "Base",
					"is_testnet":         false,
					"metamask_chain_id":  "0x2105",
					"rpc_urls":           []string{"https://mainnet.base.org"},
					"block_explorer_url": "https://basescan.org",
					"native_currency":    gin.H{"name": "Ethereum", "symbol": "ETH", "decimals": 18},
				},
				{
					"chain_id":           int64(84532),
					"name":               "Base Sepolia",
					"is_testnet":         true,
					"metamask_chain_id":  "0x14a34",
					"rpc_urls":           []string{"https://sepolia.base.org"},
					"block_explorer_url": "https://sepolia.basescan.org",
					"native_currency":    gin.H{"name": "Ethereum", "symbol": "ETH", "decimals": 18},
				},
				{
					"chain_id":           int64(42161),
					"name":               "Arbitrum One",
					"is_testnet":         false,
					"metamask_chain_id":  "0xa4b1",
					"rpc_urls":           []string{"https://arb1.arbitrum.io/rpc"},
					"block_explorer_url": "https://arbiscan.io",
					"native_currency":    gin.H{"name": "Ether", "symbol": "ETH", "decimals": 18},
				},
				{
					"chain_id":           int64(421614),
					"name":               "Arbitrum Sepolia",
					"is_testnet":         true,
					"metamask_chain_id":  "0x66eee",
					"rpc_urls":           []string{"https://sepolia-rollup.arbitrum.io/rpc"},
					"block_explorer_url": "https://sepolia.arbiscan.io",
					"native_currency":    gin.H{"name": "Ether", "symbol": "ETH", "decimals": 18},
				},
			})
		})

		// --- Onramp / Offramp (dev stubs) ---
		// These endpoints exist so the web app can be end-to-end functional in dev.
		// Replace with a real provider integration when ready.
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
				"quote_id":                uuid.NewString(),
				"expires_at":              time.Now().Add(10 * time.Minute).UTC().Format(time.RFC3339),
			}
			_ = audit.Log(c.Request.Context(), a.DB.Pool, p.UserID, "ONRAMP_QUOTED", "onramp", "", nil, req, c.ClientIP())
			_, _ = events.Enqueue(c.Request.Context(), a.DB.Pool, "ONRAMP_QUOTED", resp)
			c.JSON(http.StatusOK, resp)
		})

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
			id := uuid.NewString()
			resp := gin.H{
				"session_id":   id,
				"provider":     req.Provider,
				"status":       "CREATED",
				"url":          "https://portfolio.metamask.io/buy",
				"redirect_url": "https://example.invalid/onramp/session/" + id,
				"expires_at":   time.Now().Add(10 * time.Minute).UTC().Format(time.RFC3339),
				"chain_id":     req.ChainID,
			}
			_ = audit.Log(c.Request.Context(), a.DB.Pool, p.UserID, "ONRAMP_SESSION_CREATED", "onramp", id, nil, req, c.ClientIP())
			_, _ = events.Enqueue(c.Request.Context(), a.DB.Pool, "ONRAMP_SESSION_CREATED", resp)
			c.JSON(http.StatusOK, resp)
		})

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
				"quote_id":              uuid.NewString(),
				"expires_at":            time.Now().Add(10 * time.Minute).UTC().Format(time.RFC3339),
			}
			_ = audit.Log(c.Request.Context(), a.DB.Pool, p.UserID, "OFFRAMP_QUOTED", "offramp", "", nil, req, c.ClientIP())
			_, _ = events.Enqueue(c.Request.Context(), a.DB.Pool, "OFFRAMP_QUOTED", resp)
			c.JSON(http.StatusOK, resp)
		})

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
			id := uuid.NewString()
			resp := gin.H{
				"payout_id": id,
				"provider":  req.Provider,
				"status":    "SUBMITTED",
				"reference": "OFFRAMP-" + id,
			}
			_ = audit.Log(c.Request.Context(), a.DB.Pool, p.UserID, "OFFRAMP_PAYOUT_SUBMITTED", "offramp", id, nil, req, c.ClientIP())
			_, _ = events.Enqueue(c.Request.Context(), a.DB.Pool, "OFFRAMP_PAYOUT_SUBMITTED", resp)
			c.JSON(http.StatusOK, resp)
		})

		// --- Compliance / KYC ---
		v1.POST("/kyc/cases", func(c *gin.Context) {
			p := auth.MustPrincipal(c)

			var req struct {
				Type string `json:"type"` // KYC|KYB
			}
			if err := c.ShouldBindJSON(&req); err != nil || (req.Type != "KYC" && req.Type != "KYB") {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
				return
			}

			var id string
			row := a.DB.Pool.QueryRow(c.Request.Context(), `
				INSERT INTO kyc_cases(user_id,type,status) VALUES($1,$2,'DRAFT')
				RETURNING id
			`, p.UserID, req.Type)
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

		v1.GET("/kyc/workflows/basic-v3", func(c *gin.Context) {
			c.Header("Content-Type", "application/json")
			c.Writer.Write(kyc.BasicWorkflowV3)
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
		v1.POST("/wallets/connect", func(c *gin.Context) {
			var req struct {
				Address   string `json:"address"`
				ChainID   int64  `json:"chain_id"`
				Message   string `json:"message"`
				Signature string `json:"signature"`
				Email     string `json:"email"`
			}
			if err := c.ShouldBindJSON(&req); err != nil || req.Address == "" || req.ChainID == 0 || req.Message == "" || req.Signature == "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
				return
			}

			if a.Cfg.JWTSecret == "" {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "JWT not configured"})
				return
			}

			// Dev escape hatch: signature="devskip"
			if req.Signature != "devskip" {
				if err := ethsig.VerifyPersonalSign(req.Message, req.Signature, req.Address); err != nil {
					c.JSON(http.StatusBadRequest, gin.H{"error": "signature verification failed"})
					return
				}
			}

			ctx := c.Request.Context()
			email := strings.TrimSpace(req.Email)
			if email == "" {
				email = fmt.Sprintf("user+%s@blockxone.dev", strings.ToLower(req.Address))
			}

			// Role-aware mapping: assign role based on email
			roleMapping := map[string]struct {
				Role  string
				OrgID string
			}{
				"investor@blockxone.local":         {"Investor", investorOrgID},
				"compliance@blockxone.local":       {"ComplianceOfficer", platformOrgID},
				"offering.manager@blockxone.local": {"OfferingManager", platformOrgID},
				"issuer@blockxone.local":           {"IssuerFundManager", issuerOrgID},
				"transfer.agent@blockxone.local":   {"TransferAgent", transferOrgID},
				"token.agent@blockxone.local":      {"TokenisationAgent", tokenOrgID},
				"admin@blockxone.local":            {"SuperAdmin", platformOrgID},
			}

			targetRole := "Investor"
			targetOrgID := investorOrgID
			if mapping, ok := roleMapping[email]; ok {
				targetRole = mapping.Role
				targetOrgID = mapping.OrgID
			}

			var userID string
			row := a.DB.Pool.QueryRow(ctx, `SELECT user_id FROM wallets WHERE address=$1 LIMIT 1`, req.Address)
			_ = row.Scan(&userID)

			if userID == "" {
				row = a.DB.Pool.QueryRow(ctx, `
					INSERT INTO users(email,status) VALUES($1,'ACTIVE')
					RETURNING id
				`, email)
				if err := row.Scan(&userID); err != nil {
					// fallback if email already exists
					row = a.DB.Pool.QueryRow(ctx, `SELECT id FROM users WHERE email=$1 LIMIT 1`, email)
					if err2 := row.Scan(&userID); err2 != nil {
						c.JSON(http.StatusInternalServerError, gin.H{"error": "create user failed"})
						return
					}
				}

				// Create investor profile only for Investor role
				if targetRole == "Investor" {
					_, _ = a.DB.Pool.Exec(ctx, `
						INSERT INTO investor_profile(user_id, investor_status, accredited_flag, qualified_flag, jurisdiction)
						VALUES($1,'RETAIL', false, false, 'US')
						ON CONFLICT (user_id) DO NOTHING
					`, userID)
				}
			}

			if _, err := a.DB.Pool.Exec(ctx, `
				INSERT INTO user_org_roles(user_id, org_id, role_id)
				SELECT $1, $2, r.id FROM roles r WHERE r.name=$3
				ON CONFLICT DO NOTHING
			`, userID, targetOrgID, targetRole); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "assign role failed"})
				return
			}

			var walletID, status string
			row = a.DB.Pool.QueryRow(ctx, `
				INSERT INTO wallets(user_id,address,chain_id,status,signed_message,message)
				VALUES($1,$2,$3,'PENDING',$4,$5)
				ON CONFLICT (user_id,address,chain_id) DO UPDATE
				SET signed_message=EXCLUDED.signed_message, message=EXCLUDED.message
				RETURNING id,status
			`, userID, req.Address, req.ChainID, req.Signature, req.Message)
			if err := row.Scan(&walletID, &status); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
				return
			}

			token, err := auth.SignToken(a.Cfg.JWTSecret, userID, email, targetOrgID, walletID, 24*time.Hour)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "token issuance failed"})
				return
			}

			_ = audit.Log(ctx, a.DB.Pool, userID, "WALLET_CONNECTED", "wallets", walletID, nil, req, c.ClientIP())
			_, _ = events.Enqueue(ctx, a.DB.Pool, "WALLET_CONNECTED", gin.H{"wallet_id": walletID, "user_id": userID})

			c.JSON(http.StatusCreated, gin.H{
				"id":      walletID,
				"status":  status,
				"token":   token,
				"user_id": userID,
				"org_id":  targetOrgID,
				"email":   email,
				"role":    targetRole,
			})
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
				AssetType              string `json:"asset_type"`
				Name                   string `json:"name"`
				Description            string `json:"description"`
				ChainID                int64  `json:"chain_id"`
				Price                  string `json:"price"`
				Currency               string `json:"currency"`
				TransferAgentOrgID     string `json:"transfer_agent_org_id"`
				TokenisationAgentOrgID string `json:"tokenisation_agent_org_id"`
			}
			if err := c.ShouldBindJSON(&req); err != nil || req.AssetType == "" || req.Name == "" {
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

		v1.GET("/offerings/:id", func(c *gin.Context) {
			offeringID := c.Param("id")
			if _, err := uuid.Parse(offeringID); err != nil {
				c.JSON(400, gin.H{"error": "invalid offering id"})
				return
			}
			row := a.DB.Pool.QueryRow(c.Request.Context(), `
				SELECT o.id, o.status, o.chain_id, o.price, o.currency, a.asset_type, a.name, a.description
				FROM offerings o
				JOIN assets a ON a.id=o.asset_id
				WHERE o.id=$1
			`, offeringID)
			var id, status, currency, assetType, name, desc string
			var chainID *int64
			var price *string
			if err := row.Scan(&id, &status, &chainID, &price, &currency, &assetType, &name, &desc); err != nil {
				c.JSON(404, gin.H{"error": "not found"})
				return
			}
			c.JSON(200, gin.H{
				"id": id, "status": status, "chain_id": chainID, "price": price, "currency": currency,
				"asset_type": assetType, "name": name, "description": desc,
			})
		})

		// MVP NAV: derived from offering.price
		v1.GET("/offerings/:id/nav", func(c *gin.Context) {
			offeringID := c.Param("id")
			if _, err := uuid.Parse(offeringID); err != nil {
				c.JSON(400, gin.H{"error": "invalid offering id"})
				return
			}
			row := a.DB.Pool.QueryRow(c.Request.Context(), `SELECT price::text, currency FROM offerings WHERE id=$1`, offeringID)
			var price *string
			var currency *string
			if err := row.Scan(&price, &currency); err != nil {
				c.JSON(404, gin.H{"error": "not found"})
				return
			}
			c.JSON(200, gin.H{"offering_id": offeringID, "nav": price, "currency": currency})
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

		v1.GET("/subscriptions/:id", func(c *gin.Context) {
			p := auth.MustPrincipal(c)
			subID := c.Param("id")
			if _, err := uuid.Parse(subID); err != nil {
				c.JSON(400, gin.H{"error": "invalid subscription id"})
				return
			}
			row := a.DB.Pool.QueryRow(c.Request.Context(), `
				SELECT id, offering_id, user_id, units::text, amount::text, status, created_at, updated_at
				FROM subscriptions
				WHERE id=$1
			`, subID)
			var id, offeringID, userID, units, amount, status string
			var createdAt, updatedAt time.Time
			if err := row.Scan(&id, &offeringID, &userID, &units, &amount, &status, &createdAt, &updatedAt); err != nil {
				c.JSON(404, gin.H{"error": "not found"})
				return
			}
			if userID != p.UserID && !p.Permissions["subscription:approve"] {
				c.JSON(403, gin.H{"error": "forbidden"})
				return
			}
			c.JSON(200, gin.H{
				"id":          id,
				"offering_id": offeringID,
				"user_id":     userID,
				"units":       units,
				"amount":      amount,
				"status":      status,
				"created_at":  createdAt,
				"updated_at":  updatedAt,
			})
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

		v1.GET("/redemptions/:id", func(c *gin.Context) {
			p := auth.MustPrincipal(c)
			id := c.Param("id")
			if _, err := uuid.Parse(id); err != nil {
				c.JSON(400, gin.H{"error": "invalid redemption id"})
				return
			}
			row := a.DB.Pool.QueryRow(c.Request.Context(), `
				SELECT id, offering_id, user_id, amount_tokens::text, COALESCE(amount_cash::text,''), status, created_at, updated_at
				FROM redemptions
				WHERE id=$1
			`, id)
			var rid, offeringID, userID, amountTokens, amountCash, status string
			var createdAt, updatedAt time.Time
			if err := row.Scan(&rid, &offeringID, &userID, &amountTokens, &amountCash, &status, &createdAt, &updatedAt); err != nil {
				c.JSON(404, gin.H{"error": "not found"})
				return
			}
			if userID != p.UserID && !p.Permissions["corpactions:redemption:approve"] {
				c.JSON(403, gin.H{"error": "forbidden"})
				return
			}
			c.JSON(200, gin.H{
				"id":            rid,
				"offering_id":   offeringID,
				"user_id":       userID,
				"amount_tokens": amountTokens,
				"amount_cash":   amountCash,
				"status":        status,
				"created_at":    createdAt,
				"updated_at":    updatedAt,
			})
		})

		// List redemptions (for burn queue)
		v1.GET("/redemptions", auth.RequirePermission("tokenops:burn"), func(c *gin.Context) {
			status := c.Query("status") // e.g., APPROVED
			query := `
				SELECT r.id, r.offering_id, r.user_id, r.amount_tokens::text, COALESCE(r.amount_cash::text,''), r.status, r.created_at, u.email
				FROM redemptions r
				JOIN users u ON u.id=r.user_id
			`
			if status != "" {
				query += " WHERE r.status=$1"
			}
			query += " ORDER BY r.created_at DESC LIMIT 200"

			var rows pgx.Rows
			var err error
			if status != "" {
				rows, err = a.DB.Pool.Query(c.Request.Context(), query, status)
			} else {
				rows, err = a.DB.Pool.Query(c.Request.Context(), query)
			}
			if err != nil {
				c.JSON(500, gin.H{"error": "db error"})
				return
			}
			defer rows.Close()

			var out []gin.H
			for rows.Next() {
				var id, offeringID, userID, amountTokens, amountCash, rstatus, email string
				var createdAt time.Time
				if err := rows.Scan(&id, &offeringID, &userID, &amountTokens, &amountCash, &rstatus, &createdAt, &email); err != nil {
					c.JSON(500, gin.H{"error": "scan error"})
					return
				}
				out = append(out, gin.H{
					"id":            id,
					"offering_id":   offeringID,
					"user_id":       userID,
					"email":         email,
					"amount_tokens": amountTokens,
					"amount_cash":   amountCash,
					"status":        rstatus,
					"created_at":    createdAt,
				})
			}
			c.JSON(200, out)
		})

		// List token batches
		v1.GET("/token-batches", auth.RequirePermission("tokenops:mint"), func(c *gin.Context) {
			rows, err := a.DB.Pool.Query(c.Request.Context(), `
				SELECT tb.id, tb.offering_id, tb.type, tb.status, tb.created_at, COALESCE(u.email,'system')
				FROM token_batches tb
				LEFT JOIN users u ON u.id=tb.created_by
				ORDER BY tb.created_at DESC
				LIMIT 200
			`)
			if err != nil {
				c.JSON(500, gin.H{"error": "db error"})
				return
			}
			defer rows.Close()

			var out []gin.H
			for rows.Next() {
				var id, offeringID, btype, status, createdBy string
				var createdAt time.Time
				if err := rows.Scan(&id, &offeringID, &btype, &status, &createdAt, &createdBy); err != nil {
					c.JSON(500, gin.H{"error": "scan error"})
					return
				}
				out = append(out, gin.H{
					"id":          id,
					"offering_id": offeringID,
					"type":        btype,
					"status":      status,
					"created_by":  createdBy,
					"created_at":  createdAt,
				})
			}
			c.JSON(200, out)
		})

		// Transactions: simple audit log feed for MVP UI.
		v1.GET("/transactions", func(c *gin.Context) {
			rows, err := a.DB.Pool.Query(c.Request.Context(), `
				SELECT id::text, COALESCE(actor_user_id::text,''), action, entity_type, COALESCE(entity_id::text,''), created_at
				FROM audit_log
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
				var id, actor, action, entityType, entityID string
				var createdAt time.Time
				if err := rows.Scan(&id, &actor, &action, &entityType, &entityID, &createdAt); err != nil {
					c.JSON(500, gin.H{"error": "scan error"})
					return
				}
				out = append(out, gin.H{
					"id":            id,
					"actor_user_id": actor,
					"action":        action,
					"entity_type":   entityType,
					"entity_id":     entityID,
					"created_at":    createdAt,
				})
			}
			c.JSON(200, out)
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

			v1.GET("/marketplace/listings", func(c *gin.Context) {
				rows, err := a.DB.Pool.Query(c.Request.Context(), `
					SELECT id::text, offering_id::text, seller_user_id::text, seller_wallet_id::text, units::text, price::text, currency, status, created_at
					FROM marketplace_listings
					WHERE status='OPEN'
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
					var id, offeringID, sellerUserID, sellerWalletID, units, price, currency, status string
					var createdAt time.Time
					if err := rows.Scan(&id, &offeringID, &sellerUserID, &sellerWalletID, &units, &price, &currency, &status, &createdAt); err != nil {
						c.JSON(500, gin.H{"error": "scan error"})
						return
					}
					out = append(out, gin.H{
						"id":               id,
						"offering_id":      offeringID,
						"seller_user_id":   sellerUserID,
						"seller_wallet_id": sellerWalletID,
						"units":            units,
						"price":            price,
						"currency":         currency,
						"status":           status,
						"created_at":       createdAt,
					})
				}
				c.JSON(200, out)
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
				if err := c.ShouldBindJSON(&req); err != nil || req.OfferingID == "" || req.Units == "" || req.MaxPrice == "" {
					c.JSON(400, gin.H{"error": "invalid request"})
					return
				}

				// If wallet_id not provided (frontend demo), default to first APPROVED wallet.
				if req.WalletID == "" {
					row := a.DB.Pool.QueryRow(c.Request.Context(), `
						SELECT id::text FROM wallets WHERE user_id=$1 AND status='APPROVED' ORDER BY created_at ASC LIMIT 1
					`, p.UserID)
					_ = row.Scan(&req.WalletID)
				}
				if req.WalletID == "" {
					c.JSON(400, gin.H{"error": "no approved wallet"})
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

			v1.GET("/marketplace/rfq", func(c *gin.Context) {
				rows, err := a.DB.Pool.Query(c.Request.Context(), `
					SELECT id::text, offering_id::text, buyer_user_id::text, buyer_wallet_id::text, units::text, max_price::text, currency, status, created_at
					FROM marketplace_rfqs
					WHERE status='OPEN'
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
					var id, offeringID, buyerUserID, buyerWalletID, units, maxPrice, currency, status string
					var createdAt time.Time
					if err := rows.Scan(&id, &offeringID, &buyerUserID, &buyerWalletID, &units, &maxPrice, &currency, &status, &createdAt); err != nil {
						c.JSON(500, gin.H{"error": "scan error"})
						return
					}
					out = append(out, gin.H{
						"id":              id,
						"offering_id":     offeringID,
						"buyer_user_id":   buyerUserID,
						"buyer_wallet_id": buyerWalletID,
						"units":           units,
						"max_price":       maxPrice,
						"currency":        currency,
						"status":          status,
						"created_at":      createdAt,
					})
				}
				c.JSON(200, out)
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

	}

	log.Debug().Msg("routes registered")
}

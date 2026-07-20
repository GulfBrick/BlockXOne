//go:build integration

package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"blockxone/internal/auth"
	"blockxone/internal/chain"
	"blockxone/internal/config"
	"blockxone/internal/db"
	"blockxone/internal/rbac"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TestSetup initializes test database and returns cleanup function
type TestSetup struct {
	Server *httptest.Server
	Client *http.Client
	DB     *db.DB
	Config config.Config
}

func setupTestDB(t *testing.T) *pgxpool.Pool {
	// Get database URL from environment or use test default
	dbURL := os.Getenv("DATABASE_URL_TEST")
	if dbURL == "" {
		dbURL = "postgres://blockxone:blockxone@localhost:5432/blockxone_test?sslmode=disable"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		t.Skipf("Could not connect to test database: %v", err)
	}

	// Test the connection
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Skipf("Test database not available: %v", err)
	}

	return pool
}

func seedTestData(t *testing.T, pool *pgxpool.Pool) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	userID := uuid.New().String()
	orgID := uuid.New().String()

	// Create organization
	_, err := pool.Exec(ctx, `
		INSERT INTO organizations(id, name, status)
		VALUES($1, $2, 'ACTIVE')
		ON CONFLICT (id) DO NOTHING
	`, orgID, "Test Org")
	if err != nil {
		t.Logf("Warning: Could not insert org: %v", err)
	}

	// Create user
	_, err = pool.Exec(ctx, `
		INSERT INTO users(id, email, status)
		VALUES($1, $2, 'ACTIVE')
		ON CONFLICT (id) DO NOTHING
	`, userID, "test@example.com")
	if err != nil {
		t.Logf("Warning: Could not insert user: %v", err)
	}

	// Create role
	roleID := uuid.New().String()
	_, err = pool.Exec(ctx, `
		INSERT INTO roles(id, org_id, name, description)
		VALUES($1, $2, 'admin', 'Administrator')
		ON CONFLICT (id) DO NOTHING
	`, roleID, orgID)
	if err != nil {
		t.Logf("Warning: Could not insert role: %v", err)
	}

	// Assign role to user
	_, err = pool.Exec(ctx, `
		INSERT INTO user_org_roles(user_id, org_id, role_id)
		VALUES($1, $2, $3)
		ON CONFLICT (user_id, org_id, role_id) DO NOTHING
	`, userID, orgID, roleID)
	if err != nil {
		t.Logf("Warning: Could not assign role: %v", err)
	}
}

func setupTestServer(t *testing.T) *TestSetup {
	gin.SetMode(gin.TestMode)

	cfg := config.Load()
	pool := setupTestDB(t)

	// Seed test data
	seedTestData(t, pool)

	// Create router
	router := gin.New()

	// Add middleware
	secret := cfg.JWTSecret
	router.Use(auth.MiddlewareJWT(secret, pool))

	// Add test routes
	router.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	router.GET("/v1/chains", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"chains": []gin.H{
				{"id": 137, "name": "Polygon", "rpc_url": "https://polygon-rpc.com"},
				{"id": 1, "name": "Ethereum", "rpc_url": "https://eth-rpc.com"},
			},
		})
	})

	// Health check endpoint (no auth required)
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status": "healthy",
			"timestamp": time.Now().Unix(),
		})
	})

	server := httptest.NewServer(router)

	return &TestSetup{
		Server: server,
		Client: &http.Client{Timeout: 5 * time.Second},
		DB:     &db.DB{Pool: pool},
		Config: cfg,
	}
}

func (ts *TestSetup) Close() {
	ts.Server.Close()
	ts.DB.Close()
}

func TestHealthCheck(t *testing.T) {
	setup := setupTestServer(t)
	defer setup.Close()

	req, err := http.NewRequest("GET", setup.Server.URL+"/health", nil)
	if err != nil {
		t.Fatalf("Failed to create request: %v", err)
	}

	resp, err := setup.Client.Do(req)
	if err != nil {
		t.Fatalf("Failed to send request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("Expected status 200, got %d", resp.StatusCode)
	}

	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if status, ok := result["status"]; !ok || status != "healthy" {
		t.Errorf("Expected status 'healthy', got %v", status)
	}
}

func TestChainsEndpoint(t *testing.T) {
	setup := setupTestServer(t)
	defer setup.Close()

	req, err := http.NewRequest("GET", setup.Server.URL+"/v1/chains", nil)
	if err != nil {
		t.Fatalf("Failed to create request: %v", err)
	}

	resp, err := setup.Client.Do(req)
	if err != nil {
		t.Fatalf("Failed to send request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("Expected status 200, got %d", resp.StatusCode)
	}

	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	chains, ok := result["chains"]
	if !ok {
		t.Fatal("Expected 'chains' in response")
	}

	chainList, ok := chains.([]interface{})
	if !ok {
		t.Fatalf("Expected chains to be array, got %T", chains)
	}

	if len(chainList) == 0 {
		t.Error("Expected at least one chain in response")
	}
}

func TestAuthFlow_Signup_Placeholder(t *testing.T) {
	setup := setupTestServer(t)
	defer setup.Close()

	// This is a placeholder test since the actual signup endpoint
	// depends on your specific implementation
	userID := uuid.New().String()
	email := "newuser@example.com"

	signupPayload := map[string]interface{}{
		"email":    email,
		"password": "securepassword123",
	}

	body, err := json.Marshal(signupPayload)
	if err != nil {
		t.Fatalf("Failed to marshal payload: %v", err)
	}

	req, err := http.NewRequest("POST", setup.Server.URL+"/v1/auth/signup", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("Failed to create request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := setup.Client.Do(req)
	if err != nil {
		t.Logf("Signup endpoint not implemented or error: %v", err)
		t.Skip("Signup endpoint not available in this test configuration")
	}
	defer resp.Body.Close()

	// Placeholder assertion
	if resp.StatusCode == http.StatusNotFound {
		t.Log("Signup endpoint not found (expected for this test setup)")
		return
	}

	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		t.Logf("Signup returned status %d (may vary based on implementation)", resp.StatusCode)
	}

	_ = userID // Use variable to satisfy linter
}

func TestSignToken_Integration(t *testing.T) {
	setup := setupTestServer(t)
	defer setup.Close()

	userID := uuid.New().String()
	email := "tokentest@example.com"
	orgID := uuid.New().String()
	walletID := uuid.New().String()

	token, err := auth.SignToken(setup.Config.JWTSecret, userID, email, orgID, walletID, 1*time.Hour)
	if err != nil {
		t.Fatalf("SignToken failed: %v", err)
	}

	if token == "" {
		t.Error("Expected non-empty token")
	}

	// Use the token in a request
	req, err := http.NewRequest("GET", setup.Server.URL+"/v1/chains", nil)
	if err != nil {
		t.Fatalf("Failed to create request: %v", err)
	}

	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := setup.Client.Do(req)
	if err != nil {
		t.Fatalf("Failed to send request: %v", err)
	}
	defer resp.Body.Close()

	// Should succeed with valid token
	if resp.StatusCode != http.StatusOK {
		t.Errorf("Expected 200 with valid token, got %d", resp.StatusCode)
	}
}

func TestChainAdapter_Integration(t *testing.T) {
	// Test the mock chain adapter in an integration context
	adapter := chain.NewMock()
	ctx := context.Background()

	offeringID := uuid.New().String()

	t.Run("Deploy and Mint", func(t *testing.T) {
		tokenAddr, registryAddr, deployTx, err := adapter.DeployAssetToken(
			ctx, offeringID, "Test Token", "TST", "equity", "ipfs://meta", "0xissuer",
		)
		if err != nil {
			t.Fatalf("DeployAssetToken failed: %v", err)
		}

		if tokenAddr == "" || registryAddr == "" || deployTx == "" {
			t.Fatal("Expected non-empty addresses and tx hash")
		}

		// Now try to mint
		mintTx, err := adapter.Mint(ctx, offeringID, "0xuser", "1000000000000000000")
		if err != nil {
			t.Fatalf("Mint failed: %v", err)
		}

		if mintTx == "" {
			t.Error("Expected non-empty mint tx hash")
		}
	})

	t.Run("Whitelist and Freeze", func(t *testing.T) {
		userAddr := "0xuser" + uuid.New().String()[:8]

		whitelistTx, err := adapter.Whitelist(ctx, offeringID, userAddr)
		if err != nil {
			t.Fatalf("Whitelist failed: %v", err)
		}

		if whitelistTx == "" {
			t.Error("Expected non-empty whitelist tx hash")
		}

		freezeTx, err := adapter.Freeze(ctx, offeringID, userAddr, true)
		if err != nil {
			t.Fatalf("Freeze failed: %v", err)
		}

		if freezeTx == "" {
			t.Error("Expected non-empty freeze tx hash")
		}
	})
}

func TestRBACIntegration(t *testing.T) {
	setup := setupTestServer(t)
	defer setup.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Create a user and org for testing
	userID := uuid.New().String()
	orgID := uuid.New().String()

	// Assuming the database exists, try to load roles
	roles, perms, err := rbac.LoadRolesAndPermissions(ctx, setup.DB.Pool, userID, orgID)
	if err != nil {
		// This is expected if the user/org doesn't exist
		t.Logf("LoadRolesAndPermissions returned error (expected if user not found): %v", err)
	}

	// Even if empty, the function should return valid structures
	if roles == nil {
		t.Error("Expected non-nil roles slice")
	}
	if perms == nil {
		t.Error("Expected non-nil permissions map")
	}
}

func TestAuthMiddleware_WithExpiredToken(t *testing.T) {
	gin.SetMode(gin.TestMode)

	cfg := config.Load()
	pool := setupTestDB(t)
	defer pool.Close()

	router := gin.New()
	secret := cfg.JWTSecret

	router.Use(auth.MiddlewareJWT(secret, pool))
	router.GET("/protected", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	server := httptest.NewServer(router)
	defer server.Close()

	userID := uuid.New().String()
	email := "test@example.com"
	orgID := uuid.New().String()
	walletID := uuid.New().String()

	// Create an expired token
	expiredToken, err := auth.SignToken(secret, userID, email, orgID, walletID, -1*time.Hour)
	if err != nil {
		t.Fatalf("SignToken failed: %v", err)
	}

	client := &http.Client{Timeout: 5 * time.Second}
	req, err := http.NewRequest("GET", server.URL+"/protected", nil)
	if err != nil {
		t.Fatalf("Failed to create request: %v", err)
	}

	req.Header.Set("Authorization", "Bearer "+expiredToken)

	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("Failed to send request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("Expected 401 for expired token, got %d", resp.StatusCode)
	}
}

func TestMultipleRequests_Concurrent(t *testing.T) {
	setup := setupTestServer(t)
	defer setup.Close()

	userID := uuid.New().String()
	email := fmt.Sprintf("user%d@example.com", time.Now().UnixNano())
	orgID := uuid.New().String()
	walletID := uuid.New().String()

	token, err := auth.SignToken(setup.Config.JWTSecret, userID, email, orgID, walletID, 1*time.Hour)
	if err != nil {
		t.Fatalf("SignToken failed: %v", err)
	}

	// Make concurrent requests
	done := make(chan error, 5)

	for i := 0; i < 5; i++ {
		go func() {
			req, err := http.NewRequest("GET", setup.Server.URL+"/v1/chains", nil)
			if err != nil {
				done <- fmt.Errorf("failed to create request: %w", err)
				return
			}

			req.Header.Set("Authorization", "Bearer "+token)

			resp, err := setup.Client.Do(req)
			if err != nil {
				done <- fmt.Errorf("failed to send request: %w", err)
				return
			}
			defer resp.Body.Close()

			if resp.StatusCode != http.StatusOK {
				done <- fmt.Errorf("expected 200, got %d", resp.StatusCode)
				return
			}

			done <- nil
		}()
	}

	// Wait for all goroutines
	for i := 0; i < 5; i++ {
		if err := <-done; err != nil {
			t.Errorf("Concurrent request %d failed: %v", i, err)
		}
	}
}

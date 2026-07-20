package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"blockxone/internal/app"
	"blockxone/internal/auth"
	"blockxone/internal/chain"
	"blockxone/internal/db"

	"github.com/gin-gonic/gin"
)

// allERC3643Permissions returns a permissions map granting every
// ERC-3643 related permission. Used by the test auth middleware.
func allERC3643Permissions() map[string]bool {
	return map[string]bool{
		"tokenops:pause":             true,
		"tokenops:unpause":           true,
		"tokenops:recover":           true,
		"tokenops:identity_register": true,
		"tokenops:identity_delete":   true,
		"tokenops:compliance_module": true,
		"tokenops:deploy_erc3643":    true,
		"tokenops:freeze":            true,
		"tokenops:whitelist":         true,
		"tokenops:mint":              true,
		"tokenops:burn":              true,
		"tokenops:force_transfer":    true,
	}
}

// setupERC3643Router creates a Gin engine with the ERC-3643 routes registered,
// using a mock chain adapter and a test principal with all permissions.
// Returns the router ready for httptest.
func setupERC3643Router() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(gin.Recovery()) // catch panics from nil DB in write handlers

	// Test auth middleware: injects a fully-permissioned Principal
	// matching what auth.FromContext / auth.RequirePermission expect.
	r.Use(func(c *gin.Context) {
		userID := c.GetHeader("X-Dev-User-Id")
		if userID == "" {
			userID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
		}
		email := c.GetHeader("X-Dev-Email")
		if email == "" {
			email = "test@blockxone.dev"
		}

		p := &auth.Principal{
			UserID:      userID,
			Email:       email,
			OrgID:       "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
			Roles:       []string{"SuperAdmin"},
			Permissions: allERC3643Permissions(),
		}
		c.Set("principal", p)
		c.Next()
	})

	a := &app.App{
		Chain: chain.NewMock(),
		DB:    &db.DB{}, // Pool is nil — audit.Log and events.Enqueue gracefully skip nil pools
	}

	v1 := r.Group("/v1")
	RegisterERC3643Routes(v1, a)

	return r
}

func TestERC3643_PauseUnpause(t *testing.T) {
	r := setupERC3643Router()

	// Pause
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/v1/offerings/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/pause", nil)
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp["paused"] != true {
		t.Errorf("expected paused=true, got %v", resp["paused"])
	}
	if resp["tx_hash"] == nil || resp["tx_hash"] == "" {
		t.Error("expected non-empty tx_hash")
	}

	// Unpause
	w2 := httptest.NewRecorder()
	req2, _ := http.NewRequest("POST", "/v1/offerings/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/unpause", nil)
	req2.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w2, req2)

	if w2.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w2.Code, w2.Body.String())
	}
	var resp2 map[string]interface{}
	_ = json.Unmarshal(w2.Body.Bytes(), &resp2)
	if resp2["paused"] != false {
		t.Errorf("expected paused=false, got %v", resp2["paused"])
	}
}

func TestERC3643_PauseInvalidOfferingID(t *testing.T) {
	r := setupERC3643Router()
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/v1/offerings/not-a-uuid/pause", nil)
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != 400 {
		t.Errorf("expected 400 for bad UUID, got %d", w.Code)
	}
}

func TestERC3643_FrozenCheck(t *testing.T) {
	r := setupERC3643Router()

	// By default, address is not frozen
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/v1/offerings/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/frozen/0x1234", nil)
	r.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var resp map[string]interface{}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["frozen"] != false {
		t.Errorf("expected frozen=false by default, got %v", resp["frozen"])
	}
}

func TestERC3643_IdentityRegisterAndVerify(t *testing.T) {
	r := setupERC3643Router()

	// Register identity
	body, _ := json.Marshal(map[string]interface{}{
		"investor": "0xInvestor123",
		"identity": "0xIdentityContract",
		"country":  710, // South Africa ISO 3166-1 numeric
	})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/v1/offerings/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/identity", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatalf("register identity: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp map[string]interface{}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["tx_hash"] == nil || resp["tx_hash"] == "" {
		t.Error("expected non-empty tx_hash")
	}

	// Verify identity — should now be verified
	w2 := httptest.NewRecorder()
	req2, _ := http.NewRequest("GET", "/v1/offerings/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/identity/0xInvestor123/verified", nil)
	r.ServeHTTP(w2, req2)

	if w2.Code != 200 {
		t.Fatalf("verify identity: expected 200, got %d", w2.Code)
	}
	var resp2 map[string]interface{}
	_ = json.Unmarshal(w2.Body.Bytes(), &resp2)
	if resp2["verified"] != true {
		t.Errorf("expected verified=true after register, got %v", resp2["verified"])
	}
}

func TestERC3643_IdentityDeleteAndVerify(t *testing.T) {
	r := setupERC3643Router()

	// Register first
	body, _ := json.Marshal(map[string]interface{}{
		"investor": "0xDeleteMe",
		"identity": "0xIdentity",
		"country":  840,
	})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/v1/offerings/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/identity", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("register: %d %s", w.Code, w.Body.String())
	}

	// Delete
	w2 := httptest.NewRecorder()
	req2, _ := http.NewRequest("DELETE", "/v1/offerings/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/identity/0xDeleteMe", nil)
	r.ServeHTTP(w2, req2)
	if w2.Code != 200 {
		t.Fatalf("delete: %d %s", w2.Code, w2.Body.String())
	}

	// Verify — should no longer be verified
	w3 := httptest.NewRecorder()
	req3, _ := http.NewRequest("GET", "/v1/offerings/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/identity/0xDeleteMe/verified", nil)
	r.ServeHTTP(w3, req3)
	if w3.Code != 200 {
		t.Fatalf("verify after delete: %d", w3.Code)
	}
	var resp map[string]interface{}
	_ = json.Unmarshal(w3.Body.Bytes(), &resp)
	if resp["verified"] != false {
		t.Errorf("expected verified=false after delete, got %v", resp["verified"])
	}
}

func TestERC3643_IdentityRegisterMissingFields(t *testing.T) {
	r := setupERC3643Router()

	// Missing investor
	body, _ := json.Marshal(map[string]interface{}{
		"identity": "0xIdentity",
	})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/v1/offerings/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/identity", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != 400 {
		t.Errorf("expected 400 for missing investor, got %d", w.Code)
	}
}

func TestERC3643_ComplianceCanTransfer(t *testing.T) {
	r := setupERC3643Router()

	offeringID := "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
	from := "0xFrom"
	to := "0xTo"

	// Without registering — should NOT be allowed (mock requires both registered)
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/v1/offerings/"+offeringID+"/compliance/can-transfer?from="+from+"&to="+to+"&amount=100", nil)
	r.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var resp map[string]interface{}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["allowed"] != false {
		t.Errorf("expected allowed=false when neither party registered, got %v", resp["allowed"])
	}

	// Register both sides
	for _, addr := range []string{from, to} {
		body, _ := json.Marshal(map[string]interface{}{
			"investor": addr,
			"identity": "0xId",
			"country":  710,
		})
		w2 := httptest.NewRecorder()
		req2, _ := http.NewRequest("POST", "/v1/offerings/"+offeringID+"/identity", bytes.NewReader(body))
		req2.Header.Set("Content-Type", "application/json")
		r.ServeHTTP(w2, req2)
		if w2.Code != 200 {
			t.Fatalf("register %s: %d", addr, w2.Code)
		}
	}

	// Now should be allowed
	w3 := httptest.NewRecorder()
	req3, _ := http.NewRequest("GET", "/v1/offerings/"+offeringID+"/compliance/can-transfer?from="+from+"&to="+to+"&amount=100", nil)
	r.ServeHTTP(w3, req3)

	if w3.Code != 200 {
		t.Fatalf("expected 200, got %d", w3.Code)
	}
	var resp3 map[string]interface{}
	_ = json.Unmarshal(w3.Body.Bytes(), &resp3)
	if resp3["allowed"] != true {
		t.Errorf("expected allowed=true when both registered, got %v", resp3["allowed"])
	}
}

func TestERC3643_CanTransferMissingParams(t *testing.T) {
	r := setupERC3643Router()

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/v1/offerings/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/compliance/can-transfer?from=0x1", nil)
	r.ServeHTTP(w, req)

	if w.Code != 400 {
		t.Errorf("expected 400 for missing params, got %d", w.Code)
	}
}

func TestERC3643_RecoverTokens_ValidationOnly(t *testing.T) {
	// The full recover-tokens handler requires a DB connection for the
	// transfers ledger INSERT and audit log. We only test validation here;
	// the happy path is covered by integration tests with a real DB.
	r := setupERC3643Router()

	// Missing all fields → 400
	body, _ := json.Marshal(map[string]interface{}{})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/v1/offerings/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/recover-tokens", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != 400 {
		t.Errorf("expected 400 for empty body, got %d", w.Code)
	}

	// Missing recovery_address → 400
	body2, _ := json.Marshal(map[string]interface{}{
		"lost_address": "0xLost",
		"amount":       "1000",
	})
	w2 := httptest.NewRecorder()
	req2, _ := http.NewRequest("POST", "/v1/offerings/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/recover-tokens", bytes.NewReader(body2))
	req2.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w2, req2)
	if w2.Code != 400 {
		t.Errorf("expected 400 for missing recovery_address, got %d", w2.Code)
	}

	// Bad UUID → 400
	body3, _ := json.Marshal(map[string]interface{}{
		"lost_address":     "0xLost",
		"recovery_address": "0xRecov",
		"amount":           "100",
	})
	w3 := httptest.NewRecorder()
	req3, _ := http.NewRequest("POST", "/v1/offerings/not-a-uuid/recover-tokens", bytes.NewReader(body3))
	req3.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w3, req3)
	if w3.Code != 400 {
		t.Errorf("expected 400 for bad UUID, got %d", w3.Code)
	}
}

func TestERC3643_DeployERC3643_ValidationOnly(t *testing.T) {
	// The full deploy handler requires a DB connection to look up the offering
	// and store the token address. We only test validation here.
	r := setupERC3643Router()

	// Bad UUID → 400
	body, _ := json.Marshal(map[string]interface{}{
		"symbol":            "BXO",
		"identity_registry": "0xIR",
		"compliance":        "0xC",
	})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/v1/offerings/not-a-uuid/deploy-erc3643", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != 400 {
		t.Errorf("expected 400 for bad UUID, got %d", w.Code)
	}

	// Missing required addresses → 400
	body2, _ := json.Marshal(map[string]interface{}{
		"symbol": "BXO",
	})
	w2 := httptest.NewRecorder()
	req2, _ := http.NewRequest("POST", "/v1/offerings/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/deploy-erc3643", bytes.NewReader(body2))
	req2.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w2, req2)
	if w2.Code != 400 {
		t.Errorf("expected 400 for missing addresses, got %d", w2.Code)
	}

	// Decimals > 18 → 400
	body3, _ := json.Marshal(map[string]interface{}{
		"symbol":            "BXO",
		"decimals":          19,
		"identity_registry": "0xIR",
		"compliance":        "0xC",
	})
	w3 := httptest.NewRecorder()
	req3, _ := http.NewRequest("POST", "/v1/offerings/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/deploy-erc3643", bytes.NewReader(body3))
	req3.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w3, req3)
	if w3.Code != 400 {
		t.Errorf("expected 400 for decimals>18, got %d", w3.Code)
	}
}

package auth

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"blockxone/internal/rbac"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rs/zerolog/log"
)

// JWTIssuer is the expected "iss" claim in tokens.
const JWTIssuer = "blockxone"

// JWTAudience is the expected "aud" claim in tokens.
const JWTAudience = "blockxone-api"

// MinJWTSecretLength enforced in production. 32 bytes = 256-bit HMAC key.
const MinJWTSecretLength = 32

// knownInsecureJWTValueDigest identifies the documented development-only
// default without embedding a credential-like value in production code.
var knownInsecureJWTValueDigest = [sha256.Size]byte{
	0xfa, 0x5a, 0x0d, 0xf6, 0x9e, 0xe8, 0x6d, 0x42,
	0x72, 0x7f, 0x70, 0x7b, 0x94, 0x14, 0x56, 0xa0,
	0x76, 0x33, 0x8f, 0xc8, 0x4a, 0x16, 0x72, 0xbf,
	0xc6, 0x90, 0x78, 0x46, 0xfc, 0xdf, 0xa3, 0xdd,
}

type Principal struct {
	UserID      string          `json:"user_id"`
	Email       string          `json:"email"`
	OrgID       string          `json:"org_id"`
	Roles       []string        `json:"roles"`
	Permissions map[string]bool `json:"permissions"`
}

type ctxKey int

const principalKey ctxKey = 1

type DB interface {
	rbac.Store
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

func FromContext(c *gin.Context) *Principal {
	v, ok := c.Get("principal")
	if !ok {
		return nil
	}
	p, _ := v.(*Principal)
	return p
}

func MustPrincipal(c *gin.Context) *Principal {
	p := FromContext(c)
	if p == nil {
		panic("principal missing from context")
	}
	return p
}

func isPublicRoute(method, path string) bool {
	if path == "/healthz" || path == "/v1/chains" || strings.HasPrefix(path, "/console") {
		return true
	}
	if method == http.MethodGet && strings.HasPrefix(path, "/v1/offerings") {
		return true
	}
	if method == http.MethodPost && (path == "/v1/auth/login" || path == "/v1/auth/signup" || path == "/v1/wallets/connect") {
		return true
	}
	return false
}

// ValidateJWTSecret checks that the JWT secret meets production security
// requirements. Returns an error if the secret is too short or is the
// dev default.
func ValidateJWTSecret(secret, appEnv string) error {
	if appEnv == "dev" {
		return nil // dev mode allows weak secrets
	}
	if len(secret) < MinJWTSecretLength {
		return fmt.Errorf("JWT_SECRET must be at least %d characters in production (got %d)", MinJWTSecretLength, len(secret))
	}
	digest := sha256.Sum256([]byte(secret))
	if subtle.ConstantTimeCompare(digest[:], knownInsecureJWTValueDigest[:]) == 1 {
		return errors.New("JWT_SECRET cannot be the dev default in production")
	}
	return nil
}

func MiddlewareDev(pool DB, jwtSecret string, allowRoleOverride bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		path := c.Request.URL.Path

		// If JWT is present, allow JWT-authenticated flow in dev mode
		authz := strings.TrimSpace(c.GetHeader("Authorization"))
		if authz != "" && jwtSecret != "" {
			parts := strings.SplitN(authz, " ", 2)
			if len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") {
				claims := &Claims{}
				tok, err := jwt.ParseWithClaims(parts[1], claims, func(token *jwt.Token) (interface{}, error) {
					if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
						return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
					}
					return []byte(jwtSecret), nil
				})
				if err == nil && tok.Valid && claims.UserID != "" {
					orgID := claims.OrgID
					if orgID == "" {
						row := pool.QueryRow(c.Request.Context(), `SELECT org_id FROM user_org_roles WHERE user_id=$1 LIMIT 1`, claims.UserID)
						_ = row.Scan(&orgID)
					}
					roles, perms, err := rbac.LoadRolesAndPermissions(c.Request.Context(), pool, claims.UserID, orgID)
					if err == nil {
						p := &Principal{
							UserID:      claims.UserID,
							Email:       claims.Email,
							OrgID:       orgID,
							Roles:       roles,
							Permissions: perms,
						}
						c.Set("principal", p)
						c.Next()
						return
					}
				}
			}
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
			return
		}

		if isPublicRoute(c.Request.Method, path) {
			c.Next()
			return
		}
		userID := strings.TrimSpace(c.GetHeader("X-Dev-User-Id"))
		if userID == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing X-Dev-User-Id"})
			return
		}
		if _, err := uuid.Parse(userID); err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid X-Dev-User-Id"})
			return
		}

		email := strings.TrimSpace(c.GetHeader("X-Dev-Email"))
		if email == "" {
			email = "user+" + userID + "@blockxone.dev"
		}

		orgID := strings.TrimSpace(c.GetHeader("X-Dev-Org-Id"))
		if orgID != "" {
			if _, err := uuid.Parse(orgID); err != nil {
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid X-Dev-Org-Id"})
				return
			}
		}

		// Ensure user exists
		_, _ = pool.Exec(c.Request.Context(), `
			INSERT INTO users(id,email,status) VALUES($1,$2,'ACTIVE')
			ON CONFLICT (id) DO UPDATE SET email=EXCLUDED.email
		`, userID, email)

		// Determine org
		if orgID == "" {
			row := pool.QueryRow(c.Request.Context(), `
				SELECT org_id FROM user_org_roles WHERE user_id=$1 LIMIT 1
			`, userID)
			_ = row.Scan(&orgID)
			if orgID == "" {
				// fallback to platform org (seed uses aaaaa...)
				orgID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
			}
		}

		roles, perms, err := rbac.LoadRolesAndPermissions(c.Request.Context(), pool, userID, orgID)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "rbac load failed"})
			return
		}

		if allowRoleOverride {
			over := strings.TrimSpace(c.GetHeader("X-Dev-Roles"))
			if over != "" {
				// Override roles/permissions for quick dev. Use carefully.
				roles = strings.Split(over, ",")
				for i := range roles {
					roles[i] = strings.TrimSpace(roles[i])
				}
				perms, _ = rbac.PermissionsForRoles(c.Request.Context(), pool, roles)
			}
		}

		p := &Principal{
			UserID:      userID,
			Email:       email,
			OrgID:       orgID,
			Roles:       roles,
			Permissions: perms,
		}
		c.Set("principal", p)
		c.Next()
	}
}

// Claims captures JWT fields we care about.
type Claims struct {
	UserID   string `json:"uid"`
	Email    string `json:"email"`
	OrgID    string `json:"org"`
	WalletID string `json:"wid"`
	jwt.RegisteredClaims
}

// SignToken creates an HS256 JWT with proper issuer, audience, and expiry.
func SignToken(secret, userID, email, orgID, walletID string, ttl time.Duration) (string, error) {
	if ttl <= 0 {
		ttl = 24 * time.Hour // sane default
	}
	if ttl > 30*24*time.Hour {
		return "", errors.New("token TTL cannot exceed 30 days")
	}

	now := time.Now()
	claims := Claims{
		UserID:   userID,
		Email:    email,
		OrgID:    orgID,
		WalletID: walletID,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    JWTIssuer,
			Audience:  jwt.ClaimStrings{JWTAudience},
			Subject:   userID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
			NotBefore: jwt.NewNumericDate(now),
			ID:        uuid.New().String(), // unique token ID for revocation tracking
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// MiddlewareJWT enforces Bearer auth with full claim validation and loads
// roles/permissions into context.
func MiddlewareJWT(secret string, pool rbac.Store) gin.HandlerFunc {
	parserOpts := []jwt.ParserOption{
		jwt.WithValidMethods([]string{"HS256"}), // only allow HS256
		jwt.WithIssuer(JWTIssuer),               // validate iss
		jwt.WithAudience(JWTAudience),           // validate aud
		jwt.WithExpirationRequired(),            // require exp
		jwt.WithLeeway(30 * time.Second),        // 30s clock skew tolerance
	}

	return func(c *gin.Context) {
		path := c.Request.URL.Path

		authz := strings.TrimSpace(c.GetHeader("Authorization"))
		if authz == "" {
			if isPublicRoute(c.Request.Method, path) {
				c.Next()
				return
			}
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing authorization"})
			return
		}

		parts := strings.SplitN(authz, " ", 2)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid authorization header"})
			return
		}

		claims := &Claims{}
		tok, err := jwt.ParseWithClaims(parts[1], claims, func(token *jwt.Token) (interface{}, error) {
			if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
			}
			return []byte(secret), nil
		}, parserOpts...)

		if err != nil || !tok.Valid {
			log.Debug().Err(err).Str("path", path).Msg("JWT validation failed")
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
			return
		}
		if claims.UserID == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token payload"})
			return
		}

		// Validate UserID is a valid UUID to prevent injection
		if _, err := uuid.Parse(claims.UserID); err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid user ID in token"})
			return
		}

		orgID := claims.OrgID
		if orgID == "" {
			row := pool.QueryRow(c.Request.Context(), `SELECT org_id FROM user_org_roles WHERE user_id=$1 LIMIT 1`, claims.UserID)
			_ = row.Scan(&orgID)
		}
		roles, perms, err := rbac.LoadRolesAndPermissions(c.Request.Context(), pool, claims.UserID, orgID)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "rbac load failed"})
			return
		}

		p := &Principal{
			UserID:      claims.UserID,
			Email:       claims.Email,
			OrgID:       orgID,
			Roles:       roles,
			Permissions: perms,
		}
		c.Set("principal", p)
		c.Next()
	}
}

func RequirePermission(key string) gin.HandlerFunc {
	return func(c *gin.Context) {
		p := FromContext(c)
		if p == nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
			return
		}
		if p.Permissions[key] {
			c.Next()
			return
		}
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "missing permission", "permission": key})
	}
}

var ErrNotFound = errors.New("not found")

func WithPrincipal(ctx context.Context, p *Principal) context.Context {
	return context.WithValue(ctx, principalKey, p)
}

func PrincipalFromContext(ctx context.Context) (*Principal, bool) {
	v := ctx.Value(principalKey)
	if v == nil {
		return nil, false
	}
	p, ok := v.(*Principal)
	return p, ok
}

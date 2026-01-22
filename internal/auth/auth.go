package auth

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"blockxone/internal/rbac"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Principal struct {
	UserID      string          `json:"user_id"`
	Email       string          `json:"email"`
	OrgID       string          `json:"org_id"`
	Roles       []string        `json:"roles"`
	Permissions map[string]bool `json:"permissions"`
}

type ctxKey int

const principalKey ctxKey = 1

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

func MiddlewareDev(pool *pgxpool.Pool, allowRoleOverride bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Allow unauthenticated access to health + chain metadata + dev console UI
		path := c.Request.URL.Path
		if path == "/healthz" || path == "/v1/chains" || strings.HasPrefix(path, "/console") {
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

// SignToken creates an HS256 JWT for the caller.
func SignToken(secret, userID, email, orgID, walletID string, ttl time.Duration) (string, error) {
	now := time.Now()
	claims := Claims{
		UserID:   userID,
		Email:    email,
		OrgID:    orgID,
		WalletID: walletID,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// MiddlewareJWT enforces Bearer auth and loads roles/permissions into context.
func MiddlewareJWT(secret string, pool *pgxpool.Pool) gin.HandlerFunc {
	allowUnauth := map[string]bool{
		"/healthz":            true,
		"/v1/chains":          true,
		"/v1/wallets/connect": true,
		"/v1/auth/signup":     true,
		"/v1/auth/login":      true,
	}

	return func(c *gin.Context) {
		path := c.Request.URL.Path

		authz := strings.TrimSpace(c.GetHeader("Authorization"))
		if authz == "" {
			if allowUnauth[path] || strings.HasPrefix(path, "/console") {
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
		})
		if err != nil || !tok.Valid {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
			return
		}
		if claims.UserID == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token payload"})
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

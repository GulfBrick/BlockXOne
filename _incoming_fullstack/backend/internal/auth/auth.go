package auth

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"blockxone/internal/rbac"

	"github.com/gin-gonic/gin"
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

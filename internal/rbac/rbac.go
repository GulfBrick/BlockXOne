package rbac

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

func LoadRolesAndPermissions(ctx context.Context, pool *pgxpool.Pool, userID, orgID string) ([]string, map[string]bool, error) {
	rows, err := pool.Query(ctx, `
		SELECT r.name
		FROM user_org_roles uor
		JOIN roles r ON r.id = uor.role_id
		WHERE uor.user_id=$1 AND uor.org_id=$2
	`, userID, orgID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	var roles []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, nil, err
		}
		roles = append(roles, name)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	perms, err := PermissionsForRoles(ctx, pool, roles)
	if err != nil {
		return nil, nil, err
	}
	return roles, perms, nil
}

func PermissionsForRoles(ctx context.Context, pool *pgxpool.Pool, roleNames []string) (map[string]bool, error) {
	perms := map[string]bool{}
	if len(roleNames) == 0 {
		return perms, nil
	}

	rows, err := pool.Query(ctx, `
		SELECT DISTINCT p.key
		FROM roles r
		JOIN role_permissions rp ON rp.role_id = r.id
		JOIN permissions p ON p.id = rp.permission_id
		WHERE r.name = ANY($1)
	`, roleNames)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			return nil, err
		}
		perms[k] = true
	}
	return perms, rows.Err()
}

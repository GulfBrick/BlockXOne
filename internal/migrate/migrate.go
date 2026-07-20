package migrate

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func EnsureSchemaMigrations(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			filename text PRIMARY KEY,
			applied_at timestamptz NOT NULL DEFAULT now()
		);
	`)
	return err
}

func Applied(ctx context.Context, pool *pgxpool.Pool) (map[string]bool, error) {
	rows, err := pool.Query(ctx, `SELECT filename FROM schema_migrations`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	m := map[string]bool{}
	for rows.Next() {
		var fn string
		if err := rows.Scan(&fn); err != nil {
			return nil, err
		}
		m[fn] = true
	}
	return m, rows.Err()
}

// DiscoverSQLFiles returns migrations eligible for the effective environment.
// Reference-data migrations (for example role/permission seeds) remain part of
// production. Known administrator/demo-user seeds are development-only.
func DiscoverSQLFiles(dir, appEnv string) (files []string, err error) {
	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil, err
	}
	defer func() {
		if closeErr := root.Close(); closeErr != nil {
			err = errors.Join(err, fmt.Errorf("close migration directory %q: %w", dir, closeErr))
		}
	}()

	entries, err := fs.ReadDir(root.FS(), ".")
	if err != nil {
		return nil, err
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if !strings.HasSuffix(strings.ToLower(name), ".sql") {
			continue
		}
		if !strings.EqualFold(strings.TrimSpace(appEnv), "dev") && isDevelopmentOnlyMigration(name) {
			continue
		}
		if !strings.EqualFold(strings.TrimSpace(appEnv), "dev") {
			contents, readErr := root.ReadFile(name)
			if readErr != nil {
				return nil, fmt.Errorf("read migration %s: %w", name, readErr)
			}
			if containsCredentialSeed(contents) {
				return nil, fmt.Errorf("production migration %s contains a user credential seed", name)
			}
		}
		files = append(files, name)
	}
	sort.Strings(files)
	return files, nil
}

func containsCredentialSeed(contents []byte) bool {
	sql := strings.ToLower(string(contents))
	return (strings.Contains(sql, "insert into users") && strings.Contains(sql, "password_hash")) ||
		strings.Contains(sql, "admin123") ||
		strings.Contains(sql, "@blockxone.local")
}

func isDevelopmentOnlyMigration(name string) bool {
	lower := strings.ToLower(strings.TrimSpace(name))
	return strings.Contains(lower, "seed_admin") ||
		strings.Contains(lower, "seed_dev") ||
		strings.Contains(lower, "seed_demo") ||
		strings.Contains(lower, "demo_users")
}

func RunDir(ctx context.Context, pool *pgxpool.Pool, dir, appEnv string) (err error) {
	if err := EnsureSchemaMigrations(ctx, pool); err != nil {
		return err
	}

	applied, err := Applied(ctx, pool)
	if err != nil {
		return err
	}

	files, err := DiscoverSQLFiles(dir, appEnv)
	if err != nil {
		return err
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return err
	}
	defer func() {
		if closeErr := root.Close(); closeErr != nil {
			err = errors.Join(err, fmt.Errorf("close migration directory %q: %w", dir, closeErr))
		}
	}()

	for _, fn := range files {
		if applied[fn] {
			continue
		}
		b, err := root.ReadFile(fn)
		if err != nil {
			return err
		}
		sql := string(b)

		tx, err := pool.BeginTx(ctx, pgx.TxOptions{})
		if err != nil {
			return err
		}
		_, execErr := tx.Exec(ctx, sql)
		if execErr == nil {
			_, execErr = tx.Exec(ctx, `INSERT INTO schema_migrations(filename) VALUES($1)`, fn)
		}
		if execErr != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("migration %s failed: %w", fn, execErr)
		}
		if err := tx.Commit(ctx); err != nil {
			return err
		}
	}
	return nil
}

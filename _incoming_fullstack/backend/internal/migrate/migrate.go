package migrate

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
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

func RunDir(ctx context.Context, pool *pgxpool.Pool, dir string) error {
	if err := EnsureSchemaMigrations(ctx, pool); err != nil {
		return err
	}

	applied, err := Applied(ctx, pool)
	if err != nil {
		return err
	}

	var files []string
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if strings.HasSuffix(name, ".sql") {
			files = append(files, name)
		}
	}
	sort.Strings(files)

	for _, fn := range files {
		if applied[fn] {
			continue
		}
		path := filepath.Join(dir, fn)
		b, err := os.ReadFile(path)
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

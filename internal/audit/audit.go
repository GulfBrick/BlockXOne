package audit

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5/pgxpool"
)

func Log(ctx context.Context, pool *pgxpool.Pool, actorUserID, action, entityType, entityID string, before any, after any, ip string) error {
	if pool == nil {
		return nil // no DB connection — skip audit (e.g. unit tests)
	}
	var beforeJSON, afterJSON []byte
	var err error

	if before != nil {
		beforeJSON, err = json.Marshal(before)
		if err != nil {
			return err
		}
	}
	if after != nil {
		afterJSON, err = json.Marshal(after)
		if err != nil {
			return err
		}
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO audit_log(actor_user_id, action, entity_type, entity_id, before_json, after_json, ip)
		VALUES(NULLIF($1,''), $2, $3, NULLIF($4,'')::uuid, NULLIF($5,'')::jsonb, NULLIF($6,'')::jsonb, NULLIF($7,'')::inet)
	`, actorUserID, action, entityType, entityID, string(beforeJSON), string(afterJSON), ip)
	return err
}

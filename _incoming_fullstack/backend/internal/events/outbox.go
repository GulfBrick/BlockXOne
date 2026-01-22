package events

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type OutboxEvent struct {
	ID        string          `json:"id"`
	EventType string          `json:"event_type"`
	Payload   json.RawMessage `json:"payload"`
	CreatedAt time.Time       `json:"created_at"`
}

func Enqueue(ctx context.Context, pool *pgxpool.Pool, eventType string, payload any) (string, error) {
	id := uuid.New().String()
	b, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO outbox_events(id,event_type,payload,status) VALUES($1,$2,$3,'NEW')
	`, id, eventType, string(b))
	if err != nil {
		return "", err
	}
	return id, nil
}

func FetchNew(ctx context.Context, pool *pgxpool.Pool, limit int) ([]OutboxEvent, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, event_type, payload, created_at
		FROM outbox_events
		WHERE status='NEW'
		ORDER BY created_at ASC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var res []OutboxEvent
	for rows.Next() {
		var e OutboxEvent
		if err := rows.Scan(&e.ID, &e.EventType, &e.Payload, &e.CreatedAt); err != nil {
			return nil, err
		}
		res = append(res, e)
	}
	return res, rows.Err()
}

func MarkPublished(ctx context.Context, pool *pgxpool.Pool, id string) error {
	_, err := pool.Exec(ctx, `
		UPDATE outbox_events
		SET status='PUBLISHED', published_at=now(), attempts=attempts+1
		WHERE id=$1
	`, id)
	return err
}

func MarkFailed(ctx context.Context, pool *pgxpool.Pool, id string, errMsg string) error {
	_, err := pool.Exec(ctx, `
		UPDATE outbox_events
		SET status='FAILED', attempts=attempts+1, last_error=$2
		WHERE id=$1
	`, id, errMsg)
	return err
}

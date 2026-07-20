package main

import (
	"context"
	"time"

	"blockxone/internal/app"
	"blockxone/internal/config"
	"blockxone/internal/events"
	"blockxone/internal/logging"

	"github.com/nats-io/nats.go"
	"github.com/rs/zerolog/log"
)

func main() {
	cfg := config.Load()
	logging.Init(cfg.AppEnv)

	ctx := context.Background()
	a, err := app.New(ctx, cfg)
	if err != nil {
		log.Fatal().Err(err).Msg("app init failed")
	}
	defer a.Close()

	// Subscribe for visibility (and future handlers).
	_, _ = a.NATS.Subscribe("bx1.events.>", func(msg *nats.Msg) {
		log.Info().Str("subject", msg.Subject).RawJSON("payload", msg.Data).Msg("event received")
	})

	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	log.Info().Msg("BlockXOne worker started (outbox publisher)")
	for range ticker.C {
		evs, err := events.FetchNew(ctx, a.DB.Pool, 50)
		if err != nil {
			log.Error().Err(err).Msg("fetch outbox failed")
			continue
		}
		for _, e := range evs {
			subj := "bx1.events." + e.EventType
			if err := a.NATS.Publish(subj, e.Payload); err != nil {
				_ = events.MarkFailed(ctx, a.DB.Pool, e.ID, err.Error())
				log.Error().Err(err).Str("event_id", e.ID).Msg("publish failed")
				continue
			}
			_ = events.MarkPublished(ctx, a.DB.Pool, e.ID)
		}
	}
}

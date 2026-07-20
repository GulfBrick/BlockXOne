package main

import (
	"context"
	"time"

	"blockxone/internal/config"
	"blockxone/internal/db"
	"blockxone/internal/events"
	"blockxone/internal/logging"

	"github.com/nats-io/nats.go"
	"github.com/rs/zerolog/log"
)

func main() {
	cfg := config.Load()
	logging.Init(cfg.AppEnv)
	if err := cfg.ValidateRuntime("worker"); err != nil {
		log.Fatal().Err(err).Msg("runtime configuration rejected")
	}

	ctx := context.Background()
	d, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatal().Err(err).Msg("db connect failed")
	}
	defer d.Close()

	nc, err := nats.Connect(cfg.NatsURL)
	if err != nil {
		log.Fatal().Err(err).Msg("nats connect failed")
	}
	defer nc.Close()

	// Subscribe for visibility (and future handlers).
	_, _ = nc.Subscribe("bx1.events.>", func(msg *nats.Msg) {
		log.Info().Str("subject", msg.Subject).RawJSON("payload", msg.Data).Msg("event received")
	})

	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	log.Info().Msg("BlockXOne worker started (outbox publisher)")
	for range ticker.C {
		evs, err := events.FetchNew(ctx, d.Pool, 50)
		if err != nil {
			log.Error().Err(err).Msg("fetch outbox failed")
			continue
		}
		for _, e := range evs {
			subj := "bx1.events." + e.EventType
			if err := nc.Publish(subj, e.Payload); err != nil {
				_ = events.MarkFailed(ctx, d.Pool, e.ID, err.Error())
				log.Error().Err(err).Str("event_id", e.ID).Msg("publish failed")
				continue
			}
			_ = events.MarkPublished(ctx, d.Pool, e.ID)
		}
	}
}

package main

import (
	"context"
	"fmt"
	"os"

	"blockxone/internal/config"
	"blockxone/internal/db"
	"blockxone/internal/logging"
	"blockxone/internal/migrate"

	"github.com/rs/zerolog/log"
)

func main() {
	cfg := config.Load()
	logging.Init(cfg.AppEnv)
	if err := cfg.ValidateRuntime("migrate"); err != nil {
		log.Fatal().Err(err).Msg("runtime configuration rejected")
	}

	ctx := context.Background()
	d, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatal().Err(err).Msg("db connect failed")
	}
	defer d.Close()

	if err := migrate.RunDir(ctx, d.Pool, "migrations", cfg.AppEnv); err != nil {
		log.Fatal().Err(err).Msg("migrations failed")
	}
	fmt.Println("migrations applied")
	os.Exit(0)
}

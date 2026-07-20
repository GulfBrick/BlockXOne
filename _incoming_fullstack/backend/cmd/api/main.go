package main

import (
	"context"
	"net/http"
	"time"

	"blockxone/internal/app"
	"blockxone/internal/auth"
	"blockxone/internal/config"
	"blockxone/internal/logging"

	"github.com/gin-gonic/gin"
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

	if cfg.AppEnv != "dev" {
		gin.SetMode(gin.ReleaseMode)
	}
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(gin.Logger())

	// Auth
	if cfg.AuthMode == "dev" {
		r.Use(auth.MiddlewareDev(a.DB.Pool, cfg.DevAllowRoleOverride))
	} else {
		log.Fatal().Msg("AUTH_MODE=oidc not implemented in MVP")
	}

	RegisterRoutes(r, a)

	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           r,
		ReadHeaderTimeout: 5 * time.Second,
	}
	log.Info().Str("addr", cfg.HTTPAddr).Msg("BlockXOne API listening")
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal().Err(err).Msg("server failed")
	}
}

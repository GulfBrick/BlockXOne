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

	// CORS (dev-friendly): allow the local Next.js app to call the API from the browser.
	r.Use(func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		switch origin {
		case "http://localhost:5000", "http://127.0.0.1:5000", "http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:5001", "http://127.0.0.1:5001":
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Vary", "Origin")
			c.Header("Access-Control-Allow-Credentials", "true")
			c.Header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
			c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Dev-User-Id, X-Dev-Email, X-Dev-Org-Id, X-Dev-Roles")
		}

		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	// Auth
	RegisterPublicRoutes(r)
	switch cfg.AuthMode {
	case "dev":
		r.Use(auth.MiddlewareDev(a.DB.Pool, cfg.DevAllowRoleOverride))
	case "jwt":
		if cfg.JWTSecret == "" {
			log.Fatal().Msg("JWT_SECRET is required when AUTH_MODE=jwt")
		}
		r.Use(auth.MiddlewareJWT(cfg.JWTSecret, a.DB.Pool))
	default:
		log.Fatal().Msg("unsupported AUTH_MODE; use dev or jwt")
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

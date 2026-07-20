package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"blockxone/internal/app"
	"blockxone/internal/auth"
	"blockxone/internal/config"
	"blockxone/internal/logging"
	"blockxone/internal/middleware"
	"blockxone/internal/monitoring"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog/log"
)

func main() {
	cfg := config.Load()
	logging.Init(cfg.AppEnv)
	if err := cfg.ValidateRuntime("api"); err != nil {
		log.Fatal().Err(err).Msg("runtime configuration rejected")
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	a, err := app.New(ctx, cfg)
	if err != nil {
		log.Fatal().Err(err).Msg("app init failed")
	}
	defer a.Close()

	if cfg.AppEnv != "dev" {
		gin.SetMode(gin.ReleaseMode)
	}
	r := gin.New()

	// ── Core middleware stack (order matters) ──────────────────────────
	r.Use(gin.Recovery())
	r.Use(middleware.RequestID())
	r.Use(middleware.SecurityHeaders())
	r.Use(monitoring.PrometheusMiddleware())

	// CORS: production-aware with configurable origins
	var allowedOrigins []string
	if cfg.CORSAllowedOrigins != "" {
		allowedOrigins = strings.Split(cfg.CORSAllowedOrigins, ",")
	}
	r.Use(middleware.CORS(cfg.AppEnv, allowedOrigins))
	r.Use(middleware.RequestValidator(1 << 20)) // 1 MB max body

	// Rate limiting (Redis-backed, skips observability endpoints)
	r.Use(middleware.RateLimiterWithPolicies(cfg.RedisURL, cfg.RateLimitAPI, cfg.RateLimitAuth, time.Minute))

	// Audit logging for state-changing requests
	r.Use(middleware.AuditLogger(a.DB.Pool))

	// Request logging
	r.Use(gin.Logger())

	// ── Observability endpoints (unauthenticated) ─────────────────────
	r.GET("/metrics", monitoring.MetricsHandler())
	r.GET("/healthz", monitoring.SimpleHealthHandler())
	r.GET("/health/detailed", monitoring.DetailedHealthHandler(a.DB.Pool, cfg.RedisURL, cfg.NatsURL, cfg.ChainRPCURL))

	// ── Public routes (before auth middleware) ────────────────────────
	RegisterPublicRoutesForEnvironment(r, cfg.AppEnv)

	// ── Auth middleware ───────────────────────────────────────────────
	switch cfg.AuthMode {
	case "dev":
		if cfg.AppEnv != "dev" {
			log.Fatal().Str("app_env", cfg.AppEnv).Msg("AUTH_MODE=dev is only supported when APP_ENV=dev")
		}
		r.Use(auth.MiddlewareDev(a.DB.Pool, cfg.JWTSecret, cfg.DevAllowRoleOverride))
	case "jwt":
		if cfg.JWTSecret == "" {
			log.Fatal().Msg("JWT_SECRET is required when AUTH_MODE=jwt")
		}
		if err := auth.ValidateJWTSecret(cfg.JWTSecret, cfg.AppEnv); err != nil {
			log.Fatal().Err(err).Msg("JWT secret validation failed")
		}
		r.Use(auth.MiddlewareJWT(cfg.JWTSecret, a.DB.Pool))
	default:
		log.Fatal().Msg("unsupported AUTH_MODE; use dev or jwt")
	}

	// ── Authenticated routes ──────────────────────────────────────────
	RegisterRoutes(r, a)

	// ── HTTP server with graceful shutdown ─────────────────────────────
	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           r,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 20, // 1 MB
	}

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		log.Info().Str("addr", cfg.HTTPAddr).Str("env", cfg.AppEnv).Msg("BlockXOne API listening")
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal().Err(err).Msg("server failed")
		}
	}()

	<-quit
	log.Info().Msg("shutting down server...")

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Fatal().Err(err).Msg("server forced to shutdown")
	}
	log.Info().Msg("server exited cleanly")
}

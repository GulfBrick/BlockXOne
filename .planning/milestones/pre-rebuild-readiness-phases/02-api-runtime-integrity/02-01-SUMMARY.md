---
phase: 02-api-runtime-integrity
plan: 01
subsystem: "api-runtime"
tags:
  - production-readiness
  - api
  - monitoring
  - middleware
provides:
  - Verified API runtime contract for blockxone monitoring, middleware, and config surfaces
affects:
  - backend
  - docs
  - planning
tech-stack:
  added: []
  patterns:
    - Observability routes must bypass rate limiting and auth-sensitive CORS regressions
    - Runtime claims are accepted only after direct localhost probes and focused package tests
key-files:
  created:
    - .planning/phases/02-api-runtime-integrity/02-CONTEXT.md
    - .planning/phases/02-api-runtime-integrity/02-01-PLAN.md
    - .planning/phases/02-api-runtime-integrity/02-01-SUMMARY.md
    - .planning/phases/02-api-runtime-integrity/02-VERIFICATION.md
    - internal/monitoring/prometheus_test.go
    - internal/monitoring/health_test.go
    - internal/middleware/request_validator_test.go
    - internal/middleware/cors_test.go
    - internal/middleware/ratelimit_test.go
    - internal/middleware/security_headers_test.go
  modified:
    - cmd/api/main.go
    - internal/config/config_test.go
    - internal/middleware/USAGE.md
    - internal/middleware/cors.go
    - internal/middleware/ratelimit.go
    - internal/middleware/request_validator.go
    - internal/middleware/security_headers.go
    - internal/monitoring/health.go
    - internal/monitoring/prometheus.go
    - .env.example
    - README.md
    - .github/workflows/ci.yml
    - docs/API_DOCUMENTATION.md
    - docs/INTEGRATION_GUIDE.md
    - docs/MONITORING_SETUP_CHECKLIST.md
    - docs/PRODUCTION_MONITORING_STACK_README.md
    - docs/api/openapi.yaml
key-decisions:
  - Treat placeholder dependency checks as defects, not as acceptable production scaffolding.
  - Keep observability endpoints available even if Redis-backed rate limiting is unavailable.
  - Align runtime docs and CI versioning to the same localhost and Go contracts the code now enforces.
patterns-established:
  - Metrics labels must use route templates and decimal status codes to stay queryable.
  - Browser preflight must terminate before auth on public API routes.
duration: "this session"
completed: 2026-03-29
---

# Phase 2: api-runtime-integrity Summary

**Verified the live `blockxone` API runtime contract: health and metrics now reflect real runtime state, middleware behavior is intentional under localhost probes, and the runtime docs/env/CI surfaces no longer drift from the code.**

## Performance

- **Duration:** This session
- **Tasks:** 3 completed
- **Files modified:** 17 code/doc files plus Phase 2 planning artifacts and focused middleware/monitoring tests

## Accomplishments

- Fixed Prometheus request metrics to emit stable route templates with numeric HTTP status labels instead of broken Unicode status values.
- Replaced placeholder Redis, NATS, and chain RPC health checks with real connectivity checks and kept observability endpoints available even when Redis rate limiting is unavailable.
- Corrected middleware behavior around JSON content types, CORS preflight termination, dev-header CORS allowlists, HTTPS-only HSTS emission, and config-driven API/auth rate limits.
- Reconciled the runtime contract across `.env.example`, `README.md`, CI Go versioning, and API/monitoring docs to match the verified `8080` API surface.

## Task Commits

1. **Task 1: API runtime integrity execution** - `local-only / commit_docs=false`

## Files Created/Modified

- `.planning/phases/02-api-runtime-integrity/02-CONTEXT.md` - Phase 2 boundary and decisions
- `.planning/phases/02-api-runtime-integrity/02-01-PLAN.md` - Executed API runtime plan
- `.planning/phases/02-api-runtime-integrity/02-01-SUMMARY.md` - Outcome record
- `.planning/phases/02-api-runtime-integrity/02-VERIFICATION.md` - Evidence for Phase 2 completion
- `internal/monitoring/prometheus.go` - Fixed route/status labeling for Prometheus HTTP metrics
- `internal/monitoring/health.go` - Replaced placeholder dependency checks with real Redis/NATS/chain probes
- `internal/middleware/ratelimit.go` - Added observability bypass, config-driven auth/API buckets, and fail-open behavior when Redis is unavailable
- `internal/middleware/request_validator.go` - Accepted standard JSON charset/+json media types while preserving request ID behavior
- `internal/middleware/cors.go` - Allowed dev auth headers and properly terminated preflight before auth
- `cmd/api/main.go` - Made middleware ordering explicit and wired config-driven rate limiting
- `.env.example` - Corrected auth mode contract and exposed CORS/rate-limit runtime knobs
- `README.md` - Updated Go version and documented the verified monitoring endpoints
- `.github/workflows/ci.yml` - Aligned CI Go runtime to `1.24.0`

## Decisions & Deviations

Chose fail-open behavior for Redis-backed rate limiting because this repo already documents Redis as optional for rate limiting, and taking down health/metrics or core API availability on Redis outages would be the wrong production tradeoff at this stage.

## Next Phase Readiness

Phase 3 can now focus on auth and RBAC hardening from a verified API runtime baseline. Monitoring, request validation, preflight behavior, and the runtime env/doc contract are now evidence-backed instead of comment-backed.

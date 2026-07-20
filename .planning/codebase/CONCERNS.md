# Concerns

## Immediate Startup Blockers
- `cmd/api/main.go` references `monitoring.HealthHandler(...)`, but `internal/monitoring/health.go` only defines `SimpleHealthHandler(...)` and `DetailedHealthHandler(...)`.
- `go build ./cmd/api` reported that the module graph needs cleanup before the binary can be built.
- The rate limiter in `internal/middleware/ratelimit.go` imports `github.com/redis/go-redis/v9`, which was part of the new middleware wave and should be verified after module cleanup.
- The Prometheus middleware in `internal/monitoring/prometheus.go` is also part of the new production-readiness additions and should be revalidated in the compile path.

## Configuration Drift
- `TASK.md` expects the web app on `http://localhost:3000`.
- `README.md` says the web app runs on `http://localhost:5000`.
- `apps/web/package.json` actually starts the dev server on port `5001`.
- `apps/web/next.config.js` defaults the API proxy target to `http://localhost:8081`, while `apps/web/src/lib/api-client.ts` defaults to `http://localhost:8080`.
- `internal/config/config.go` only whitelists `http://localhost:3000` and `http://localhost:8080` by default for CORS.

## Architecture Fragility
- `cmd/api/routes.go` is very large and mixes HTTP concerns, direct SQL, authorization, business rules, and response shaping.
- That makes compile repair and behavioral changes riskier than the package layout suggests.
- The newer provider modules described in `IMPLEMENTATION_SUMMARY.md` are present under `internal/kyc`, `internal/custody`, and `internal/payments`, but they are not the dominant execution path for the current API.

## Documentation Credibility
- `IMPLEMENTATION_SUMMARY.md` presents the new integrations as production-grade.
- `AUDIT_REPORT.md` and `TASK.md` reflect different moments in the repo history.
- The codebase needs a source-of-truth pass because the docs are useful but not synchronized.

## CI And Toolchain Drift
- `go.mod` declares Go `1.24.0`.
- `.github/workflows/ci.yml` still sets up Go `1.22`.
- If code now depends on 1.24 behavior or module resolution, CI and local setup will diverge.

## Most Likely Repair Sequence
- First align the module graph with `go mod tidy`.
- Then fix the health-handler mismatch in the API composition root.
- Then standardize frontend and API localhost defaults across:
  `TASK.md`
  `README.md`
  `apps/web/package.json`
  `apps/web/next.config.js`
  `internal/config/config.go`
- Only after that is it worth trying to boot the full local stack and chase runtime-only issues.

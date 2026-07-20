# Conventions

## Backend Coding Style
- Go code is organized around `internal/` packages and `cmd/` entrypoints.
- Configuration is environment-driven through `internal/config/config.go`.
- Shared app dependencies are bundled into an `App` struct in `internal/app/app.go`.
- Middleware functions return `gin.HandlerFunc`, for example in:
  `internal/middleware/request_validator.go`
  `internal/middleware/security_headers.go`
  `internal/middleware/cors.go`

## Handler Conventions
- Many handlers are inline closures inside `cmd/api/routes.go`.
- Request validation commonly uses `c.ShouldBindJSON(...)`.
- Error responses are typically JSON maps like `gin.H{"error": "..."}`.
- Permission checks are attached at route registration time with `auth.RequirePermission(...)`.

## Logging And Observability
- Zerolog is the default logger via `internal/logging/logging.go`.
- Request tracing is intended through `internal/middleware/request_validator.go` and request ID middleware.
- Monitoring middleware is expected to be globally mounted from `internal/monitoring/prometheus.go`.

## Domain Conventions
- Chain operations go through the `chain.Adapter` interface in `internal/chain/chain.go`.
- Async side effects are written to the outbox first through `internal/events/outbox.go`.
- Audit records are treated as a first-class concern and appear throughout `cmd/api/routes.go` and `internal/audit/audit.go`.

## Frontend Conventions
- The frontend uses App Router and file-based routes in `apps/web/src/app/`.
- Reusable client code sits in `apps/web/src/lib/` and `apps/web/src/components/`.
- Most product pages are role-based workflow screens rather than generic resource pages.

## Testing Conventions
- Some backend packages keep tests next to the code, for example:
  `internal/auth/auth_test.go`
  `internal/policy/policy_test.go`
  `internal/chain/chain_test.go`
- Cross-package backend integration coverage sits in `tests/integration/api_test.go`.
- Contract tests are behavior-focused and grouped by contract in `contracts/test/`.

## Inconsistencies To Watch
- Documentation and runtime defaults are not currently treated as a single source of truth.
- `TASK.md`, `README.md`, `apps/web/package.json`, and `apps/web/next.config.js` disagree on ports.
- `IMPLEMENTATION_SUMMARY.md` describes completed production wiring, but the API composition root still has unresolved symbol drift with `internal/monitoring/health.go`.
- CI in `.github/workflows/ci.yml` still assumes Go `1.22`, while `go.mod` declares `1.24.0`.

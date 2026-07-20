# Integrations

## Core Infrastructure
- PostgreSQL is the primary datastore, configured through `internal/config/config.go` and used via `internal/db/db.go`.
- Redis is used for rate limiting through `internal/middleware/ratelimit.go`.
- NATS is used for event publication and subscription through `internal/app/app.go`, `internal/events/outbox.go`, and `cmd/worker/main.go`.
- MinIO is provisioned as S3-compatible storage in `docker-compose.yml`.

## Authentication And Authorization
- `AUTH_MODE=dev` and `AUTH_MODE=jwt` are supported in `internal/config/config.go`.
- Dev header auth and JWT middleware are wired in `cmd/api/main.go`.
- Permission checks are enforced inline in `cmd/api/routes.go` via `auth.RequirePermission(...)`.
- Frontend auth flows are implemented in `apps/web/src/app/api/auth/login/route.ts`, `apps/web/src/app/api/auth/signup/route.ts`, and `apps/web/src/lib/auth-context.tsx`.

## Blockchain Integration
- Chain behavior is abstracted by `internal/chain/chain.go`.
- Mock mode is the default in `internal/config/config.go`.
- EVM mode is initialized through `chain.NewEVM(...)` in `internal/app/app.go`.
- Contract-side integration points are documented in `contracts/README.md`, `contracts/MANIFEST.md`, and tests in `contracts/test/`.

## Compliance, Custody, And Payments
- KYC provider abstractions live in `internal/kyc/provider.go` and `internal/kyc/types.go`.
- Custody provider abstractions live in `internal/custody/provider.go` and `internal/custody/types.go`.
- Payment provider abstractions live in `internal/payments/provider.go` and `internal/payments/types.go`.
- The configuration surface for these providers exists in `internal/config/config.go`.
- `IMPLEMENTATION_SUMMARY.md` claims these modules are production-grade, but the API wiring is still centered around the monolithic handlers in `cmd/api/routes.go`.

## Frontend To Backend Integration
- Primary REST client logic is in `apps/web/src/lib/api-client.ts`.
- Wallet-driven API calls are in `apps/web/src/components/wallet/WalletWidget.tsx`.
- Some pages call the backend directly with hardcoded URLs, for example:
  `apps/web/src/app/compliance/queue/page.tsx`
  `apps/web/src/app/tokenisation-agent/mint/page.tsx`
  `apps/web/src/app/admin/users/create/page.tsx`
- Next.js rewrites proxy `/api/:path*` through `apps/web/next.config.js`.

## Eventing And Async Work
- Domain actions enqueue outbox events via `internal/events/outbox.go`.
- The worker publishes those events to NATS in `cmd/worker/main.go`.
- This is an outbox-plus-publisher pattern, not a full consumer workflow framework.

## CI/CD And Deployment
- CI checks are defined in `.github/workflows/ci.yml`.
- Deployment flow is defined in `.github/workflows/deploy.yml`.
- Production Docker orchestration is documented in `DOCKER_DEPLOYMENT.md`.

## Integration Risks
- API host/port defaults disagree across `TASK.md`, `README.md`, `apps/web/package.json`, and `apps/web/next.config.js`.
- The health endpoint symbol used by `cmd/api/main.go` does not match the functions available in `internal/monitoring/health.go`.
- Redis and Prometheus dependencies are used in code under `internal/middleware/ratelimit.go` and `internal/monitoring/prometheus.go`, but the initial `go build ./cmd/api` path still required module cleanup.

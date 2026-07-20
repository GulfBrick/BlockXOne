# Architecture

## High-Level Shape
- The backend is a single Go service with a very large route-registration layer in `cmd/api/routes.go`.
- Runtime composition happens in `internal/app/app.go`, which builds the DB connection, NATS connection, and chain adapter.
- The frontend is a separate Next.js app in `apps/web/`.
- Smart contracts are maintained in `contracts/` and are logically adjacent to, not embedded inside, the Go service.

## Backend Flow
- `cmd/api/main.go` loads config, initializes logging, builds the app container with `app.New(...)`, and constructs the Gin engine.
- Middleware is stacked globally in `cmd/api/main.go` before route registration.
- Public routes are registered first through `RegisterPublicRoutes(...)`.
- Auth middleware is then attached globally.
- Authenticated routes are registered through `RegisterRoutes(...)`.

## Data And Event Flow
- Requests hit Gin handlers in `cmd/api/routes.go`.
- Handlers read and write Postgres directly through `a.DB.Pool`.
- Audit events are recorded through helpers such as `internal/audit/audit.go`.
- Async notifications are enqueued into `outbox_events` through `internal/events/outbox.go`.
- `cmd/worker/main.go` polls the outbox table and republishes events to NATS subjects.

## Domain Boundaries
- Domain packages exist under `internal/`, for example:
  `internal/auth`
  `internal/policy`
  `internal/kyc`
  `internal/custody`
  `internal/payments`
  `internal/chain`
- The route layer still contains a large amount of orchestration and SQL, so the domain boundaries are present but not consistently enforced.

## Persistence Model
- Schema migrations are run from `cmd/migrate/main.go` via `internal/migrate/migrate.go`.
- Seed data is created from `cmd/seed/main.go`.
- The migration runner uses a `schema_migrations` table to track applied SQL files.

## Frontend Architecture
- App Router pages live under `apps/web/src/app/`.
- Shared UI and motion primitives live under `apps/web/src/components/`.
- API client and auth helpers live under `apps/web/src/lib/`.
- Cross-page hooks live under `apps/web/src/hooks/`.

## Contract Boundary
- On-chain actions are hidden behind the `chain.Adapter` interface in `internal/chain/chain.go`.
- This allows `mock` mode for local development and `evm` mode for blockchain-backed flows.
- The contracts workspace is developed independently with Hardhat tests in `contracts/test/`.

## Current Architectural Tension
- The architecture claims modularity in `README.md` and `IMPLEMENTATION_SUMMARY.md`, but `cmd/api/routes.go` is still the operational center of the system.
- Production concerns were added through middleware and monitoring packages, but those packages are not fully aligned with the API composition root yet.
- The web app and backend share a common product model, but their runtime defaults have drifted enough to make local boot fragile.

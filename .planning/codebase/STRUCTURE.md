# Structure

## Top-Level Layout
- `cmd/` contains executable entrypoints:
  `cmd/api`, `cmd/worker`, `cmd/migrate`, `cmd/seed`
- `internal/` contains backend packages and domain logic.
- `apps/web/` contains the Next.js frontend.
- `contracts/` contains Solidity sources, Hardhat config, and tests.
- `migrations/` contains SQL schema files.
- `scripts/` contains helper scripts and E2E tooling.
- `docs/` contains API, monitoring, state-machine, and role documentation.

## Backend Package Layout
- `internal/app` provides composition of shared runtime dependencies.
- `internal/db` owns database connection setup.
- `internal/auth` owns principals, auth middleware, and permission checks.
- `internal/middleware` contains request ID, request validation, CORS, rate limiting, and audit middleware.
- `internal/monitoring` contains health and Prometheus-related code.
- `internal/events` implements the outbox pattern.
- `internal/chain` owns mock and EVM blockchain behavior.

## Frontend Layout
- `apps/web/src/app` holds page routes for role-based areas such as:
  `admin`
  `compliance`
  `investor`
  `tokenisation-agent`
  `wm`
- `apps/web/src/components` holds reusable layout, UI, motion, and wallet components.
- `apps/web/src/lib` holds client helpers, auth state, demo data, and utility modules.
- `apps/web/src/hooks` contains app-facing hooks such as `useBlockXOne.ts`.

## Test Layout
- Backend integration tests exist in `tests/integration/api_test.go`.
- Backend unit-style tests are colocated in `internal/.../*_test.go`.
- Frontend tests are expected through Vitest from `apps/web/package.json`.
- Contract tests live in `contracts/test/`.

## Operational Files
- `Makefile` is the main developer command surface.
- `.github/workflows/ci.yml` and `.github/workflows/deploy.yml` define automation.
- `docker-compose.yml` is the lean local stack.
- `docker-compose.prod.yml` is the larger production-shaped stack.

## Planning Layout
- `.planning/codebase/` now exists for GSD onboarding documentation.
- There is no `.planning/PROJECT.md`, `ROADMAP.md`, or `STATE.md` yet.
- That means the repo has not been fully initialized into the broader GSD project workflow.

## Naming Pattern
- Backend packages follow lower-case directory names under `internal/`.
- Frontend pages mirror product roles and workflows in their route names.
- The repository mixes marketing and product terminology:
  `wm` for wealth manager,
  `issuer`,
  `compliance`,
  `tokenisation-agent`,
  `investor`.

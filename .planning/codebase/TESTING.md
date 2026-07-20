# Testing

## Backend Tests
- Unit-style tests exist next to code in:
  `internal/auth/auth_test.go`
  `internal/chain/chain_test.go`
  `internal/config/config_test.go`
  `internal/ethsig/ethsig_test.go`
  `internal/policy/policy_test.go`
- An integration-style API test exists in `tests/integration/api_test.go`.
- The main backend CI command in `.github/workflows/ci.yml` is `go test -v -race -coverprofile=coverage.out -covermode=atomic ./...`.

## Frontend Tests
- `apps/web/package.json` uses `vitest` for frontend tests.
- CI runs `npm test --prefix apps/web -- --run --coverage` in `.github/workflows/ci.yml`.
- I did not find a large colocated frontend test tree during the onboarding pass, so frontend coverage likely trails the route surface.

## Contract Tests
- Contract tests are active and numerous in `contracts/test/`.
- Examples include:
  `contracts/test/BXOSecurityToken.test.ts`
  `contracts/test/TokenFactory.test.ts`
  `contracts/test/P2PTradeEscrow.test.ts`
- CI compiles contracts and runs contract tests from `.github/workflows/ci.yml`.

## Build Verification Findings
- `go build ./cmd/api` currently does not pass cleanly without module cleanup and code alignment.
- The first backend build path reported that `go mod tidy` is needed.
- The API composition root also references `monitoring.HealthHandler(...)`, but only `SimpleHealthHandler(...)` and `DetailedHealthHandler(...)` exist in `internal/monitoring/health.go`.

## Operational Test Gaps
- The repo contains broad documentation for production readiness, but the startup path has not been verified against the current code snapshot.
- The frontend port and API target drift means even a passing unit test suite would not guarantee a working local stack.
- Health and monitoring behavior should be rechecked after the backend compiles because `internal/monitoring/prometheus.go` and `internal/monitoring/health.go` were added more recently than the original service boot path.

## Recommended Next Verification Pass
- Run `go mod tidy`, then rebuild `./cmd/api`, `./cmd/worker`, `./cmd/migrate`, and `./cmd/seed`.
- Fix composition-root mismatches in `cmd/api/main.go` and `internal/monitoring/health.go`.
- Re-run backend tests.
- Start the local infrastructure from `docker-compose.yml`.
- Boot the API and web app with consistent localhost ports and verify `/healthz` plus a basic login flow.

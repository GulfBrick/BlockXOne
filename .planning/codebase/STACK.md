# Stack

## Runtime Overview
- Backend is a Go monorepo rooted at `go.mod` with module path `blockxone`.
- The main service entrypoints are `cmd/api/main.go`, `cmd/worker/main.go`, `cmd/migrate/main.go`, and `cmd/seed/main.go`.
- The web app is a Next.js 14 app in `apps/web/package.json` using React 18 and TypeScript.
- Smart contracts live in `contracts/` and are tested with Hardhat via files such as `contracts/test/BXOSecurityToken.test.ts`.

## Backend Technologies
- Go version is declared as `1.24.0` in `go.mod`.
- HTTP server uses Gin via `github.com/gin-gonic/gin` in `cmd/api/main.go`.
- Logging uses Zerolog via `internal/logging/logging.go`.
- Database access uses `github.com/jackc/pgx/v5` through `internal/db/db.go` and `internal/migrate/migrate.go`.
- Messaging uses NATS via `github.com/nats-io/nats.go` in `internal/app/app.go` and `cmd/worker/main.go`.
- Blockchain support is abstracted behind `internal/chain/chain.go` with mock and EVM modes.

## Frontend Technologies
- `apps/web/package.json` uses `next`, `react`, `react-dom`, `typescript`, and `eslint-config-next`.
- Client state and data fetching use `@tanstack/react-query`.
- Wallet integration libraries include `ethers`, `viem`, and `wagmi`.
- UI primitives use Radix packages such as `@radix-ui/react-dialog`, `@radix-ui/react-select`, and related packages.
- Styling is driven by Tailwind CSS and app-specific tokens in `apps/web/src/styles/design-tokens.css`.

## Infrastructure Technologies
- Local development dependencies are defined in `docker-compose.yml`:
  `postgres`, `redis`, `nats`, `minio`, and `minio-init`.
- A larger production-oriented stack is defined in `docker-compose.prod.yml`.
- Docker build targets are split across `Dockerfile.api`, `Dockerfile.worker`, and `Dockerfile.web`.
- Automation entrypoints are centralized in `Makefile`.

## Build And Test Tooling
- Backend build and test commands are in `Makefile` targets such as `build`, `test-go`, `lint-go`, and `vet`.
- Frontend build and test commands are in `apps/web/package.json` scripts `dev`, `build`, `lint`, and `test`.
- CI is defined in `.github/workflows/ci.yml`.
- Contract tests and compilation are referenced in `.github/workflows/ci.yml` and under `contracts/test/`.

## Configuration Sources
- Backend runtime configuration is loaded from `internal/config/config.go`.
- Example environment defaults are in `.env.example`.
- Next.js runtime configuration is in `apps/web/next.config.js`.
- Additional human guidance exists in `README.md`, `TASK.md`, `DOCKER_DEPLOYMENT.md`, and `IMPLEMENTATION_SUMMARY.md`.

## Notable Drift
- `apps/web/package.json` serves the frontend on port `5001`.
- `README.md` says the web app runs on `5000`.
- `TASK.md` says the web app should run on `3000`.
- `apps/web/next.config.js` defaults the proxied API target to `http://localhost:8081`, while most backend and frontend code assumes `http://localhost:8080`.

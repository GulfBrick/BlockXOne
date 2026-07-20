# Production Research: Stack

## Recommended Stack Direction

- Keep the existing Go backend with Gin and pgx rather than rewriting into a new service framework.
- Keep PostgreSQL as the source of truth for transactional state and audit data.
- Keep Redis for rate limiting and short-lived coordination concerns.
- Keep NATS for event publication, but verify where durable delivery or replay is required before scaling operational reliance.
- Keep the Next.js frontend and harden environment-driven configuration instead of adding more hardcoded route/API variants.
- Keep the Solidity/Hardhat workspace for contract verification and deployment, but treat on-chain reliability as a distinct program area.

## Production Baseline Requirements

- Pin the Go toolchain consistently across local, CI, and Docker builds.
- Pin Node and contract-toolchain versions consistently across CI and developer setup.
- Standardize localhost and deployment environment contracts across:
  `README.md`
  `TASK.md`
  `apps/web/package.json`
  `apps/web/next.config.js`
  `internal/config/config.go`
- Ensure provider modules and monitoring packages are present in `go.mod` as direct dependencies where they are imported directly.

## What Not To Do

- Do not rewrite the backend into a different framework before baseline stabilization.
- Do not add more provider integrations before the current KYC/custody/payment abstractions are wired and verified.
- Do not treat monitoring documentation as evidence of working observability without runtime verification.
- Do not let contract and backend versions drift independently without an explicit compatibility check.

## Stack Focus For This Program

1. Build reproducibility
2. Runtime consistency
3. Provider wiring
4. Chain reliability
5. Observability and deployment automation

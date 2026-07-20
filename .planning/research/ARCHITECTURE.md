# Production Research: Architecture

## Current Shape

- `cmd/api/main.go` is the runtime composition root for the API.
- `cmd/api/routes.go` still carries a large amount of orchestration and direct SQL.
- `internal/app/app.go` wires DB, NATS, and chain dependencies.
- `cmd/worker/main.go` handles outbox publication to NATS.
- `apps/web/src/app/` contains role-based app-router pages for the UI.
- `contracts/` contains the EVM/contract workspace.

## Production Build Order

1. Restore a trustworthy build-and-run baseline.
2. Lock environment and config behavior.
3. Harden backend runtime composition and auth boundaries.
4. Wire provider integrations into persisted workflows.
5. Prove tokenization and chain reliability.
6. Verify the frontend against the live backend.
7. Add operational evidence: monitoring, CI/CD, release runbooks, and staging verification.

## Component Boundaries To Respect

- Route layer should orchestrate, not absorb more domain logic.
- Provider modules should own vendor-specific behavior.
- Chain adapter should be the only abstraction between backend and contracts.
- Frontend should consume environment-driven API endpoints, not hardcoded localhost values.
- Deployment and monitoring assets should be validated against the same runtime contract as the application.

## Architectural Risk

The current structure can ship, but only if the readiness program reduces drift. Without that, sprint code will keep outpacing system coherence.

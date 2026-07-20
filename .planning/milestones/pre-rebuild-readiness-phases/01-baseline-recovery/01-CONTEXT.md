---
phase: "01"
name: "baseline-recovery"
created: 2026-03-29
---

# Phase 1: Baseline Recovery - Context

**Gathered:** 2026-03-29
**Status:** Executed and verified
**Mode:** Auto-generated infrastructure context via GSD autonomous flow

<domain>
## Phase Boundary

Make the `blockxone` repository buildable and runnable from a clean Windows checkout, with one consistent localhost contract across backend, frontend, docs, and local dependencies.

</domain>

<decisions>
## Implementation Decisions

### Build And Runtime Baseline
- Keep the existing Go, Next.js, Docker, and SQL stack in place; Phase 1 is stabilization, not redesign.
- Treat `GOPROXY=https://proxy.golang.org,direct` as a required execution assumption for this environment because `GOPROXY=direct` was not reliable here.
- Preserve `http://localhost:8080` for the API and `http://localhost:3000` for the web app as the canonical local contract.

### Verification Strategy
- Prioritize reproducible command success over inferred readiness claims.
- Fix real compile, build, and runtime blockers before addressing broader brownfield warning cleanup.
- Accept warning-only frontend lint debt in Phase 1 so long as production build and type validation complete successfully.

### the agent's Discretion
All detailed implementation choices within the baseline-recovery boundary are at the agent's discretion.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `cmd/api`, `cmd/worker`, `cmd/migrate`, and `cmd/seed` already provide the backend execution surfaces that Phase 1 needs to prove.
- `docker-compose.yml` already defines the local dependency stack for Postgres, Redis, NATS, and MinIO.
- `apps/web` already contains the full Next.js application and the scripts needed for dev and production builds.

### Established Patterns
- Backend integration points already flow through `internal/app`, `internal/db`, `internal/auth`, `internal/policy`, and `internal/rbac`.
- Frontend app routing, auth, and wallet flows are already concentrated under `apps/web/src/app`, `apps/web/src/components`, and `apps/web/src/lib`.
- Planning state for this readiness program is tracked under `.planning/`.

### Integration Points
- Local developer entrypoints: `README.md`, `Makefile`, `apps/web/package.json`
- Backend build and auth/testability path: `internal/auth`, `internal/policy`, `internal/rbac`, `internal/ethsig`, `internal/examples`
- Frontend production build path: `apps/web/.eslintrc.json`, `apps/web/src/app/login/page.tsx`, `apps/web/src/app/investor/funds/[id]/page.tsx`, `apps/web/src/components/*`, `apps/web/src/lib/auth-context-v2.tsx`

</code_context>

<specifics>
## Specific Ideas

- Localhost verification must cover both the API health endpoint and a working browser route in the web app.
- Phase 1 should leave enough evidence behind for Phase 2 to focus on API runtime integrity rather than baseline repair.

</specifics>

<deferred>
## Deferred Ideas

- Brownfield frontend warning cleanup beyond what is required for a clean production build
- Deeper operator-flow verification across investor, compliance, and admin journeys
- Production-provider/runtime proof beyond local baseline recovery

</deferred>

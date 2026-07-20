---
phase: "03"
name: "auth-and-rbac-hardening"
created: 2026-03-29
---

# Phase 3: Auth And RBAC Hardening - Context

**Gathered:** 2026-03-29
**Status:** Ready for planning
**Mode:** Auto-generated from Phase 2 verification and auth/RBAC code inspection

<domain>
## Phase Boundary

Separate development-only auth assumptions from production-safe auth behavior, then verify that privileged routes in `blockxone` consistently enforce RBAC and audit expectations.

</domain>

<decisions>
## Implementation Decisions

### Runtime Focus
- Stay inside auth mode selection, JWT/dev defaults, privileged route protection, and the documented seeded-user contract.
- Treat production-unsafe defaults as defects even if they are convenient for local development.

### Verification Focus
- Phase 3 must prove both safe production behavior and preserved local developer ergonomics.
- Route protection evidence should come from direct endpoint probing and focused tests, not from eyeballing `RequirePermission(...)` calls alone.

### the agent's Discretion
Specific fixes to config defaults, auth middleware allowlists, seeded user docs, and privileged-route verification are at the agent's discretion.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `internal/auth/auth.go` contains both `MiddlewareDev` and `MiddlewareJWT`, plus `RequirePermission`.
- `internal/config/config.go` is the source of truth for auth mode and JWT/default behavior.
- `cmd/api/main.go` is the auth mode composition root.
- `migrations/006_seed_dev_users.sql` defines seeded local users and roles.
- `cmd/api/routes.go` contains the privileged route surface guarded by `auth.RequirePermission(...)`.

### Established Patterns
- Public auth endpoints are currently exposed via auth-middleware allowlists rather than being mounted in a separate public group.
- Seeded local users and dev header overrides are intentionally helpful for local operation, but they are easy places for production assumptions to leak.
- The Phase 2 runtime contract now guarantees that middleware, CORS, and monitoring behavior are stable, so Phase 3 can isolate auth concerns cleanly.

### Integration Points
- `internal/auth/auth.go`
- `internal/config/config.go`
- `cmd/api/main.go`
- `cmd/api/routes.go`
- `migrations/006_seed_dev_users.sql`
- `README.md`
- `.env.example`

</code_context>

<specifics>
## Specific Ideas

- Remove or gate any production-unsafe auth defaults such as a known fallback JWT secret or permissive dev-role override behavior outside dev mode.
- Verify that representative privileged routes reject missing/insufficient auth under JWT mode and accept properly authorized principals.
- Reconcile the seeded-user and local login story so local demos remain usable without implying that dev auth is acceptable for production.

</specifics>

<deferred>
## Deferred Ideas

- KYC workflow correctness beyond auth gates
- Provider/chain workflow authorization subtleties that depend on later phases
- Frontend role-journey verification beyond auth/session correctness

</deferred>

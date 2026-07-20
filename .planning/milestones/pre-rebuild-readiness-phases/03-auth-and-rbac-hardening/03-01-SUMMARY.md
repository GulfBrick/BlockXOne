---
phase: 03-auth-and-rbac-hardening
plan: 01
subsystem: "auth-rbac"
tags:
  - production-readiness
  - auth
  - rbac
  - security
provides:
  - Verified separation between local dev auth shortcuts and non-dev JWT runtime behavior
affects:
  - backend
  - docs
  - planning
tech-stack:
  added: []
  patterns:
    - Public-route allowlists must be shared between dev and JWT middleware to prevent auth-surface drift
    - Local demo-user ergonomics should come from seed data and documentation, not runtime auto-provisioning shortcuts
key-files:
  created:
    - .planning/phases/03-auth-and-rbac-hardening/03-01-SUMMARY.md
    - .planning/phases/03-auth-and-rbac-hardening/03-VERIFICATION.md
  modified:
    - internal/config/config.go
    - internal/config/config_test.go
    - internal/auth/auth.go
    - internal/auth/auth_test.go
    - cmd/api/main.go
    - cmd/api/routes.go
    - cmd/seed/main.go
    - migrations/006_seed_dev_users.sql
    - .env.example
    - README.md
key-decisions:
  - Non-dev runtime must default to JWT and fail closed instead of silently inheriting dev auth.
  - Wallet-connect may create investor identities, but it must never escalate roles based on email.
  - Seeded demo credentials belong in the seed path and docs, not as hidden login backfills.
patterns-established:
  - Shared public-route detection keeps auth behavior consistent between dev and JWT middleware.
  - Runtime auth probes must prove `401`, `403`, and `200` behavior on representative privileged routes.
duration: "this session"
completed: 2026-03-29
---

# Phase 3: auth-and-rbac-hardening Summary

**Hardened the `blockxone` auth boundary so non-dev runtime now fails closed, privileged routes have verified RBAC behavior, and local demo-user access comes from explicit seed data instead of runtime shortcuts.**

## Performance

- **Duration:** This session
- **Tasks:** 3 completed
- **Files modified:** 10 code/doc files plus Phase 3 planning artifacts

## Accomplishments

- Made auth defaults environment-aware so non-dev runtime resolves to `AUTH_MODE=jwt`, disables role override by default, and refuses `AUTH_MODE=dev`.
- Removed runtime auto-provisioning of demo users from email login and replaced it with explicit seeded local credentials for all documented demo personas.
- Closed the wallet-connect privilege escalation path by removing email-based privileged role mapping and blocking the `devskip` signature bypass outside local dev auth.
- Unified public-route behavior across dev and JWT middleware so offering discovery remains public in both modes while privileged admin access still returns the expected `401/403/200` responses.
- Updated local auth docs and env guidance so the supported demo path is visible in `README.md`, `.env.example`, and seed assets.

## Task Commits

1. **Task 1: Phase 3 auth and RBAC hardening execution** - `local-only / commit_docs=false`

## Files Created/Modified

- `.planning/phases/03-auth-and-rbac-hardening/03-01-SUMMARY.md` - Outcome record
- `.planning/phases/03-auth-and-rbac-hardening/03-VERIFICATION.md` - Evidence for Phase 3 completion
- `internal/config/config.go` - Environment-aware auth defaults
- `internal/config/config_test.go` - Production-like default coverage
- `internal/auth/auth.go` - Shared public-route logic and configured dev JWT handling
- `internal/auth/auth_test.go` - Public-route and JWT middleware regression coverage
- `cmd/api/main.go` - Non-dev rejection of `AUTH_MODE=dev`
- `cmd/api/routes.go` - Removed demo-user auto-provisioning and wallet-based role escalation
- `cmd/seed/main.go` - Seeded explicit passwords for all local demo users
- `migrations/006_seed_dev_users.sql` - Aligned SQL demo-user seed coverage
- `.env.example` - Local-only auth guidance
- `README.md` - Documented demo-user credentials and non-dev auth contract

## Decisions & Deviations

Removed convenience shortcuts from the runtime login paths instead of trying to selectively preserve them, because the seed command already gives a cleaner local-dev contract. That keeps production auth behavior simple and verifiable.

## Next Phase Readiness

Phase 4 can now verify compliance and wallet-approval workflows from a hardened auth baseline. Privileged routes are no longer depending on hidden demo-user behavior, and the runtime auth surface now behaves consistently between local verification and non-dev deployment modes.

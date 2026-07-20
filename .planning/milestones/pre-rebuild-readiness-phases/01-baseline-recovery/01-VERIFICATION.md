---
phase: 01-baseline-recovery
verified: "2026-03-29T03:00:00Z"
status: passed
score: 4/4 must-haves verified
---

# Phase 1: Baseline Recovery - Verification

## Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Backend package tests in `./cmd/...` and `./internal/...` pass | passed | `$env:GOPROXY='https://proxy.golang.org,direct'; go test ./cmd/... ./internal/...` completed successfully |
| 2 | All Go command binaries in scope build from this checkout | passed | `$env:GOPROXY='https://proxy.golang.org,direct'; go build -mod=mod ./cmd/api; ./cmd/worker; ./cmd/migrate; ./cmd/seed` completed successfully |
| 3 | The Next.js app completes a production build | passed | `cd apps/web && npm run build` completed successfully on Next.js 14.2.15 |
| 4 | The standardized localhost contract is live | passed | `docker compose ps` shows core services up; `GET http://localhost:8080/healthz` returned `{"service":"blockxone-api","status":"ok",...}`; `GET http://localhost:3000/login` returned `200` after dev-server restart |

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `.planning/phases/01-baseline-recovery/01-01-PLAN.md` | Executed recovery plan | passed | Plan reflects the actual baseline work completed in this phase |
| `.planning/phases/01-baseline-recovery/01-01-SUMMARY.md` | Human-readable phase outcome | passed | Summary records the verified baseline recovery result |
| `README.md` | Local startup contract documented | passed | README now points the web app to `3000` and the API to `8080` |
| `apps/web/package.json` | Local frontend contract and dependency state | passed | Dev/start scripts use port `3000`; missing table dependency added |

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `internal/auth/auth.go` | `internal/rbac/rbac.go` | Shared interface-based store contract | passed | Middleware and RBAC loading now compile and test together |
| `internal/policy/policy.go` | `internal/policy/policy_test.go` | Query-row interface boundary | passed | Policy logic and tests now agree on the contract |
| `apps/web/src/components/wallet/WalletWidget.tsx` | `apps/web/src/lib/auth-context-v2.tsx` | Typed auth/wallet integration path | passed | Frontend build passes with the updated wallet/auth typing |

## Requirements Coverage

| Requirement | Status | Blocking Issue |
|-------------|--------|----------------|
| FND-01 | passed | |
| FND-02 | passed | |
| FND-03 | passed | |
| FND-04 | passed | |

## Result

Phase 1 passed. `blockxone` now has a verified local build/run baseline and is ready to advance to API runtime integrity work.

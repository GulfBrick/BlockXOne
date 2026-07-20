---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: production-ready rebuild
current_phase: 0 of 12 (planning truth and containment)
status: in_progress
last_updated: "2026-07-19T23:55:52+02:00"
progress:
  total_phases: 12
  completed_phases: 0
  total_plans: 3
  completed_plans: 0
---

# BlockXOne Production-Ready Rebuild State

## Program reference

Primary program plan: `docs/BLOCKXONE_PRODUCTION_MASTER_PLAN.md`

Execution contract: `docs/BLOCKXONE_AGENT_EXECUTION_LOOP.md`

**Core value:** BlockXOne gives regulated private-market participants one governed operating system for qualification, subscription, reconciled settlement, token issuance, register control, servicing, reporting and redemption.

**Current focus:** Phase 0 — recoverable baseline, planning truth, feature containment, test contract and evidence policy.

## Current position

- **Milestone:** v2.0 Production-Ready Rebuild
- **Production-gate progress:** 0 of 12 phases complete
- **Execution mode:** controlled autonomous loop; one phase at a time
- **Auto advance:** disabled
- **Planning/evidence versioning:** enabled
- **Reference baseline:** `108be19f56dbdf87fe01ec18110c460415baf227`
- **Integration branch:** `codex/blockxone-production-v1`
- **Active phase branch:** `codex/phase-00-rebaseline`
- **Active worktree:** `C:\Users\danie\Documents\BlockXOne Production Rebuild`
- **Original WIP/reference workspace:** `C:\Users\danie\Documents\BlockXOne Test`
- **Recovery artifact:** `C:\Users\danie\Documents\BlockXOne Phase0 Recovery 20260719\blockxone-working-tree-source.zip`
- **Recovery SHA-256:** `B9F0C62171F2B06F9EE47DB594FB09718792BB5E9B27856C85EB498C5BE0FF15`

## Locked execution decisions

- The original WIP workspace remains a reference source and is not reset, cleaned or bulk-promoted.
- The active implementation uses a clean isolated worktree from the selective reference-baseline commit.
- Stock unrestricted autonomous mode is not used.
- Builders cannot verify their own work.
- Missing evidence is failure.
- Maximum two autonomous remediation cycles apply to the same root cause.
- Critical/high, financial-integrity, tenant-isolation, contract-safety and false-success gaps cannot be deferred.
- No remote push, production deployment, mainnet, real money, live identity document or production key action occurs without the applicable approval.
- Planning and production evidence are version controlled.
- Earlier Phase 1/2 work is reusable historical/prototype evidence, not a passed production phase.

## Provisional launch defaults awaiting domain approval

- South Africa as first jurisdiction.
- One issuer or issuing SPV.
- Private debt note or closed-ended fund interest as the golden instrument; choose after counsel/accounting review.
- Professional/institutional/otherwise eligible investors only.
- ZAR settlement.
- One EVM network.
- One approved KYC/KYB provider, bank/payment route and custody/signing model.
- Primary issuance, servicing, reporting and controlled redemption only.
- No secondary market, retail, cross-border, FX or multi-chain release-one scope.

These defaults permit planning but not legal, financial, provider or production approval.

## Phase 0 working-tree evidence captured

- Dirty worktree independently inventoried: 627 paths across product, planning, archive removal, agent tooling and generated/anomalous files.
- Non-secret source snapshot created and hash verified with 3,254 entries.
- Actual runtime environment files were not opened or copied.
- The selective baseline delta introduced no archive deletions, executables, environment files, agent/connector state or Word binaries; full-tree review later disproved the stronger inherited-tree claim.
- Local provisional reference commit created at `108be19`.
- Clean Phase 0 worktree created from the exact baseline.
- Current scoped Go tests, vet, builds, golangci-lint v2.12.2, gosec v2.25.0 and formatting checks pass; uncached tests pass locally. Linux race evidence remains CI-only.
- Pinned govulncheck v1.6.0 initially found five reachable vulnerabilities; exact first-fixed upgrades to pgx/v5 5.9.2 and go-ethereum 1.17.0 now scan with zero reachable vulnerabilities, and full scoped tests/vet/build/module verification pass.
- Web clean install, 4 preflight tests, 5 production URL-policy tests, 38 unit tests, lint, full/runtime audits, Next 15.5.20 production build and live route-containment probe pass on Node 22.23.1/npm 10.9.8. Default Node 25 is rejected.
- Contracts clean install, 8 preflight tests, compile/typecheck and 57 tests pass on Node 22.23.1/npm 10.9.8. Exact temporary overrides pin patched adm-zip 0.6.0, diff 8.0.3 and serialize-javascript 7.0.7; both full and runtime audits now report zero locally.
- Production Compose renders with four externally managed-service application processes and 29 fail-closed required variables.
- The migration runtime now includes migration files; CI defines clean/current-schema smoke runs. The seed tool requires explicit local-only opt-in, and the worker receives only APP_ENV, DATABASE_URL and NATS_URL.
- Workflow syntax, planning, CI-policy and Compose-policy validators pass; deployment and rollback remain intentionally blocked.
- Docker Desktop is unavailable locally, so image builds and provenance are not reproduced.
- Full-tree reconciliation found `BlockXOne-fullstack.zip`, `api.exe` and `bin/api.exe` in the inherited baseline. The ZIP name index includes an actual `.env.local` path. The working-tree copies are removed, but current ancestry and `origin/main` remain contaminated.
- Focused independent re-review confirmed all identified migration, seed, Docker-context, admin-route, worker-secret, Go-vulnerability and planning-truth P1/P2 remediations are resolved in the working tree; the verdict remains P0 no-go.
- A later independent contract re-review confirmed the exact override/lock resolution, 8 preflight tests, typecheck, 57 tests, offline zero audits and CI ordering; BLK-012 is locally remediated, not an exact-candidate pass.
- The uncommitted remediation tree is preserved outside Git as a filtered 464-file snapshot, SHA-256 `1C0FFC0F35ED5D14C73EB4F2297BD785AD35BC4AF4D5167F3A60A665E691D1F7`; it excludes the three incident artifacts and remains non-production recovery evidence.

## Known blockers and no-go conditions

- Repository-history incident `BX1-SEC-2026-07-19-01` requires authorised credential assessment/rotation and a clean-history decision before Phase 0 exit.
- The final exact clean-root commit does not yet exist and has not been independently verified.
- Section 29 legal/product/provider decisions are provisional, not professionally approved.
- Contract developer-tool audit is remediated in the working tree with tested pinned overrides; exact-clean hosted reproduction and upstream replacement tracking remain required.
- Docker image candidates, Linux race checks and a complete hosted CI run have not been reproduced against an exact clean commit.
- The new migration smoke job has only static local workflow evidence because the local Docker daemon is unavailable; hosted execution remains required.
- Deployment and rollback are deliberately unavailable until immutable artifacts, migration/recovery, platform, health and approval controls exist.
- Financial ledger, reservations and reconciliation are not production-grade.
- Current compliance/payment/custody adapters include mock behavior.
- Current smart-contract tests do not prove official conformance or safe identity/privileged-operation invariants.
- No external legal, accounting, tax, penetration or smart-contract audit evidence exists for the target release.

## Historical disposition

- March brand/landing artifacts are preserved under `.planning/milestones/pre-production-rebaseline-phases/01-brand-and-landing-foundation/`.
- March frontend/public artifacts are preserved under `.planning/milestones/pre-production-rebaseline-phases/02-frontend-foundation-and-public-site/`.
- Premature investor/operator portal plans are preserved under the same historical directory and retired from execution.
- Pre-rebuild readiness phases remain under `.planning/milestones/pre-rebuild-readiness-phases/`.

## Next actions

1. Obtain a named incident owner and rotate/revoke or prove non-secret every credential class that may have existed in the tracked `.env.local`.
2. Obtain approval for a clean-root production lineage or coordinated remote-history rewrite; do not force-push autonomously.
3. Create and independently scan the exact clean production root/ref so the repository-artifact validator passes across reachable history.
4. Reproduce the contract clean install, generation/typecheck, tests and zero full audit in hosted CI on the exact clean commit; remove overrides only when upstream ranges are safe.
5. Reproduce images, Linux race tests, migrations and full hosted CI against the exact clean commit.
6. Complete independent verification and Phase 0 human approval.
7. Only then prepare/execute the G1 human decision package before implementing the golden product.

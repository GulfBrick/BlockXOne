---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: production-ready rebuild
current_phase: 0 of 12 (planning truth and containment)
status: in_progress
last_updated: "2026-07-21T03:07:07+02:00"
progress:
  total_phases: 12
  completed_phases: 0
  total_plans: 4
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
- **Rejected candidate (`C1`):** `38c23993ad866c1f95df192c4cb3075bf246218b`
- **Generation 2 checkpoint (`Q2`):** `ecbe7f950d1945c5eb2dfaa767caa6aebb80353b`
- **Parentless generation 2 root (`R2`):** `81e06c32976b3c15460c298bd453a1dfce20f3b9`
- **Admitted immutable baseline (`C2`):** `a88658ad82f3d22aaf26e10b9eab6389084e6dd3`
- **Generation 3 research commit (`D3`):** `d0c71d7919a6ffa4a18ef3e0fe62f41fb9867294`
- **Generation 3 accepted-plan commit (`P3`):** `e00b5056c337b484ff11918dc3f7952c97cdfe64`
- **Active phase branch:** `codex/phase-00-generation-3`
- **Active working repository:** `C:\Users\danie\Documents\BlockXOne Production Gen3`
- **Immutable C2 repository:** `C:\Users\danie\Documents\BlockXOne Production Clean v2`
- **Generation 3 plan receipt:** `C:\Users\danie\Documents\BlockXOne Phase0 Recovery 20260719\clean-root-20260720\generation-3-20260721\GEN3-PLAN-ACCEPTANCE.md`, SHA-256 `879E5D146AB18D96610AA8F3C8929ECB91DE39C0D88EF56DC8D528EE6CB68D9B`
- **Rejected generation 1 repository:** `C:\Users\danie\Documents\BlockXOne Production Clean`
- **Quarantine worktree:** `C:\Users\danie\Documents\BlockXOne Production Rebuild`
- **Original WIP/reference workspace:** `C:\Users\danie\Documents\BlockXOne Test`
- **Recovery artifact:** `C:\Users\danie\Documents\BlockXOne Phase0 Recovery 20260719\blockxone-working-tree-source.zip`
- **Recovery SHA-256:** `B9F0C62171F2B06F9EE47DB594FB09718792BB5E9B27856C85EB498C5BE0FF15`

## Locked execution decisions

- The original WIP workspace remains a reference source and is not reset, cleaned or bulk-promoted.
- The active implementation uses the standalone parentless generation 2 lineage at `C:\Users\danie\Documents\BlockXOne Production Clean v2`; the selective-reference worktree is quarantined evidence only.
- Stock unrestricted autonomous mode is not used.
- Builders cannot verify their own work.
- Missing evidence is failure.
- Maximum two autonomous remediation cycles apply to the same root cause.
- Critical/high, financial-integrity, tenant-isolation, contract-safety and false-success gaps cannot be deferred.
- No remote push, production deployment, mainnet, real money, live identity document or production key action occurs without the applicable approval.
- Planning and production evidence are version controlled.
- Earlier Phase 1/2 work is reusable historical/prototype evidence, not a passed production phase.
- Generation 3 is an ordinary descendant of admitted C2; C2 remains read-only evidence and no further parentless rewrite is introduced.
- The user approved local implementation of fail-closed standard mint and separate no-bypass forced issuance. This is not Legal, CISO, G5 or production approval.
- Solidity remains 0.8.20 with optimizer 200; Shanghai will be made explicit only with configuration-only bytecode proof. The production network remains unselected.
- Plan 00-04 must not mark requirements, ROADMAP or Phase 0 complete and must not auto-advance.

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
- Full-tree reconciliation found `BlockXOne-fullstack.zip`, `api.exe` and `bin/api.exe` in the inherited baseline. The ZIP name index includes an actual `.env.local` path. The working-tree copies are removed, but quarantined ancestry and `origin/main` remain contaminated; neither is an ancestor of generation 2.
- Focused independent re-review confirmed all identified migration, seed, Docker-context, admin-route, worker-secret, Go-vulnerability and planning-truth P1/P2 remediations are resolved in the working tree; the verdict remains P0 no-go.
- A later independent contract re-review confirmed the exact override/lock resolution, 8 preflight tests, typecheck, 57 tests, offline zero audits and CI ordering; BLK-012 is locally remediated, not an exact-candidate pass.
- The uncommitted remediation tree is preserved outside Git as a filtered 464-file snapshot, SHA-256 `1C0FFC0F35ED5D14C73EB4F2297BD785AD35BC4AF4D5167F3A60A665E691D1F7`; it excludes the three incident artifacts and remains non-production recovery evidence.
- Generation 1 candidate `C1` was rejected by the unchanged Gitleaks gate and is preserved with its safe report; it is not a baseline or allowlist.
- The reviewed generation 2 contract is frozen at SHA-256 `C91001B50979FA87CB7BDB88E20AAF1FF51E18B57EB590F7B737DEC8824ACA7C`.
- Local generation 2 preparation created `Q2` and parentless `R2` with identical tree `0ca7a6dca26d3abef859160a50b93710fc118ddf`, then imported only `R2` through a complete one-ref bundle into the standalone v2 repository.
- Pre-metadata `R2` checks found one expected branch, no remote/shared/partial Git state, 635 physical objects equal to 635 reachable objects, no known prohibited object IDs, empty strict-fsck diagnostics, a passing 465-path artifact validator and zero Gitleaks findings.
- Exact `C2` was independently locally admitted at `a88658ad82f3d22aaf26e10b9eab6389084e6dd3`; external `CANDIDATE-MANIFEST-v2.md` has SHA-256 `2229439499C55EBD086F5171DF375749B4931303931BF70C207138A0DA8DFE6A`. This does not close human, hosted, incident or production gates.
- Generation 3 was initialized as a separate remote-free repository from the one-ref C2 bundle, researched at D3, and accepted at plan-only P3. Plan 00-04 has 9 serial role-separated tasks and 34 allowlisted paths.

## Known blockers and no-go conditions

- Repository-history incident `BX1-SEC-2026-07-19-01` requires authorised credential assessment/rotation and a clean-history decision before Phase 0 exit.
- Exact `C2` passed final local admission and independent verification; the broader incident, hosted reproduction, professional approvals and Phase 0 exit remain open.
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

1. Execute accepted Plan 00-04 serially from P3: compiler proof, hermetic web tests, fail-closed identity, governed issuance, builder evidence, independent review, independent verification and exact local C3 admission.
2. Keep C2 immutable and re-prove its snapshot before C3 admission; do not push, deploy, use RPC/provider/wallet/key access or move funds/assets.
3. Obtain named incident, repository, Security and Legal/Privacy owners and rotate/revoke or prove non-secret every credential class that may have existed in the tracked `.env.local`.
4. Obtain the formal signed Option A incident decision, old-repository restriction/retention plan and hosted ref/cache/fork/clone closure evidence; no push is authorised.
5. Reproduce images, Linux race tests, migrations, contracts and full CI against the later exact admitted candidate in hosted infrastructure.
6. Complete Phase 0 human approval and the separate G1/G5 professional decisions before any production or regulated release action.

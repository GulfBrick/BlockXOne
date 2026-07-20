# Phase 0: Planning Truth and Containment — Context

**Gathered:** 2026-07-19
**Status:** In progress — local containment implemented; P0 repository-history incident and BASE-06 evidence block exit

<domain>
## Phase Boundary

Phase 0 establishes a recoverable and versioned source baseline, reconciles production planning truth, defines fail-closed feature/test/artifact controls, and calibrates the controlled agent loop. It does not claim that the application, contracts or deployment are production-ready.

</domain>

<decisions>
## Implementation Decisions

### Source preservation

- Preserve the original dirty workspace as WIP/reference.
- Retain selective commit `108be19` only as a quarantined historical reference; it cannot be an ancestor of the production lineage.
- Use `codex/phase-00-rebaseline` only as an isolated remediation worktree while the clean-root decision is pending.
- Do not reset, clean, stash, bulk-stage or delete the original WIP.
- Archive legacy-cleanup deletions as a separate future decision.
- Do not push, rewrite history, force-push, rotate credentials or destroy incident evidence without the named human owners.

### Planning truth

- Active milestone is v2.0 Production-Ready Rebuild.
- Active progress resets to 0/12 production phases.
- Earlier Phase 1/2 work is historical/prototype evidence, not passed production work.
- Earlier portal plans are retired and will be regenerated after foundations freeze.
- Planning and evidence are version controlled.

### Autonomous safety

- Keep `workflow.auto_advance` false.
- Missing evidence is failure.
- Builder, verifier and adversarial review are separate roles.
- Allow at most two repair cycles for one root cause.
- No agent can approve regulated, accounting, custody, mainnet, real-money, migration or go-live gates.

### Launch planning

- Use the master plan's narrow launch defaults provisionally.
- Do not treat them as professional or board approval.
- Defer product implementation until G1 is signed.

### Agent discretion

- Exact Markdown organization and non-semantic planning-file naming.
- Mechanical consistency checks and evidence-index formatting.
- Safe test-harness/configuration improvements that do not choose a regulated product or provider.

</decisions>

<code_context>
## Existing Code Insights

### Reusable assets

- Public BlockXOne brand and design-system work.
- Go API/domain reference implementation and tests.
- Contract prototypes and a 57-test Hardhat suite.
- KYC, payment, custody, monitoring and chain adapter prototypes.
- Docker/CI/monitoring scaffolding.

### Unsafe or incomplete patterns

- Mock provider defaults and raw-key chain configuration.
- Browser-local/demo financial and KYC behavior.
- Missing frontend tests.
- Invalid production Compose configuration.
- Fail-open security and placeholder deployment steps.
- Missing production ledger/reservation/reconciliation model.
- Contract conformance, claims, initialization and privileged-operation gaps.
- Inherited tracked ZIP containing an `.env.local` path and two generated executables in local and remote reachable history.
- Contract developer-tool findings required temporary exact patched overrides; local clean install, compile/typecheck, 57 tests and full/runtime audits now pass, with exact-clean hosted reproduction pending.

### Integration points

- `.planning/` is the authoritative program state.
- `docs/BLOCKXONE_PRODUCTION_MASTER_PLAN.md` owns production gates.
- `docs/BLOCKXONE_AGENT_EXECUTION_LOOP.md` owns execution behavior.
- `Makefile`, package scripts, `.github/workflows` and Compose files form the current test/release interface.

</code_context>

<specifics>
## Specific Ideas

- One persistent controller plus builder, independent verifier and adversarial reviewer.
- Phase 0 must prove the loop on containment before feature development.
- Finance and blockchain readiness skills run as repeatable phase checks.

</specifics>

<deferred>
## Deferred Ideas

- Exact jurisdiction/instrument/provider/chain choices go to G1/G5 decision packs.
- Application redesign and financial/contract implementation begin only after their dependencies pass.
- Secondary trading and expansion are later milestones.

</deferred>

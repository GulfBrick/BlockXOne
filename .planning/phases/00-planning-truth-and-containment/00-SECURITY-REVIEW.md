# Phase 0 Security and Adversarial Review

**Current status:** **FAIL / NO-GO**
**Review basis:** current reference baseline and production master-plan audit

## Independent review result — 2026-07-19

The independent release reviewer rejected Phase 0. The controlling P0 findings are:

1. `BlockXOne-fullstack.zip`, `api.exe` and `bin/api.exe` remain in the history of every current descendant and on the confirmed `origin/main`; the ZIP name index includes `apps/web/.env.local`.
2. At review time, the mandatory contract full audit was red at 7 high, 1 moderate and 1 low. A later working-tree remediation uses exact patched overrides and now reports zero; hosted exact-clean reproduction remains pending.
3. Docker images, Linux race execution, hosted migration smoke tests, provenance and the complete CI graph have not run against an exact clean candidate.

No environment values were inspected. Working-tree deletion is containment only and does not close the incident.

## Initial pre-remediation findings — historical

The following findings describe the starting reference baseline. Items 1–5 and 7 have local working-tree remediations recorded below; item 6 remains deliberately blocked from production pending the gated provider implementation. This list is not the current Phase 0 blocker register.

1. Production Compose is invalid and includes mock/raw-key risk patterns.
2. Mandatory security scans can be suppressed by `|| true` or no-fail settings.
3. Deployment workflow contains placeholder migration/deploy/health steps.
4. Frontend has no automated tests despite high-risk financial/auth flows.
5. Current route/product code retains demo/browser-local/false-success behavior.
6. Current providers include mock implementations/defaults.
7. Production feature exclusions are not yet server-enforced.

## High-risk findings deferred to gated phases, not waived

- IAM replay, tenancy and resource-authorization gaps — Phase 2.
- Ledger, reservation, idempotency and reconciliation gaps — Phase 3.
- KYC/provider/document/privacy gaps — Phase 4.
- Contract identity/claim/initialization/role and chain-finality gaps — Phase 5.
- End-to-end false-success and exception recovery — Phases 6/7.
- External penetration, contract and infrastructure assurance — Phase 9.

## Required Phase 0 remediation

- Fail-closed production configuration.
- Valid production Compose schema.
- Blocking CI/test/security semantics.
- Non-empty frontend smoke tests.
- Production feature allowlist enforcement for clearly excluded routes/modes.
- Exact toolchain requirements in local and CI commands.

## Post-review safe remediations implemented locally

- API runtime image now contains `migrations/`; CI defines clean-schema and current-schema migration smoke runs.
- Seed execution now needs explicit development opt-in and a loopback PostgreSQL target.
- Docker build contexts reject runtime environment, private-key, archive and executable classes.
- Production admin-user mutations are denied centrally.
- The outbox worker directly uses database/NATS only and receives no API, storage, chain, KYC, custody or payment secrets.
- CI includes pinned `govulncheck`; after upgrading pgx/v5 to 5.9.2 and go-ethereum to 1.17.0, the working-tree scan reports zero reachable vulnerabilities.
- Contract tooling uses exact patched overrides for adm-zip, diff and serialize-javascript; a disposable clean compatibility proof and the active clean-install/compile/typecheck/57-test/full-audit sequence all pass without audit suppression.

Focused independent re-review completed 2026-07-19 and confirmed the migration, seed, Docker-context, admin-route, worker-secret, Go-vulnerability and planning-truth remediations. A later narrow independent re-review also confirmed the active contract overrides, lock resolution, preflight/typecheck/tests, offline zero audits and CI order. Exact-clean hosted reproduction remains required, so these changes do not overturn the P0 verdict.

## Local clean-root technical containment — generation 2

The user authorised local technical execution of Option A without remote action. Generation 1 `C1` was rejected by the unchanged redacted Gitleaks gate and is preserved unchanged. The accepted generation 2 proof contract is SHA-256 `C91001B50979FA87CB7BDB88E20AAF1FF51E18B57EB590F7B737DEC8824ACA7C`.

Quarantine checkpoint `Q2` `ecbe7f950d1945c5eb2dfaa767caa6aebb80353b` and parentless root `R2` `81e06c32976b3c15460c298bd453a1dfce20f3b9` share exact tree `0ca7a6dca26d3abef859160a50b93710fc118ddf`. `R2` was transferred through a complete one-ref bundle into a newly initialised standalone repository. Before this bounded metadata packet, local checks found one branch, no remote/shared/partial Git state, equal physical/reachable object sets, no known prohibited object IDs, empty strict-fsck diagnostics, a passing reachable-history artifact gate and zero Gitleaks findings. Final gates must bind to exact metadata candidate `C2`; its identity and receipts will be written externally after that commit exists.

This resolves neither possible credential exposure nor the contaminated remote, caches, forks or collaborator clones. It is not Security, Legal/Privacy, provider, hosted-CI or Phase 0 approval.

## No-go

Phase 0 cannot pass while a production-labelled environment can accept mock providers, raw keys, default/blank critical values, hidden-but-callable excluded features or mandatory checks that return success after failure.

Phase 0 also cannot pass on a lineage containing the incident artifacts, with an above-threshold mandatory dependency audit, or without exact-candidate hosted evidence.

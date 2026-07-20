# Production Evidence Register

| Evidence ID | Requirement/gate | Artifact | Exact target | Status | Owner/reviewer |
| --- | --- | --- | --- | --- | --- |
| EV-P0-001 | BASE-02 | Recovery archive and manifest | SHA-256 `B9F0C62171F2B06F9EE47DB594FB09718792BB5E9B27856C85EB498C5BE0FF15`; 140,496,989 bytes; 3,254 entries | Captured; restore review pending | Controller / independent verifier |
| EV-P0-002 | BASE-03 | Selective reference baseline | commit `108be19f56dbdf87fe01ec18110c460415baf227` | Failed as production ancestor; retained as historical reference | Controller / independent reconciliation 2026-07-19 |
| EV-P0-003 | BASE-03 | Isolated worktree | `codex/phase-00-rebaseline` from `108be19` | Superseded by clean-root requirement | Controller / independent reconciliation 2026-07-19 |
| EV-P0-004 | BASE-01 | Rebaselined planning | v2.0, 12 phases, dependencies parsed, 0%, 89 active IDs | Captured | Independent final reproduction pending |
| EV-P0-005 | BASE-06 | Original Go tests | provisional reference source | Superseded/reference only | Controller |
| EV-P0-006 | BASE-06 | Original frontend build | provisional reference source | Superseded/reference only | Controller |
| EV-P0-007 | BASE-06 | Original frontend tests | provisional reference source | Superseded: failed because no tests existed | Controller |
| EV-P0-008 | BASE-06 | Original contract tests | Node 20.10.0, 57 pass | Superseded/reference only | Controller |
| EV-P0-009 | BASE-06 | Original Compose config | provisional reference source | Superseded: failed | Controller |
| EV-P0-010 | BASE-01..07 | Phase 0 verification | `.planning/phases/00-planning-truth-and-containment/00-VERIFICATION.md` | No-go; exact clean commit pending | Independent verifier |
| EV-P0-011 | BASE-01 | Planning consistency validator | PowerShell 7 on Windows; 12 phases, 0%, 89 unique IDs | Passed working tree 2026-07-19 | Controller; exact-commit reproduction pending |
| EV-P0-012 | BASE-03 | Full-tree/history artifact scan | `108be19` ancestry and `origin/main`; ZIP, two EXEs; ZIP name index includes `.env.local` | Failed/P0 incident | Independent reconciliation; repository owner/CISO action required |
| EV-P0-013 | BASE-04..06 | CI/deployment policy validator | working tree; mandatory failures propagate; deploy and rollback explicitly block | Passed 2026-07-19 | Controller; exact-commit/hosted reproduction pending |
| EV-P0-014 | BASE-05..06 | Production Compose contract | Docker Compose config; `migrate`, `api`, `web`, `worker`; 29 required variables | Passed working tree 2026-07-19 | Controller; exact-commit reproduction pending |
| EV-P0-015 | BASE-06 | Go quality/security matrix | Go 1.26.5; uncached scoped tests, vet, temp-output builds, golangci-lint 2.12.2, gosec 2.25.0 over 85 files, gofmt | Passed working tree 2026-07-19; local race unavailable | Controller; Linux/exact-commit reproduction pending |
| EV-P0-016 | BASE-04..06 | Web matrix | Node 22.23.1/npm 10.9.8; preflight 4/4, URL policy 5/5, unit 38/38, lint, build, live bypass probe | Passed working tree 2026-07-19 | Controller; independent exact-commit reproduction pending |
| EV-P0-017 | BASE-06 | Web dependency audits | full and runtime `npm audit --audit-level=moderate` | Passed, 0 findings 2026-07-19 | Controller; exact-commit reproduction pending |
| EV-P0-018 | BASE-06 | Contract matrix | Node 22.23.1/npm 10.9.8; preflight 8/8 including override-drift rejection, Hardhat 3 compile, typecheck, 57/57 tests | Passed working tree 2026-07-19 with safety caveat | Controller/Blockchain; independent exact-commit reproduction pending |
| EV-P0-019 | BASE-06 | Contract dependency audits | npm overrides: adm-zip 0.6.0, diff 8.0.3, serialize-javascript 7.0.7; clean install; full/runtime audits | Passed working tree 2026-07-19: 0 findings; exact-clean hosted reproduction pending | Blockchain/Platform/CISO |
| EV-P0-020 | BASE-04..05 | Production config and route negatives | Go config/release-policy tests; Next middleware live probe including `x-middleware-subrequest` variants | Passed working tree 2026-07-19 | Controller; independent exact-commit reproduction pending |
| EV-P0-021 | BASE-06 | Docker candidate images | local Docker Desktop daemon | Not reproduced: daemon unavailable | Platform/SRE |
| EV-P0-022 | BASE-06 | Workflow syntax | actionlint v1.7.12 after artifact-gate edit | Passed working tree 2026-07-19 | Controller; exact-commit reproduction pending |
| EV-P0-023 | BASE-02..03 | Repository secret-pattern/path scan | tracked text patterns and non-example env filenames | Passed for visible working-tree text; invalidated for inherited opaque ZIP/history | CISO/independent verifier |
| EV-P0-024 | BASE-01..07 | Independent release-readiness review and focused re-review | current uncommitted working tree on contaminated lineage | **Failed/no-go** 2026-07-19; all identified P1/P2 remediations independently resolved, controlling P0 history/BASE-06 gates remain | Independent verifier |
| EV-P0-025 | Phase 0 | Phase 0 human exit approval | exact clean commit and complete evidence set | Pending | Program Council, CTO/CISO |
| EV-P0-026 | BASE-02..03 | Repository-history incident and human action record | `BX1-SEC-2026-07-19-01`; no values inspected; hashes, rotation classes, cache scope and approval fields recorded | Open/P0; working-tree containment only | Repository owner/CISO/secret owners/Legal-Privacy as applicable |
| EV-P0-027 | BASE-04..06 | Post-review containment packet | migration files in image; clean/current CI smoke definition; local-only seed; admin mutation deny; Docker context excludes; worker least privilege | Local tests/static validators passed and focused independent re-review resolved all identified P1/P2 findings 2026-07-19; hosted/exact-commit reproduction pending | Controller / independent verifier |
| EV-P0-028 | BASE-06 | Reachable Go vulnerability scan | govulncheck 1.6.0; pgx/v5 5.9.2; go-ethereum 1.17.0 | Passed working tree: 0 reachable vulnerabilities; 8 imported-package and 14 required-module findings are not called | Dependency remediation builder / independent reproduction pending |
| EV-P0-029 | BASE-06 | Migration CI contract | PostgreSQL 16 service; apply to clean schema then rerun current schema; images require migration job | Static workflow/actionlint/CI-policy evidence only; hosted execution pending | Platform/SRE |
| EV-P0-030 | BASE-06 | Contract override compatibility proof | `contracts/DEPENDENCY-OVERRIDES.md`; disposable clean copy plus active tree on Node 22.23.1/npm 10.9.8; Hardhat compile, type generation/typecheck, 57 tests, npm ls and full audit | Passed and independently re-reviewed; patched APIs exercised without audit suppression; upstream internal suites and hosted exact-commit run pending | Contract dependency investigator / Controller / independent verifier |
| EV-P0-031 | BASE-02 | Filtered Phase 0 remediation snapshot | external ZIP; SHA-256 `1C0FFC0F35ED5D14C73EB4F2297BD785AD35BC4AF4D5167F3A60A665E691D1F7`; 7,555,318 bytes; 464 files | Captured; name-only prohibited-path validation passed; non-production recovery evidence | Controller / restore review pending |

Rules:

- `Captured` is not `Approved`.
- Evidence must include command, time, result, commit/artifact/environment and reviewer.
- A later code change invalidates affected evidence until reproduced.
- Legal/accounting/AML/custody/external-audit approvals must link signed human evidence, not agent text.
- `EV-P0-###` is the canonical Phase 0 evidence namespace; phase-local documents reference these IDs rather than creating a second numbering scheme.

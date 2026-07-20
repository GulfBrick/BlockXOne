# Authoritative Test and Toolchain Contract

## Toolchains

| Domain | Required version/policy |
| --- | --- |
| Go | Exactly 1.26.5 in CI/container; `go.mod` requires Go 1.26 and toolchain 1.26.5 |
| Web and contracts Node | Exactly 22.23.1 in `.nvmrc`, `.node-version`, packages, preflight and CI |
| npm | Exactly 10.9.8; lockfiles and engine-strict/preflight enforcement |
| Solidity/Hardhat | Solidity 0.8.24 with optimizer/EVM target pinned; Hardhat 3.10.0 and exact direct dependencies |
| Security tools | golangci-lint 2.12.2, gosec 2.25.0, govulncheck 1.6.0, actionlint 1.7.12 |
| Containers | Version pins are not release provenance; immutable image digests, SBOM/signing and hosted build evidence remain required |

## Required Phase 0 commands

```powershell
pwsh -NoProfile -File .\.planning\scripts\validate-planning.ps1
pwsh -NoProfile -File .\.planning\scripts\validate-repository-artifacts.ps1
pwsh -NoProfile -File .\.planning\scripts\validate-ci-policy.ps1
pwsh -NoProfile -File .\.planning\scripts\validate-production-compose.ps1
actionlint -no-color

go test -count=1 .\cmd\... .\internal\... .\scripts\...
go vet .\cmd\... .\internal\... .\scripts\...
golangci-lint run --timeout 5m .\cmd\... .\internal\... .\scripts\...
gosec -tests -severity medium -confidence medium .\cmd\... .\internal\...
govulncheck .\cmd\... .\internal\... .\scripts\...

Push-Location apps\web
npm ci
npm run test:preflight
npm run test:config
npm test -- --run
npm run lint
npm audit --audit-level=moderate
npm audit --omit=dev --audit-level=moderate
npm run build
npm run test:production-containment
Pop-Location

Push-Location contracts
npm ci --ignore-scripts
npm run test:preflight
npm run compile
npm run typecheck
npm test
npm audit --omit=dev --audit-level=moderate
npm audit --audit-level=moderate
Pop-Location

docker compose --env-file config/production.env.example -f docker-compose.prod.yml config --quiet
```

The repository-artifact validator fails by design on the contaminated lineage. The Go dependency scan passes after upgrading `pgx/v5` to 5.9.2 and `go-ethereum` to 1.17.0. The contract full and runtime audits pass after explicit patched transitive overrides. Docker images, Linux race tests, hosted migration smoke tests and full hosted CI are outstanding. These conditions keep BASE-03/BASE-06 and Phase 0 open; they must not be suppressed or reclassified as success.

Contract overrides are temporary controlled pins, not audit waivers: `adm-zip` 0.6.0, `diff` 8.0.3 and `serialize-javascript` 7.0.7. CI installs with lifecycle scripts disabled, compiles before typecheck so generated types exist, then runs all tests and the mandatory full audit. Track upstream Hardhat/Mocha dependency ranges and remove an override only after the upstream graph resolves to a patched compatible version and this matrix passes again.

## Fail-closed rules

- CI must not use `|| true`, `-no-fail`, ignored exit codes or echo-only deployment steps for mandatory gates.
- “No tests found” is failure for a declared test suite.
- Unsupported toolchain is failure.
- Security/dependency findings at or above approved severity block the pipeline.
- Migrations must be tested from clean and current schemas, with rollback/forward-recovery strategy.
- Production configuration must be tested with required values absent, mock values present and environment mismatches.
- Release evidence must run from a clean checkout/worktree of the exact commit.
- The exact commit's complete reachable history must pass the repository-artifact policy; a clean working tree on contaminated ancestry is insufficient.

## Expansion by phase

Later phases add database concurrency, provider contract, workflow restart, E2E, accessibility, contract invariant/fuzz, chain reorganisation, financial reconciliation, performance, resilience and DR suites. Each phase validation file specifies its authoritative subset.

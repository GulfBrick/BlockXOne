---
phase: 0
status: active
nyquist: required
independent_verifier: required
adversarial_reviewer: required
---

# Phase 0 Validation Architecture

## Validation principle

Phase 0 passes only when a clean worktree can reproduce planning truth, baseline integrity and fail-closed delivery behavior. Shape-only GSD health is insufficient.

## Acceptance matrix

| ID | Requirement | Test | Expected result |
| --- | --- | --- | --- |
| V0-01 | BASE-01 | `init milestone-op` | v2.0, production-ready rebuild, commit docs true |
| V0-02 | BASE-01 | `roadmap analyze` | 12 phases, 0 complete, 0%, next 0, dependencies populated |
| V0-03 | BASE-01 | `validate health` plus custom checks | no milestone/status/directory contradiction |
| V0-04 | BASE-01 | requirement parser | 89 unique active IDs, each mapped once |
| V0-05 | BASE-02 | archive hash/list | exact SHA-256; required entries present; forbidden entries absent |
| V0-06 | BASE-03 | Git/worktree comparison | clean worktree at exact baseline; original WIP remains |
| V0-07 | BASE-03 | full reachable-history/path policy | no runtime env, key, archive, executable, agent state or dependency artifacts in any reachable commit |
| V0-08 | BASE-04 | feature-policy matrix | excluded features/routes not production-operable |
| V0-09 | BASE-05 | production config negatives | every mock/dev/default/raw-key/missing-critical case fails |
| V0-10 | BASE-06 | Go test | pass |
| V0-11 | BASE-06 | frontend build and tests | both pass with non-empty test suite |
| V0-12 | BASE-06 | contract toolchain/tests | unsupported Node fails; pinned LTS and suite pass |
| V0-13 | BASE-06 | Compose config | valid with example contract; missing critical values fail startup tests |
| V0-14 | BASE-06 | CI mutation | deliberate mandatory failure blocks pipeline |
| V0-15 | BASE-07 | register/artifact review | required registers exist, owned and versioned |
| V0-16 | All | independent diff/evidence review | verifier `passed`; adversarial findings resolved |
| V0-17 | BASE-06 | pinned `govulncheck` | no reachable Go dependency vulnerability |
| V0-18 | BASE-06 | migration smoke | all migrations pass on a clean schema and rerun safely on the current schema |
| V0-19 | BASE-05..06 | worker secret-boundary render | worker receives exactly APP_ENV, DATABASE_URL and NATS_URL |
| V0-20 | BASE-03 | `Q`/`R`/`C` identity proof | `Q` clean and immutable; `R` has zero parents and `tree(R) = tree(Q)`; every final receipt names exact `C` |
| V0-21 | BASE-03 | transfer-bundle proof | exactly `refs/heads/codex/production-clean-root`; complete history; zero prerequisites |
| V0-22 | BASE-03 | standalone ref/object proof | one expected branch; no remote/tag/replace/graft/shallow/partial/alternate/shared-object state; physical objects equal reachable objects; strict fsck emits nothing |
| V0-23 | BASE-03 | Gitleaks 8.30.1 history and tree scans | verified scanner archive; safe wrapper emits only approved metadata; zero unresolved findings |
| V0-24 | BASE-02..03 | old-to-new manifest comparison | exact safe `Q`/`R`/`C`, tree/path/object counts and hashes; no prohibited artifact or secret value |
| V0-25 | BASE-03 | known prohibited-blob absence | all three quarantined blob OIDs are absent from the standalone object database |

## Clean-root identity and admission contract

- `Q` is the final commit on `codex/phase-00-rebaseline` after the accepted plan and proof tooling are committed. Its worktree must be clean.
- `R` is created from `tree(Q)` with `git commit-tree` and no parent. `R` is transferred through a single-ref complete bundle into a newly initialised standalone repository.
- `C` is the only permitted metadata child of `R`. Every final local admission command, safe report and independent verdict binds to exact `C`; a later commit invalidates those receipts.
- Gitleaks is pinned to `8.30.1`; the official Windows x64 release archive SHA-256 is `D29144DEFF3A68AA93CED33DDDF84B7FDC26070ADD4AA0F4513094C8332AFC4E`.
- Secret-scan console and persisted output may contain only scanner/schema/candidate identity plus grouped `scope`, `rule_id`, repository-relative `path`, `commit` and `count`. Raw matches, secrets, source lines, context, fingerprints, hashes and URLs are forbidden.
- `00-VERIFICATION.md`, ROADMAP, REQUIREMENTS, completion state and human approval fields cannot be changed by the clean-root builder.

## Baseline commands

```powershell
pwsh -NoProfile -File .\.planning\scripts\validate-planning.ps1
pwsh -NoProfile -File .\.planning\scripts\validate-repository-artifacts.ps1
pwsh -NoProfile -File .\.planning\scripts\validate-ci-policy.ps1
pwsh -NoProfile -File .\.planning\scripts\validate-production-compose.ps1
# On exact standalone candidate C, with report path outside the repository:
pwsh -NoProfile -File .\.planning\scripts\invoke-redacted-gitleaks.ps1 -GitleaksPath <verified-gitleaks.exe> -RepositoryPath . -ReportPath <external-safe-report.json> -ExpectedCandidateCommit <C>
git fsck --full --strict --no-reflogs --unreachable --no-progress
actionlint -no-color
go test -count=1 .\cmd\... .\internal\... .\scripts\...
go vet .\cmd\... .\internal\... .\scripts\...
golangci-lint run --timeout 5m .\cmd\... .\internal\... .\scripts\...
gosec -tests -severity medium -confidence medium .\cmd\... .\internal\...
govulncheck .\cmd\... .\internal\... .\scripts\...
# Run the web and contract matrices exactly as specified in .planning/TEST-CONTRACT.md.
# Hosted CI must also run Linux race, migrations and image builds on the exact clean commit.
```

## Adversarial cases

- Worktree created from original `df3e169` loses required WIP.
- Duplicate or missing active requirement ID.
- Dependency field renamed so parser returns `null`.
- Phase 7/8 selected before Phase 2/6.
- Secret-like content or actual env file staged.
- Security/test command fails but CI returns success.
- Frontend declares success with zero tests.
- Production starts with `CHAIN_MODE=mock`, mock KYC/payment, blank addresses or raw key.
- Compose validates locally but not in CI.
- Unsupported route is hidden in navigation but remains directly callable.
- Evidence refers to a different commit, artifact or environment.
- A deleted working-tree archive remains reachable from a candidate parent, tag or merge base.
- A prohibited path is reachable only through a second tree alias, uses uppercase `.ENV`, contains a newline, or is represented by a symlink/gitlink/LFS pointer/unapproved file mode.
- A transfer bundle includes a second ref or prerequisite, or the standalone repository uses a shared common directory, alternates, remote, replace/graft, shallow/partial-clone state or an unexpected reflog object.
- A dangling/unreachable object exists even though ordinary `git fsck` exits zero.
- A secret scanner reports success while persisting raw match text, context, fingerprints or absolute paths, or while scanning `R` rather than exact candidate `C`.
- A final receipt names `Q` or `R` instead of `C`, or was generated before the metadata commit that created `C`.
- Development seed points to a remote or LAN database.
- Worker receives API, signing or regulated-provider credentials.

## Retry and stop rules

- Ordinary formatting/build failures: maximum two repair cycles.
- Planning inconsistency, secret exposure, omitted WIP, production-mock acceptance or false-success pipeline: immediate no-go, design review before one controlled repair.
- Same root cause after two cycles: `REPLAN_REQUIRED`.
- No human gate may be inferred from an agent response.

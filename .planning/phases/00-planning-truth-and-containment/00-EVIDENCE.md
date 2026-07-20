# Phase 0 Evidence

## Current canonical status

The canonical records are `EV-P0-001` onward in `.planning/EVIDENCE-REGISTER.md`. The `P0-E*` table below is the superseded selective-delta snapshot captured before full-tree/history reconciliation; it must not be used for Phase 0 approval.

| Canonical evidence | Current result |
| --- | --- |
| `EV-P0-012` repository full-tree/history scan | **Failed/P0:** tracked ZIP containing an `.env.local` path plus two executables remain reachable in current ancestry and `origin/main` |
| `EV-P0-015` Go quality/security | Working-tree tests, vet, lint and gosec pass; Linux race and exact-clean-commit reproduction pending |
| `EV-P0-016..017` web | 4 preflight, 5 URL-policy, 38 unit tests, lint, build, live bypass containment and both audits pass locally |
| `EV-P0-018..019` contracts | Clean install, compile/typecheck and 57 tests pass; tested patched overrides reduce full and runtime audits to zero locally |
| `EV-P0-024` independent review | **FAIL/NO-GO**; P0 history and BASE-06 evidence prevent closure |
| `EV-P0-025` human Phase 0 approval | Pending |

## Superseded initial evidence snapshot

## Captured evidence

| ID | Evidence | Target/result | Status |
| --- | --- | --- | --- |
| P0-E01 | Independent dirty-tree inventory | 627 paths classified into six categories | Captured |
| P0-E02 | Recovery archive | 140,496,989 bytes; 3,254 entries | Captured |
| P0-E03 | Recovery integrity | SHA-256 `B9F0C62171F2B06F9EE47DB594FB09718792BB5E9B27856C85EB498C5BE0FF15` | Passed |
| P0-E04 | Forbidden archive entries | env/Git/agent/exe/log/nul patterns | Zero matches |
| P0-E05 | Selective baseline path review | 240 files, zero staged deletions/forbidden paths | Passed |
| P0-E06 | Staged diff check | commit `108be19` candidate | Passed |
| P0-E07 | High-confidence secret signatures | selected text paths | No matches |
| P0-E08 | Reference baseline | `108be19f56dbdf87fe01ec18110c460415baf227` | Captured |
| P0-E09 | Clean worktree | `codex/phase-00-rebaseline` from `108be19` | Passed before phase edits |
| P0-E10 | Go tests | `go test ./...` | Passed |
| P0-E11 | Web build | `npm run build` | Passed |
| P0-E12 | Web tests | `npm test -- --run` | Failed: no tests |
| P0-E13 | Contract default toolchain | Node 25 | Correctly rejected |
| P0-E14 | Contract supported toolchain | Node 20.10.0, 57 tests | Passed with coverage caveat |
| P0-E15 | Production Compose | `config --quiet` | Failed: invalid web resources |
| P0-E16 | Rebaselined roadmap | v2.0, 12 phases, dependencies populated, 0% | Captured; independent review pending |
| P0-E17 | Planning consistency script | 12 phases, 89 unique requirements, healthy GSD | Passed locally |

## Evidence still required for exit

- Human credential classification/rotation or proof of non-secret placeholders.
- Approved clean-root/new-repository or coordinated all-ref history response.
- Dedicated redacted secret scan and repository-artifact validation across the complete reachable history of the exact clean commit.
- Passing mandatory contract full audit reproduced in hosted CI on the exact clean candidate.
- Hosted exact-commit Linux race, clean/current migration, image build, SBOM/provenance and complete CI evidence.
- Independent re-verification of all post-review remediations.
- Phase 0 human approval record.

## Evidence limitations

- Pattern scanning is not a substitute for a dedicated secrets tool and history scan.
- The external source-recovery archive excludes the three prohibited tracked paths and is not a copy of the incident artifacts.
- Passing current Go/contract tests does not prove production controls.
- Current contract suite contains unsafe expectations that must be corrected in Phase 5.
- No external professional or audit evidence is represented as approved.

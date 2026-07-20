# Provisional Reference Baseline — Not Approved for Production Lineage

## Identity

| Field | Value |
| --- | --- |
| Source branch | `codex/blockxone-production-v1` |
| Reference commit | `108be19f56dbdf87fe01ec18110c460415baf227` |
| Active branch | `codex/phase-00-rebaseline` |
| Active worktree | `C:\Users\danie\Documents\BlockXOne Production Rebuild` |
| Original WIP/reference | `C:\Users\danie\Documents\BlockXOne Test` |
| Original committed HEAD | `df3e1698f28891e7d23489a144eae2733bc8b79d` |
| Recovery archive | `C:\Users\danie\Documents\BlockXOne Phase0 Recovery 20260719\blockxone-working-tree-source.zip` |
| Recovery SHA-256 | `B9F0C62171F2B06F9EE47DB594FB09718792BB5E9B27856C85EB498C5BE0FF15` |

## Source inventory

The original worktree contained 627 dirty paths: 62 modified, 97 deleted and 468 untracked. The selective delta used to create `108be19` captured 240 reviewed product/planning paths and deliberately recorded no new deletions. That delta review did **not** prove the complete inherited tree was free of prohibited artifacts.

Included categories:

- active application, contract, migration and test source;
- required package, Go, CI, Docker and environment-example configuration;
- active GSD planning, research and historical planning evidence;
- production master plan and controlled agent-loop contract.

Intended excluded categories for the selected delta:

- actual runtime environment files;
- `.claude`, `.claude-flow`, `.agents`, `.codex` and `.mcp.json` state;
- executables, logs, caches, dependency trees and build output;
- the reserved `nul` path;
- generated Word reports;
- 97 legacy import/archive deletions, retained as a separately reviewable cleanup decision.

## Full-tree containment failure discovered 2026-07-19

Independent reconciliation found that the complete tree at `108be19` inherited three prohibited artifacts from `df3e169`:

- `BlockXOne-fullstack.zip`;
- `api.exe`;
- `bin/api.exe`.

A name-only archive inspection found `BlockXOne-fullstack/apps/web/.env.local` inside the tracked ZIP. No environment values were inspected or printed. Remote `origin/main` was independently confirmed to remain at `df3e169` on 2026-07-19.

The three artifacts have been removed from the active working tree, but they remain reachable through the current branch ancestry and remote history. The incident and required credential-rotation/history response are recorded in `docs/security/2026-07-19-REPOSITORY-HISTORY-INCIDENT.md`.

## Baseline validation snapshot

| Check | Result | Meaning |
| --- | --- | --- |
| Staged diff check | Pass | No whitespace/error markers in selected baseline diff |
| High-confidence secret patterns | No matches in selected text paths | Not a substitute for independent secret scanning |
| Go `go test ./...` | Pass | Current Go tests pass; coverage remains incomplete |
| Web `npm run build` | Pass | Current Next.js production build succeeds |
| Web `npm test -- --run` | Fail | No frontend test files exist |
| Contracts on default Node 25 | Fail closed | Unsupported toolchain is rejected |
| Contracts on Node 20.10.0 | 57 pass | Current tests pass but do not prove production safety/conformance |
| Production Compose validation | Fail | Invalid `services.web.resources`; chain settings default blank |

## Baseline status

This commit is a **provisional historical reference only**, not an approved production baseline or release. It must not be an ancestor of the clean production lineage. BASE-03 remains failed until an approved clean-root repository/ref is independently scanned and verified, and the remote credential/history incident is closed by authorised humans.

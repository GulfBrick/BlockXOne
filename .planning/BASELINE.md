# Local Clean-Root Generation 2 Candidate — Not Approved for Production

## Identity

| Field | Value |
| --- | --- |
| Source branch | `codex/blockxone-production-v1` |
| Reference commit | `108be19f56dbdf87fe01ec18110c460415baf227` |
| Generation 1 checkpoint (`Q1`) | `2335f85401f8e92661fc13f256bc961083208291` |
| Rejected root/candidate (`R1` / `C1`) | `a81cda58315b2908cf06d635d93b768fa40a9045` / `38c23993ad866c1f95df192c4cb3075bf246218b` |
| Generation 2 checkpoint (`Q2`) | `ecbe7f950d1945c5eb2dfaa767caa6aebb80353b` |
| Generation 2 quarantine/root tree | `0ca7a6dca26d3abef859160a50b93710fc118ddf` |
| Parentless generation 2 root (`R2`) | `81e06c32976b3c15460c298bd453a1dfce20f3b9` |
| Active clean branch | `codex/production-clean-root-v2` |
| Active clean repository | `C:\Users\danie\Documents\BlockXOne Production Clean v2` |
| Rejected generation 1 repository | `C:\Users\danie\Documents\BlockXOne Production Clean` |
| Quarantine worktree | `C:\Users\danie\Documents\BlockXOne Production Rebuild` |
| Original WIP/reference | `C:\Users\danie\Documents\BlockXOne Test` |
| Original committed HEAD | `df3e1698f28891e7d23489a144eae2733bc8b79d` |
| Recovery archive | `C:\Users\danie\Documents\BlockXOne Phase0 Recovery 20260719\blockxone-working-tree-source.zip` |
| Recovery SHA-256 | `B9F0C62171F2B06F9EE47DB594FB09718792BB5E9B27856C85EB498C5BE0FF15` |
| Generation 2 transfer bundle | `C:\Users\danie\Documents\BlockXOne Phase0 Recovery 20260719\clean-root-20260720\BlockXOne-clean-root-R2-81e06c32.bundle` |
| Generation 2 bundle SHA-256 | `4F6C25EFECC2270DEA835DF8975763676040E9572E184AD5C33D282B7BE5BE58` |
| Accepted generation 2 plan SHA-256 | `C91001B50979FA87CB7BDB88E20AAF1FF51E18B57EB590F7B737DEC8824ACA7C` |
| Passing `R2` Gitleaks report SHA-256 | `FCCF6A8F1B03128FDB0ABAD1CAC7EB0D2D9CC6490987A996748AE71C201017E7` |
| Rejected `C1` record | `C:\Users\danie\Documents\BlockXOne Phase0 Recovery 20260719\clean-root-20260720\REJECTED-C1-MANIFEST.md` |
| Exact generation 2 candidate manifest | `C:\Users\danie\Documents\BlockXOne Phase0 Recovery 20260719\clean-root-20260720\CANDIDATE-MANIFEST-v2.md` |

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

The three artifacts have been removed from the active clean working tree. They remain reachable through the quarantined branch ancestry and remote history, neither of which is an ancestor of the standalone clean lineage. The incident and required credential-rotation/history response are recorded in `docs/security/2026-07-19-REPOSITORY-HISTORY-INCIDENT.md`.

## Local Option A clean-root generations — 2026-07-20

The user authorised local technical execution of Option A without a push. Generation 1 proved the isolated-root process, but exact candidate `C1` was rejected when the unchanged Gitleaks wrapper returned 12 safe grouped entries across five paths and six path/rule pairs. The rejected repository, bundle, safe report and identity manifest remain preserved unchanged.

Generation 2 checkpoint `Q2` contains only the independently accepted plan plus five exact documentation/test-fixture remediations. Proof tooling and scanner configuration remained pinned. Parentless `R2` was created directly from `tree(Q2)` and transferred through a complete one-ref bundle with no prerequisites into a newly initialised standalone repository.

Before this metadata packet, generation 2 had one branch and one commit, no remote, tag, alternate, shared common directory, replace/graft, shallow or partial-clone state. Its 635 physical objects exactly equalled its 635 reachable objects; strict `git fsck` emitted no diagnostic; all three known prohibited object IDs were absent; the hardened artifact validator passed 465 paths; and Gitleaks 8.30.1 reported zero findings in history and the checked tree.

The exact candidate will be the metadata-only child containing this bounded packet. After that commit exists, its Git object IDs, artifact SHA-256 checksums and post-commit receipts will be written to the external generation 2 manifest because a commit cannot recursively contain its own identifier. Those local receipts will not represent credential, hosted-CI, Security, Legal/Privacy or Phase 0 approval.

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

The old reference commits remain **quarantined historical evidence only** and are not ancestors of generation 2. `C1` is explicitly rejected. The local generation 2 candidate is not an approved production baseline or release. BASE-03 and Phase 0 remain open until exact-candidate admission and independent verification are recorded and the credential/history incident, hosted evidence and named human approvals close.

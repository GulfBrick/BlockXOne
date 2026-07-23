# Phase 0 Evidence

## Authoritative status

Phase 0 remains `in_progress`. Production-gate progress is 0 of 12 phases,
0 completed plans and 0 completed requirements. Release status is **NO-GO**.
The one permitted builder summary produces GSD artifact state `partial`/9
from 11 plans; that is filename-derived artifact metadata, not Phase, plan,
requirement, professional, local-admission or production approval.

The canonical evidence namespace is `EV-P0-001` onward in
`.planning/EVIDENCE-REGISTER.md`. Historical I3/R3/V3 results remain preserved
with a narrow supersession: their broad generated-cleanliness conclusion is
invalid, while their bounded Git, test, scanner and warning evidence remains
historical only.

## Generation 3 lineage and current boundary

| Label | Commit | Meaning |
| --- | --- | --- |
| C2 | `a88658ad82f3d22aaf26e10b9eab6389084e6dd3` | Independently admitted immutable Generation 2 baseline |
| D3 | `d0c71d7919a6ffa4a18ef3e0fe62f41fb9867294` | Generation 3 containment research |
| P3 | `e00b5056c337b484ff11918dc3f7952c97cdfe64` | Accepted Plan 00-04 |
| P4 | `f081dfc211a767e660d93c0bd33f35b2f30a9803` | Accepted summary-semantics boundary |
| P5 | `7d87ed6e8fb1a8c2ef5eb13853a39fc5f96992d2` | Accepted Go advisory boundary |
| D5 | `78084349ff8b6385cc33e95900db6fd1094d68a0` | Exact GO-2026-5970 remediation |
| P6 | `5a489930296830d827ac56690c506714001e06a2` | Accepted web advisory boundary |
| P7 | `c8c41dda2b5df129201a34b55c882743fa523b82` | Accepted PostCSS boundary |
| P8 | `ee017cd9b8ae2840dfee4d3053d714c6b10eedaa` | Accepted canonical-lock boundary |
| W7 | `059fc54c4d12b1d889a13d7295da7605006654c4` | Canonical web dependency remediation |
| P9 | `08eeb7dc0475c311c35f3a5b5e54bc242b132a62` | Accepted evidence-staging correction |
| I3 | `6ba1d29cbf5e7a3cc805a96ec942364dde2497b9` | Preserved Generation 3 builder freeze |
| R3 | `4b1eb982d1fefa2aed07d15b690480da0707a32a` | Preserved adversarial review |
| V3 | `37abb9517f86c79b541209bed66f622fae153b7f` | Preserved verification commit; not admitted as C3 |
| P10 | `76c8c7d07da2d7c13c7f57ce77a29bcd4615cd5f` | Accepted ignored-output correction plan |

P10 tree is `3a29405e95c106cfbbf23d7d2abaa5e9c2d955a3` and its parent
is exact V3. `V3..P10` is only `00-11-PLAN.md`. Its acceptance receipt has
SHA-256
`5363D742FAB0472A6874BE8ABD9649AB795D403223D57AEF1FA1BC11E71DC59A`.
P10 was ordinary-clean, ignored-aware-clean and remote-free. It is the only
accepted parent for the future seven-file I4.

## Exact V3 fail-closed admission stop

At exact V3, the distinct Task 9 owner ran:

`git status --porcelain=v1 --untracked-files=all --ignored=matching`

It returned `!! apps/web/next-env.d.ts`. The file was untracked, ignored by
`apps/web/.gitignore`, 268 bytes and had SHA-256
`F4E8976C19FC926644D72610BF1058BD6BF52ADD97E46A02BC0B912A751625C0`.
Because the precondition failed, no Task 9 matrix, scanner, candidate manifest
or C3 admission ran. V3 remains preserved and unadmitted.

External `GEN3-V3-TASK9-FAILURE-RECEIPT.md` has SHA-256
`83FA91B1EAB7492D5BB5E6DD8FB326CEC477DD068793C2394060C9BFAD908259`.
The exact file was moved without overwrite and remains recoverable at:

`C:\Users\danie\AppData\Local\Temp\blockxone-gen3-v3-next-env-f4e8044a037a4db7805c4dad546d0e99\apps-web-next-env.d.ts`

The old external receipt hashes remain frozen:

- I3 builder:
  `ED243F6CCDBF1CB99528BD6B0F094884C09852236A89C35EDE32A72ABC63ED6E`
- R3 security review:
  `68DF8F6812CCFC867617B388DF742B6EB5403BA6F827D8672EC55EF91516E73A`
- V3 verification:
  `99381FBDF0A39E1CBE19786F10230BBEA5D6E1435EB2EB0C4D26F736C22377D8`

Those receipts and commits are not rewritten. Only their stale broad
generated-cleanliness conclusion is superseded.

## Corrected cleanup and residue boundary

The TEST-CONTRACT no longer recursively deletes generated output. It creates
a fresh absent directory beneath the resolved OS temporary root and moves only
known literal sources beneath exact repository component roots to distinct,
absent destinations. It verifies each source is absent and each destination is
present after the move. The inventory explicitly includes web and contract
dependencies, caches, coverage, build/artifact output, TypeChain output and
`apps/web/next-env.d.ts`.

Quarantine is recoverability evidence, not cleanliness evidence. The final
release boundary runs the exact ignored-aware status command above and fails
on any output. Ordinary status alone is not sufficient.

The planning validator is read-only and exposes two explicit modes:

1. `BuilderStaged` rejects all `??` and `!!` entries and permits only
   index-only changes to the seven Plan 00-11 Task 2 paths; and
2. `CleanCandidate` requires the exact ignored-aware status to be empty,
   including every tracked edit.

The validator never deletes or moves residue.

## Corrected planning artifact semantics

The exact Phase 0 plan filename set is `00-01-PLAN.md` through
`00-11-PLAN.md`. Disposable copies must prove:

- no recognized summary: GSD `planned`/0; and
- exactly one `00-04-SUMMARY.md`: GSD `partial`/9.

Both states retain STATE Phase 0 `in_progress`, 11 total plans, zero completed
plans/phases, ROADMAP Phase 0 unchecked and `In progress`, exactly 89 expected
unique unchecked requirements, and authoritative production progress 0%.

Mutation coverage must reject plan filename/count drift, summary
name/multiplicity/frontmatter/body drift, artifact progress other than 9,
STATE totals or completion drift, ROADMAP or requirement completion/drift,
tool/JSON/health errors and exact ignored `apps/web/next-env.d.ts` residue.
Removing only the disposable ignored fixture must restore the clean-state
pass, and repository originals must remain byte-identical.

Before I4 was committed, the actual seven-path staged summary-bearing state
passed `partial`/9. A disposable exact-seven staged no-summary state passed
`planned`/0. Removing one allowed builder path caused the staged validator to
fail with its exact-seven diagnostic.

The clean-candidate mutation suites passed 92 isolated fixtures:

- no-summary: 1 positive and 38 fail-closed negatives; and
- summary-bearing: 1 positive and 52 fail-closed negatives.

Coverage included exact plan/count, summary metadata/body, STATE total 11,
ROADMAP/requirements incompleteness, GSD progress 9 and related output/health,
nonzero/malformed tools, reparse paths, tracked edits, ordinary untracked
residue and ignored residue. The exact ignored `apps/web/next-env.d.ts`
fixture failed in both states; moving only that fixture to an absent
destination restored each clean pass. Source planning fingerprints remained
byte-identical. The retained test root is:

`C:\Users\danie\AppData\Local\Temp\blockxone-i4-staged-fixtures-be2445c0c6104e9ba79742e0e328d192`

The exact-I4 rerun is external because I4 cannot self-record its own immutable
identity.

## Preserved narrow local evidence

The earlier exact P9/I3/R3/V3 matrices recorded passing planning,
repository-artifact, CI-policy, Compose-policy and actionlint gates; exact Go
tests/vet/lint/gosec/govulncheck; web preflight/configuration/runner/unit/lint/
build/containment and full/runtime audits; contract preflight/compile/typecheck/
59 tests and audits; raw Compose rendering; and canonical bytecode comparison.
These command results are not silently erased.

The configuration-only bytecode evidence compared C2 with accepted Task 2
commit `2a55a5fbf51a2018a650122eff313f3ce4e63dff`, covered 43 complete compiler
outputs and 27 user artifacts, and produced SHA-256
`9D75271BB9A9E87D410D98DC9EAE4F0ADAA8597B7D55E4A72324EC2BEA78AF62`.
It does not assert that later Solidity changes preserve bytecode.

The ignored-path omission means the old matrices cannot establish a
release-clean candidate or C3. Exact I4 must reproduce the complete contract
under the corrected ignored-aware boundary before distinct R4 and V4 roles can
review and verify it.

## Evidence still required

- Exact seven-file I4 with P10 as parent and external
  `TASK6-I4-BUILDER-RECEIPT.md`.
- Exact-I4 full matrix, mutations, bytecode reproduction, ordinary and
  ignored-aware final cleanliness and zero remotes.
- Exact-I4 adversarial review by the distinct Task 3 reviewer, producing R4.
- Exact-R4 independent verification by the distinct Task 4 verifier,
  producing V4.
- Exact-V4 local-only admission by the distinct Task 5 owner, producing
  external C4 evidence without a Git change.
- Hosted Linux race, clean/current migration, image build, SBOM/provenance and
  full CI evidence.
- Repository incident credential classification/rotation, old-host/ref/cache/
  fork/clone disposition and signed Legal/Privacy decisions.
- G1/G4/G5 professional decisions, provider certification, authoritative
  compiler provenance, external penetration/smart-contract audit and human
  Phase 0 approval.

## Evidence limitations

- Local tests, scanners and dependency audits do not prove legal compliance,
  financial correctness, provider suitability, production resilience or
  external security assurance.
- The web fetch guard is not a system firewall and does not cover every Node
  networking primitive.
- Shanghai is a controlled compiler target, not an approved production
  network.
- Identity and governed issuance containment does not close G5 or substitute
  for authoritative conformance, independent review or external retest.
- No remote, push, deployment, RPC, wallet, key, provider, real-funds,
  real-asset or production action is authorised by this evidence.

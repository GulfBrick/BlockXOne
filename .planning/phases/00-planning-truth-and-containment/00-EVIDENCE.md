# Phase 0 Evidence

## Authoritative status

Phase 0 remains `in_progress`. Production-gate progress is 0 of 12 phases,
0 completed plans and 0 completed requirements. Release status is **NO-GO**.
The one permitted builder summary produces GSD artifact state `partial`/8
from 12 plans; that is filename-derived artifact metadata, not Phase, plan,
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
| I4 | `ff24f9d79f4a02e3cac054283140a2ed3226d5c5` | Preserved stopped-review input; aggregate PASS not accepted |
| P11 | `85964576707555b0b2ad3df6b297e1cb9a602d0a` | Accepted Plan 00-12 native-exit correction boundary |

P10 tree is `3a29405e95c106cfbbf23d7d2abaa5e9c2d955a3` and its parent
is exact V3. `V3..P10` is only `00-11-PLAN.md`. Its acceptance receipt has
SHA-256
`5363D742FAB0472A6874BE8ABD9649AB795D403223D57AEF1FA1BC11E71DC59A`.
P10 was ordinary-clean, ignored-aware-clean and remote-free and remains the
historical parent of I4. P11 is the only accepted parent for exact nine-file I5.

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

The runner never recursively deletes generated output. It validates every
lexical component root/source/destination chain as non-reparse before the
first move, creates a fresh absent quarantine beneath a validated OS temporary
root, requires same-volume no-overwrite moves, revalidates immediately before
each move and continues bounded cleanup after an individual error. The exact
20-entry inventory includes web and contract dependencies, caches, coverage,
build/artifact output, TypeChain output and `apps/web/next-env.d.ts`; nested
`node_modules/.vite` is preserved by its parent move and is not moved twice.

Quarantine is recoverability evidence, not cleanliness evidence. The final
release boundary runs the exact ignored-aware status command above and fails
on any output. Ordinary status alone is not sufficient.

The planning validator is read-only and exposes two explicit modes:

1. `BuilderStaged` rejects all status outside exact `A ` for the two new runner
   scripts and exact `M ` for the other seven Plan 00-12 Task 2 paths; and
2. `CleanCandidate` requires the exact ignored-aware status to be empty,
   including every tracked edit.

The validator never deletes or moves residue.

## Corrected planning artifact semantics

The exact Phase 0 plan filename set is `00-01-PLAN.md` through
`00-12-PLAN.md`. Disposable copies must prove:

- no recognized summary: GSD `planned`/0; and
- exactly one `00-04-SUMMARY.md`: GSD `partial`/8.

Both states retain STATE Phase 0 `in_progress`, 12 total plans, zero completed
plans/phases, ROADMAP Phase 0 unchecked and `In progress`, exactly 89 expected
unique unchecked requirements, and authoritative production progress 0%.

Mutation coverage must reject plan filename/count drift, summary
name/multiplicity/frontmatter/body drift, artifact progress other than 8,
STATE totals or completion drift, ROADMAP or requirement completion/drift,
tool/JSON/health errors and exact ignored `apps/web/next-env.d.ts` residue.
Removing only the disposable ignored fixture must restore the clean-state
pass, and repository originals must remain byte-identical.

The Plan 00-12 isolated suite passed both artifact-state positives, 8 semantic
mutations, 45 exact current-truth mutations, two ignored
`apps/web/next-env.d.ts` fail/delete-only restorations, one exact-nine
BuilderStaged positive and 12 staged-status negatives. It also passed 31
executable self-tests, two expected native exit-7 cases, 16 pin/input
negatives, nine version mutations and 13 AST/native-inventory mutations.
The Gosec semantic-output case accepts ANSI-colored zero and rejects colored
nonzero, absent, duplicate, negative, decimal, overflow, trailing, malformed
and misleading fields. Raw output is unchanged, 7-bit and C1 SGR are covered,
and colored zero cannot mask native exit 7. Removing normalization or weakening
exact-one/numeric-zero gates fails.
A hostile ambient Go 1.25.10 path still resolved and executed the pinned Go
1.26.5 leaf. An outer PATH-restoration mutation failed closed and retained the
primary native exit-7 diagnostic.
Real-repository tracked bytes and the pre-existing ordinary/ignored-aware
status were preserved.

The Sharp-repaired I5 runner contract added one Sharp argument-integrity
self-test and four Sharp-specific AST/executable weakening mutations. The test extracts the sole
JavaScript fence from exact-hash Plan 00-12 and proves it equals the runner's
single non-expandable here-string: 720 UTF-8 bytes, SHA-256
`99E0F57352403101C592D34B91591722B049C2C551698A2ED1F072031819F2B3`,
two backticks and six literal `${...}` tokens. Pinned Node receives that exact
argument. Interpolation, same-length byte drift, hash-gate weakening and
argument-vector weakening fail; a Sharp-looking PASS marker cannot mask native
exit 7.

The 2026-07-24 pre-freeze candidate run stopped before Sharp executed. Its
two-argument vector carried a 631-byte interpolated script, SHA-256
`37FE8506CB07DF0E94B487D6277173C0B69AD1C83808AF623BC560E3691CB560`,
with zero backticks and zero `${...}` tokens instead of the accepted Plan
literal. The durable stdout is 424,963 bytes, SHA-256
`83743AF4833E0593DCD7209A746FDAD0FABFB75FF5837EBBDD3D4C458DC723E8`;
stderr is 168 bytes, SHA-256
`4E0CF970CD6B216257795C21B3E0F4E04A3BD4D96DF18BD12C671BC626A2D347`.
This is fail-closed interpolation evidence only, not a Sharp/module result or
matrix PASS.

Exact candidate `93f5e8652354163a2f12ab6b88601e6cbaf35e0f` then ran the
accepted 720-byte script and emitted the exact Sharp marker at native exit
zero. The matrix stopped later at `web.unit.repo-root`: pinned Vitest exited
zero and reported ANSI-colored 3/3 files and 92/92 tests, but the generic raw
substring gate could not match across SGR bytes. Durable stdout is 443,168
bytes, SHA-256
`96B1F854E0ABCDC49777C599F0C5BAD167359A41602745A21D735C23D4234110`;
stderr is 117 bytes, SHA-256
`70330636AB2A07912C920723A08E81B5596F2A1F1BE456833074406D8EB76CA0`.
Cleanup reported no errors and quarantined only root npm cache plus web
`node_modules` at
`C:\Users\danie\AppData\Local\Temp\blockxone-phase0-matrix-9ae829790670425f8869d5eb3ba050d8`.
No later label or aggregate PASS is inferred.

The amended parser library now maps all 49 result-bearing production labels to
specialized exact parsers or zero-output gates and statically rejects removal
or weakening of every mapping. `go.test` alone remains native-zero-only because
`go.test.discovery` strictly parses its JSON stream. The isolated harness
covers 31 executable pass cases, two expected native exit-7 cases, 13
AST/native-inventory mutations, 49 semantic-mapping mutations, 16 pin/input
negatives, 9 tool-version mutations, 18 internal parser-weakening mutations and
13 top-level orchestration/order mutations.
Parser-family positives cover both
7-bit ESC and C1 SGR without mutating raw `Text` or `Output`; malformed
non-SGR controls remain visible and fail. Exact label/match multiplicity,
ASCII/invariant `UInt64`, overflow rejection and family-specific adverse
fields reject duplicate, conflicting, signed, decimal, grouped, scientific,
Unicode, skipped/pending/failing and count-inflation evidence. Strict Go
discovery requires 357 unique pass identities across the exact ordinal
12-package tested set, exact unique package-pass terminals and a disjoint exact
13-package no-test set. Every no-test package must complete its own exact
start/output/skip state machine while unrelated package events may interleave.
The pinned-Go raw property order and exact
`?   <TAB>package<TAB>[no test files]<LF>` output are mandatory. Skip `Elapsed`
uses unsigned plain-decimal JSON (including `0.0`, excluding signs/exponents),
must parse to a finite nonnegative `double`, and is capped at native command
wall time plus 250 ms. Duplicate/case-colliding keys, wrong order, unknown
properties/actions, non-finite/overflow elapsed values, every fail, every
test-level skip and any missing/extra/duplicate/post-terminal/malformed/
overlapping package evidence fail closed. The exact 39-record fixture and its
observed index list are independently hash-bound; it is embedded with 1,559
explicitly synthetic tested-package events in the 1,598-event representative
stream. The self-test captures and asserts the production parser's sole
elapsed classification line.

Run43 under `i5-full-matrix-8c20d866-run43-20260724` reached native-zero
`web.lint` and stopped at the exact lint parser. Its stdout was 449,954 bytes,
SHA-256
`3368C0F60999C3B3608A97BC68BEC88D24CFA96FDEBFE214991E3D46F352C643`;
stderr was 130 bytes, SHA-256
`3AA189F2F7B27187B26EDF74C101BF4A36E295FBC04406D6F8104C279BF0C73E`;
exit receipt SHA-256 was
`F59A3A8103888BD6AAA891C3481DEF5435B8BD9FB3A63B1140B0953B6511FDBA`.
Run44c decoded the final item as `Γ£ö No ESLint warnings or errors`
(U+0393/U+00A3/U+00F6), proving the UTF-8 U+2714 bytes had crossed CP437; its
diagnostic SHA-256 is
`89B2183D30FC86B67EBF714C6C181E87FB056CA35141BC6239811CAA89FB0074`.
Exact cleanup passed. Exception fallback was rejected after malformed byte
`0x80` hung under PowerShell 7.6.3; replacement fallback plus pre-log U+FFFD/
U+FEFF rejection is the bounded final contract. Runs43/44c are failure and
diagnostic evidence only; later labels and an aggregate PASS remain unproven.

The frozen runner/test SHA-256 values are
`C08FD0D7F1B9A02296BEF242436F9716C10FC73D8427ED4B6F8251382819FEB0`
and
`584085BE6F54E75E607B4B5932C024103398048E0F0F157D54087E99E10A2C18`.
Run50 passed the isolated aggregate with stdout SHA-256
`4BC879F5B55A15ABA78CDB973E28F8710DC74F1C83F5EC61C95450CB26C5B1DF`
and `exit-receipt.json` SHA-256
`9EE7CC161CB1D314D3507BC17CD2DA3E89AC2A619E29992FBAA7B4BD08A6CE40`;
its `exit.txt` SHA-256 is
`9A271F2A916B0B6EE6CECB2426F0B3206EF074578BE55D9BC94F6F3FE3AB86AA`.
It proves 31 executable pass cases/two expected failures, bounded tree kill,
the `437,65001,437,437` child sequence, malformed-byte rejection, 2 static/4
executable evidence mutations and 4 encoding-boundary mutations.

Exactly two authorized clean-fixture web-path repetitions then passed all eight
commands through lint. Run51a fixture
`814e55ce8a84d96db25978314a9820ce33cc9120` and run51b fixture
`610976f06ead2a450886e7ad2cf5cba78fd9f230` share tree
`7ba74fe740cf371c7ef42841299ccebd00d21dc9`. Both exact raw 19-line lint
transcripts ended in literal U+2714/E29C94 with no SGR/control/mojibake/U+FFFD/
BOM; encoding restoration, five-item quarantine and final clean status passed.
Their repetition-receipt SHA-256 values are
`401475F8DFE02B2F44A8B1E54D706C60EDD3597665E3F3380E512BCEEDE9874B`
and
`DF4E374F6B8EDEC5AC591516034D03551905A14EFA22E0749DD93C01D59D093D`.
Independent encoding-scope review passed both receipts and the frozen bytes.
Run50 and runs51a/51b are isolated runner-test/web-path evidence only, not R5,
a fresh complete matrix or release approval.

Run57 under
`C:\Users\danie\Documents\BlockXOne Phase0 Recovery 20260719\clean-root-20260720\generation-3-20260721\i5-full-matrix-457fb88-run57-20260724`
tested exact commit `457fb88e57c46d6a42add68b6fe96892e7e377b9`.
The runner aggregate passed, followed by planning, artifact, CI, Compose,
actionlint, module verification and native Go tests. Native
`go.test.discovery` also exited zero, but the semantic parser stopped fail
closed because its obsolete raw-zero skip shape rejected valid `Elapsed:
0.001` for `blockxone/cmd/migrate` and `blockxone/internal/chainlog`; the
other 11 no-test packages emitted `0`. The exact 1,598 raw JSON payloads,
LF-joined without a final LF, have SHA-256
`FE88A21AAE71739E977CC95D9B28C8A64A2DD56000046634E699C9F5BF6754EB`.
The exact 39 no-test records, preserving observed global indices and
per-package ordering, have SHA-256
`A51EFCE53E6B68BD6E88E5E4D89DCC1C625DFCD808A06D513E0AD04D1260DD88`.
Matrix stdout was 400,541 bytes, SHA-256
`FA68675A1C98C37DCA6201345F2CF013185E955C1D27D5EBB37AA3378F13C089`;
stderr was 126 bytes, SHA-256
`99DBFB293332EE3F1B466EA48AB08B07674CE3A3AD8F340056089F11791DBA7A`;
and the exit-receipt SHA-256 was
`48E661A5335469494B622A15EBAFD25E4073A6159ED53978D5C1D2EA65379348`.
Cleanup reported none and quarantine root
`C:\Users\danie\AppData\Local\Temp\blockxone-phase0-matrix-0822ba557eef494bb915fc6ccfde14e1`
was retained. Pre/post repository state matched, ordinary and ignored-aware
status were empty and remotes were absent. Later labels did not run. Run57 is
failure evidence only, not a matrix PASS, R5, V5, C5 or release approval.

Run58 under `i5-go-discovery-aggregate-run58-20260724` used the pre-run58
runner/test hashes
`F19734C253547834021544FF39F42FF4AA27BE5D57FD3D7FD547B8E9479CA421` /
`B719FEACE655CA8C5BFA1A1E05F4FECB6C33F81CE5ADB9254560ADE8863A46B8`
and stopped fail closed at exit 1 after 224,387 ms. The deliberately weakened
elapsed grammar first accepted ordered signed zero, but the mutation harness
expected the later exponent case. Stdout was 2,196 bytes, SHA-256
`CF4BC20F16DCE8AB7CD68005EB4D20126A2C0DF7906722EA36CDDDD74C89B982`;
stderr was 878 bytes, SHA-256
`C30F3DCF2962129891BCFCAF90562D357436DBDBEA90BA7EF57CA84371125A1F`;
the exit-receipt SHA-256 was
`A0D9F4661F1F6329E108CD5CD7BA36235AFBE57B8747A0909CC3BE9E9BB154BA`.
Repository pre/post state was exactly equal. This immutable failure receipt is
not an aggregate PASS.

The repaired runner SHA-256 is
`F19734C253547834021544FF39F42FF4AA27BE5D57FD3D7FD547B8E9479CA421`;
the repaired isolated test SHA-256 is
`37BCCFBA90997B77577D01E2F3E35621C48E85CD1C568FC23B5982C1E6F3C13C`.
A dedicated read-only Go-discovery reviewer passed those exact bytes. The
isolated case exited zero and bound 39 adversarial negatives, exact record and
index hashes, 1,559 explicitly synthetic tested events within the 1,598-event
representative stream, production-parser elapsed classification
`11/2/0.001/6.728`, and raw preservation. This is scoped parser-repair evidence
only. Exact-byte re-review proved reverse substitution reconstructs the
pre-run58 test hash and mutation order places signed zero before exponent. The
tracked pre-freeze bytes intentionally do not claim any later identity-bound
no-edit aggregate or amended-I5 matrix; post-freeze results belong only in the
external Task6 receipt. R5/V5/C5 remain required at this boundary.

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

The ignored-path omission and native-exit masking mean the old aggregate
matrices cannot establish a release-clean candidate. Exact I5 must reproduce
the complete fail-closed contract before distinct R5 and V5 roles can review
and verify it.

## Evidence still required

- Exact nine-file I5 with P11 as parent and external
  `TASK6-I5-BUILDER-RECEIPT.md`.
- Exact-I5 full fail-closed matrix, mutations, bytecode reproduction, ordinary and
  ignored-aware final cleanliness and zero remotes.
- Exact-I5 adversarial review by the distinct Task 3 reviewer, producing R5.
- Exact-R5 independent verification by the distinct Task 4 verifier,
  producing V5.
- Exact-V5 local-only admission by the distinct Task 5 owner, producing
  external C5 evidence without a Git change.
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

## Plan 00-12 current-truth boundary

I4's aggregate matrix PASS is not accepted because mandatory native exits were maskable.

I4's individual command and mutation outputs remain narrow historical evidence only.

The attempted R4 produced only SECURITY-REVIEW-FAILURE-RECEIPT-v4.md; no R4, V4 or C4 exists.

The six recoverably moved .git/objects files were repository-metadata mutations, not tracked working-tree edits.

The v4 failure receipt SHA-256 is 0D9B3DF8697646FBB4747BD12B3521DA39E898C286593809CF9C3492176DD7B5.

P11 is 85964576707555b0b2ad3df6b297e1cb9a602d0a with Plan 00-12 SHA-256 A702B1F506E23FDF475702A76CB30041F295485DFE1BC922D00B19ADC0B439AC.

The Plan 00-12 task paths /root, /root/gen3_plan12_checker, /root/gen3_i5_builder, /root/gen3_r5_security_reviewer, /root/gen3_v5_verifier and /root/gen3_c5_admission_owner are pairwise distinct workflow provenance, not legal-person or professional independence.

Typed roots: TEST_CONTRACT_NATIVE_EXIT_MASKING, EVIDENCE_PROVENANCE_PATH_TRANSCRIPTION_ERROR, GENERATED_OUTPUT_ANCESTOR_REPARSE_ESCAPE, AGENT_ROLE_PROVENANCE_OMISSION and EVIDENCE_SCOPE_WORDING_OVERSTATEMENT.

Phase 0 remains in_progress, production completion remains zero, and release remains NO-GO.

### Corrected retained I4 mutation provenance

The I4 receipt's four paths under
`C:\Users\danie\AppData\Local\Temp\blockxone-i4-matrix-9775e9f3256e4c8083be6af95e10c968`
are absent transcription errors. The retained directories are:

| Correct retained directory | Cases |
| --- | ---: |
| `C:\Users\danie\AppData\Local\Temp\blockxone-i4-staged-fixtures-be2445c0c6104e9ba79742e0e328d192\mutations-no-summary-final-045661aff3334d7d9581536d0bfbbf4e` | 39 |
| `C:\Users\danie\AppData\Local\Temp\blockxone-i4-staged-fixtures-be2445c0c6104e9ba79742e0e328d192\mutations-summary-final-f8461c82d4204007a4a76a084d9a846a` | 53 |
| `C:\Users\danie\AppData\Local\Temp\blockxone-i4-staged-fixtures-be2445c0c6104e9ba79742e0e328d192\mutations-exact-i4-post-quarantine-e321d48a9f8f4a2eb60d713796a7da68` | 53 |
| `C:\Users\danie\AppData\Local\Temp\blockxone-i4-staged-fixtures-be2445c0c6104e9ba79742e0e328d192\mutations-post-i4-no-summary-f86f20d970e74728ae0a01e27a6ef1d9` | 39 |

The eight retained log bindings are:

| Log | Bytes | SHA-256 |
| --- | ---: | --- |
| `primary staged root\summary-final.out.log` | 5,749 | `5466E74BB4AA48BB27639C004B83E0B9CD8E8352A09C4E81727B11C69413331C` |
| `primary staged root\summary-final.err.log` | 807,798 | `94868F441AD8F74341998FE23364C62C8664F9E6C74A99A96691EFF727EFD5ED` |
| `primary staged root\no-summary-final.out.log` | 4,223 | `6DD7DE49449FAAE73AA25DF023CF8A4DB162D583C0FF3F13E974A61A097E300A` |
| `primary staged root\no-summary-final.err.log` | 588,179 | `365835159495F68FF2C987703857F57EB835DAD8CDC61D932D488495314F6196` |
| `matrix root\exact-i4-mutations.out.log` | 5,782 | `EC46276750685830F7B43226156DFDD1302A2CACB7C8DB8ABDCD7BB23AC2F77F` |
| `matrix root\exact-i4-mutations.err.log` | 807,798 | `94868F441AD8F74341998FE23364C62C8664F9E6C74A99A96691EFF727EFD5ED` |
| `matrix root\post-i4-no-summary-mutations.out.log` | 4,229 | `7A3EAFA8BB95E61E8D7B58D11C882AECE5DEE1256FB82258AF5E0A272CD3FA62` |
| `matrix root\post-i4-no-summary-mutations.err.log` | 588,179 | `365835159495F68FF2C987703857F57EB835DAD8CDC61D932D488495314F6196` |

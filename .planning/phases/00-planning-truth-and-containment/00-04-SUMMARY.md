---
phase: 00-planning-truth-and-containment
plan: 04
status: implementation_frozen_for_independent_review
release_status: NO-GO
requirements-completed: []
---

# Generation 3 Fail-Closed I5 Builder Freeze

Phase 0 remains `in_progress`.

This is builder evidence only.

Tasks 3-5 remain mandatory.

This is not independent review, verification, Phase completion, requirement completion, local candidate admission, or production approval.

V3 is preserved but was not admitted as C3.

The stale broad generated-cleanliness conclusions are superseded.

## Corrected freeze scope

The containing commit I5 is limited to the nine Plan 00-12 Task 2
paths:

1. `.planning/TEST-CONTRACT.md`
2. `.planning/scripts/invoke-phase0-matrix.ps1`
3. `.planning/scripts/test-phase0-matrix-runner.ps1`
4. `.planning/scripts/validate-planning.ps1`
5. `.planning/BLOCKERS.md`
6. `.planning/EVIDENCE-REGISTER.md`
7. `.planning/STATE.md`
8. `.planning/phases/00-planning-truth-and-containment/00-04-SUMMARY.md`
9. `.planning/phases/00-planning-truth-and-containment/00-EVIDENCE.md`

ROADMAP, REQUIREMENTS, Plans 00-01 through 00-12, application source, tests,
packages, contracts, CI, Compose, SECURITY-REVIEW and VERIFICATION are
immutable at I4. I4's exact commit/tree and post-commit reproduction are
recorded externally in `TASK6-I4-BUILDER-RECEIPT.md`; this summary does not
self-assert a future commit identity.

## Accepted boundary before I4

- Preserved builder freeze I3:
  `6ba1d29cbf5e7a3cc805a96ec942364dde2497b9`
- Preserved adversarial review R3:
  `4b1eb982d1fefa2aed07d15b690480da0707a32a`
- Preserved, unadmitted verification V3:
  `37abb9517f86c79b541209bed66f622fae153b7f`
- Accepted correction plan P10:
  `76c8c7d07da2d7c13c7f57ce77a29bcd4615cd5f`
- P10 tree:
  `3a29405e95c106cfbbf23d7d2abaa5e9c2d955a3`
- P10 parent: exact V3
- P10 acceptance receipt SHA-256:
  `5363D742FAB0472A6874BE8ABD9649AB795D403223D57AEF1FA1BC11E71DC59A`

P10 is remote-free and clean under both ordinary and ignored-aware status. It
changes only Plan 00-11. It is not I4, C4 or production approval.

## V3 admission stop and narrow supersession

At exact V3, the distinct Task 9 owner ran the ignored-aware precondition and
observed `!! apps/web/next-env.d.ts`. The untracked ignored file was 268 bytes
with SHA-256
`F4E8976C19FC926644D72610BF1058BD6BF52ADD97E46A02BC0B912A751625C0`.
No Task 9 matrix, scanner or manifest ran after that failure. C3 was never
created.

The failure receipt has SHA-256
`83FA91B1EAB7492D5BB5E6DD8FB326CEC477DD068793C2394060C9BFAD908259`.
The file was moved without overwrite to the recoverable destination:

`C:\Users\danie\AppData\Local\Temp\blockxone-gen3-v3-next-env-f4e8044a037a4db7805c4dad546d0e99\apps-web-next-env.d.ts`

The I3, R3 and V3 commits and their old external receipts remain immutable.
Only their broad generated-cleanliness conclusion is superseded. Their
recorded Git identities, topology checks, command results, scanner results and
warnings remain bounded historical evidence, not C3 admission.

## Corrected release-cleanliness contract

Known generated web and contract dependencies, build output, caches, coverage,
TypeChain output and `apps/web/next-env.d.ts` are moved only by literal,
no-overwrite operations to distinct destinations beneath a fresh resolved
OS-temporary quarantine. A quarantine inventory proves recoverability only.

A clean-candidate assertion requires the exact command
`git status --porcelain=v1 --untracked-files=all --ignored=matching` to return
no output. Ordinary `git status` is not sufficient because ignored residue can
be omitted. The planning validator is read-only:

- `BuilderStaged` permits exactly two index-added scripts and seven
  index-modified documentation/validator paths, and rejects every other status,
  ordinary untracked or ignored entry; and
- `CleanCandidate` rejects every tracked, untracked or ignored entry.

The validator never moves, deletes or cleans residue.

## Corrected artifact semantics

Plan 00-12 raises the exact Phase 0 plan set to 12. With no recognized summary,
the disposable planning state is `planned`/0. With this one exact
`00-04-SUMMARY.md`, the GSD artifact state is `partial`/8.

That ratio is filename-derived GSD artifact metadata, not completion.
Authoritative production state remains:

- Phase 0 `in_progress`;
- 0 of 12 phases complete;
- 0 of 12 plans complete;
- all 89 requirements unchecked;
- ROADMAP Phase 0 unchecked and `In progress`; and
- release status NO-GO.

The Plan 00-12 isolated suite passed `partial`/8 and `planned`/0 positives,
8 semantic mutations, 45 current-truth mutations, two ignored
`apps/web/next-env.d.ts` fail/delete-only restorations, one exact-nine
BuilderStaged positive and 12 status-class negatives. It also passed 31
executable self-tests, two expected native exit-7 cases, 16 pin/input
negatives, nine tool-version mutations and 13 runner-AST/native-inventory
mutations. The
Gosec semantic-output case accepts ANSI-colored zero while rejecting colored
nonzero, absent, duplicate, negative, decimal, overflow, trailing, malformed
and misleading fields. It preserves raw output, covers 7-bit and C1 SGR, and
proves colored zero cannot mask native exit 7. Removing normalization or
weakening exact-one/numeric-zero gates are executable failure mutations. A
hostile ambient Go 1.25.10 path still resolved and executed the pinned Go
1.26.5 leaf, and an outer PATH-restoration mutation failed closed while
preserving the primary native exit-7 diagnostic.
Repository bytes and pre-existing status were preserved.

The Sharp-repaired I5 runner contract independently extracts the sole
JavaScript fence from exact-hash Plan 00-12 and binds `web.sharp-smoke` to its
720 UTF-8 bytes, SHA-256
`99E0F57352403101C592D34B91591722B049C2C551698A2ED1F072031819F2B3`,
two backticks and six literal `${...}` tokens. Pinned Node confirms the exact
PowerShell argument bytes. Expandable-here-string, literal-byte, hash-gate and
argument-vector mutations fail, and a Sharp-looking PASS line followed by
native exit 7 remains a failure.

A 2026-07-24 pre-freeze candidate matrix stopped fail closed at this label
before Sharp executed. Its two-argument vector contained a 631-byte
PowerShell-interpolated script, SHA-256
`37FE8506CB07DF0E94B487D6277173C0B69AD1C83808AF623BC560E3691CB560`,
with zero backticks/zero `${...}` tokens, rather than the accepted Plan bytes.
That result is interpolation-failure evidence only, not a Sharp/module result
or a matrix PASS.

Exact candidate `93f5e8652354163a2f12ab6b88601e6cbaf35e0f` then proved
the repaired 720-byte Sharp invocation and exact marker at native exit zero.
Its matrix stopped at `web.unit.repo-root` after Vitest itself exited zero and
reported ANSI-colored 3/3 files and 92/92 tests. The generic raw substring gate
could not match across SGR bytes. Durable stdout was 443,168 bytes, SHA-256
`96B1F854E0ABCDC49777C599F0C5BAD167359A41602745A21D735C23D4234110`;
stderr was 117 bytes, SHA-256
`70330636AB2A07912C920723A08E81B5596F2A1F1BE456833074406D8EB76CA0`.
Cleanup had no errors and quarantined only root npm cache plus web
`node_modules`. Later labels were not executed, so this is semantic-parser
failure evidence only.

The amended I5 contract removes the generic existence matcher and statically
binds all 49 result-bearing labels to specialized exact parsers or zero-output
gates; `go.test` remains native-zero-only because the next label owns strict
JSON discovery. Its adversarial surface now covers 31 executable pass cases,
two expected native exit-7 cases, 13 AST/native-inventory mutations,
49 label-to-parser removal/weakening mutations, 16 pinned-input negatives, 9
tool-identity mutations, 18 internal parser-weakening mutations and 13
top-level orchestration/order mutations.
Human-formatted parsers preserve raw output and
strip only bounded 7-bit/C1 SGR from local copies; all fields are anchored,
exact-multiplicity and invariant/overflow checked. TAP, Vitest, npm audit,
Next, Hardhat, Go discovery and scanner families reject duplicate,
conflicting, malformed, Unicode, overflow, test-level skipped/pending and
false-marker evidence. Go discovery also binds the exact 12 tested-package
terminal set and the disjoint exact 13-package `[no test files]` per-package
start/output/skip state machines while permitting global interleaving. Its
pinned-Go raw action schemas/order and exact output are hash-bound by the 39
run57 no-test records and their observed indices. The self-test embeds those
records with 1,559 explicitly synthetic tested events, captures the production
parser classification, and verifies its elapsed zero/nonzero/max/bound fields.
Unsigned plain-decimal `Elapsed` accepts `0.0`, requires finite nonnegative
`TryGetDouble`, and is capped at native wall time plus 250 ms. A valid-looking
semantic summary still cannot mask native exit 7.

Run43 under `i5-full-matrix-8c20d866-run43-20260724` reached native-zero
`web.lint` and then stopped fail closed because UTF-8 U+2714 was decoded
through CP437. Its stdout SHA-256 was
`3368C0F60999C3B3608A97BC68BEC88D24CFA96FDEBFE214991E3D46F352C643`;
later labels did not run. Run44c reproduced the final lint item as
`Γ£ö No ESLint warnings or errors` with code points
U+0393/U+00A3/U+00F6 and produced diagnostic SHA-256
`89B2183D30FC86B67EBF714C6C181E87FB056CA35141BC6239811CAA89FB0074`.
Exception fallback was rejected after malformed byte `0x80` hung; the final
boundary uses BOM-less replacement-fallback UTF-8 and rejects U+FFFD/U+FEFF
before logging/parsing. These are failure/diagnostic results only.

The frozen runner/test hashes are
`C08FD0D7F1B9A02296BEF242436F9716C10FC73D8427ED4B6F8251382819FEB0`
and
`584085BE6F54E75E607B4B5932C024103398048E0F0F157D54087E99E10A2C18`.
Run50 passed their isolated runner-test aggregate; its stdout SHA-256 is
`4BC879F5B55A15ABA78CDB973E28F8710DC74F1C83F5EC61C95450CB26C5B1DF`.
Runs51a/51b then passed exactly two authorized clean-fixture eight-command web
paths through the exact 19-line lint transcript with literal U+2714/E29C94,
exact encoding restoration and cleanup. Their receipt SHA-256 values are
`401475F8DFE02B2F44A8B1E54D706C60EDD3597665E3F3380E512BCEEDE9874B`
and
`DF4E374F6B8EDEC5AC591516034D03551905A14EFA22E0749DD93C01D59D093D`.
Independent encoding-scope review passed the frozen bytes and both receipts.
Run50 and runs51a/51b prove only the isolated runner-test and web path, not R5,
the complete matrix or release approval.

Run57 under
`i5-full-matrix-457fb88-run57-20260724` tested exact commit
`457fb88e57c46d6a42add68b6fe96892e7e377b9`. It passed the isolated runner
aggregate and all matrix labels through native-zero `go.test.discovery`, then
the semantic parser stopped fail closed because it still required raw
`Elapsed: 0`. Go 1.26.5 emitted `Elapsed: 0.001` for
`blockxone/cmd/migrate` and `blockxone/internal/chainlog`, and `0` for the
other 11 no-test packages. The exact 1,598 LF-joined JSON payloads (no final
LF) hash to
`FE88A21AAE71739E977CC95D9B28C8A64A2DD56000046634E699C9F5BF6754EB`;
their 39 no-test records hash to
`A51EFCE53E6B68BD6E88E5E4D89DCC1C625DFCD808A06D513E0AD04D1260DD88`.
Stdout/stderr/exit-receipt SHA-256 values are
`FA68675A1C98C37DCA6201345F2CF013185E955C1D27D5EBB37AA3378F13C089`,
`99DBFB293332EE3F1B466EA48AB08B07674CE3A3AD8F340056089F11791DBA7A`
and
`48E661A5335469494B622A15EBAFD25E4073A6159ED53978D5C1D2EA65379348`.
Cleanup reported none, pre/post repository state matched, ordinary and
ignored-aware status were empty and remotes remained absent. Later labels did
not run. Run57 is failure evidence only, not a matrix PASS or R5.

Run58 under `i5-go-discovery-aggregate-run58-20260724` tested the pre-run58
runner/test hashes
`F19734C253547834021544FF39F42FF4AA27BE5D57FD3D7FD547B8E9479CA421`
and
`B719FEACE655CA8C5BFA1A1E05F4FECB6C33F81CE5ADB9254560ADE8863A46B8`.
It stopped fail closed after 224,387 ms because its deliberately weakened
elapsed grammar first accepted ordered signed zero while the harness expected
the later exponent case. Stdout/stderr/exit-receipt SHA-256 values are
`CF4BC20F16DCE8AB7CD68005EB4D20126A2C0DF7906722EA36CDDDD74C89B982`,
`C30F3DCF2962129891BCFCAF90562D357436DBDBEA90BA7EF57CA84371125A1F`
and
`A0D9F4661F1F6329E108CD5CD7BA36235AFBE57B8747A0909CC3BE9E9BB154BA`.
Repository pre/post state was exactly equal. This is a test-contract failure
receipt, not an aggregate PASS.

The repaired runner/test SHA-256 values are
`F19734C253547834021544FF39F42FF4AA27BE5D57FD3D7FD547B8E9479CA421`
and
`37BCCFBA90997B77577D01E2F3E35621C48E85CD1C568FC23B5982C1E6F3C13C`.
A dedicated read-only Go-discovery reviewer passed those exact bytes after the
isolated case exited zero with 39 adversarial negatives, exact record/index
hashes, explicit 1,559-synthetic/1,598-representative labeling, production
parser classification `elapsed_zero=11`, `elapsed_nonzero=2`,
`elapsed_max=0.001`, `elapsed_bound_seconds=6.728`, and raw preservation. This
exact-byte re-review also proved that reverse substitution reconstructs
pre-run58 `B719FE...A46B8` and that signed zero precedes exponent in the ordered
mutations. This is scoped repair review only, not the runner aggregate, matrix
or R5.

The exact-I5 post-commit matrix and independent reruns must be bound externally
in `TASK6-I5-BUILDER-RECEIPT.md` only after they pass; no receipt or pass is
claimed by this pre-freeze summary. Any failed mutation, ignored-residue escape,
extra path or matrix failure is a hard stop before I5 handoff.

## Retained warnings and NO-GO boundary

Prior local matrices retained upstream npm deprecation notices, the Next lint
migration notice, stale Browserslist data and Solidity declaration/unused
parameter warnings. Docker image builds and provenance, Linux race, hosted
migrations and full hosted CI remain outstanding.

Identity and governed issuance containment does not close G5, authoritative
conformance, governance, network or provider decisions, professional review
or external retest. Repository-incident, financial-integrity, provider,
resilience, legal, accounting, tax, privacy, penetration, smart-contract audit
and human Phase 0 gates remain open.

Exact I5 must pass the fail-closed full matrix and external builder receipt.
Then distinct Task 3, Task 4 and Task 5 owners must create R5, V5 and local-only
C5 in order. No remote, deployment, RPC, wallet, signing key, funds, real
assets, production configuration or irreversible production action is
authorised by this evidence.

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

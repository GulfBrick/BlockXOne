# Blocker Register

Current blocker authority follows `.planning/CHECKPOINTED-DELIVERY-PLAN.md` in
`work/blockxone-functional` on `codex/functional-platform`. Production is
NO-GO. Generation 2, Generation 3 and controlled-loop blocker narratives are
retained below as non-authoritative historical evidence only.

| ID | Blocker | Severity | Status | Blocks | Owner | Exit evidence |
| --- | --- | --- | --- | --- | --- | --- |
| BLK-001 | P0-A exact clean candidate not admitted by successful hosted CI | P0 | Open. R-01 baseline `d4f3ccc442871c590cc39ec7967e0bca53739739` is published, but the exact clean-candidate success receipt remains pending | P0-A | Integrator and independent technical reviewers | Exact candidate passes local proof and one named hosted `CI` run with nonzero mandatory successful jobs; candidate/branch/run SHA equality proven; GitHub `main` unchanged |
| BLK-002 | South African private debt perimeter not professionally approved | P0 for G1 | Open. This is an accepted technical planning default only | G1/Phase 1 | Legal/Product/Controller | Signed G1 decision pack covering instrument, issuer/SPV, investor class, ZAR, licensing, register, tax/accounting, custody/client-money non-custody model and exclusions |
| BLK-003 | Frontend had no automated tests | P0 | Locally remediated in the functional repository; earlier I4/I5-family outputs are historical only; exact-current-candidate hosted reproduction remains pending | P0-A evidence | Frontend/QA | P0-A exact candidate and hosted CI retain nonzero current suites and fail-closed containment |
| BLK-004 | Production Compose was invalid | P0 | Locally remediated in the functional repository; earlier I4/I5-family outputs are historical only; current image, migration and hosted evidence remain open | P0-A evidence | Platform/SRE | P0-A exact-candidate Compose, hosted images and clean/current migration evidence |
| BLK-005 | CI/deploy/security paths contained false-success behavior | P0 | Static containment implemented; hosted mutation evidence pending | Phase 0/Release | Platform/CISO | Hosted CI failure propagation plus blocked deploy/rollback evidence |
| BLK-006 | Mock/default/raw-key production risks | P0 | Startup/config containment implemented; providers and signer deliberately unimplemented | Phase 0/Phases 4-5 | CTO/CISO | Exact-commit negative tests, then G4/G5 implementations |
| BLK-007 | No production-grade ledger/reservation/reconciliation | P0 | Open | G3 | Controller/Backend | G3 passed |
| BLK-008 | Compliance/payment/custody provider certification absent | P0 | Open | G4 | MLRO/Treasury/Custody | G4 passed |
| BLK-009 | Contract conformance, identity and privileged-operation gaps | P0 | Open. T-REX 4.1.3 is a licence-contingent technical reference only; historical Generation 3 containment is not current-candidate conformance or G5 evidence | G5A/G5B | Blockchain/CISO/Legal | Exact candidate freeze, proprietary licence, signed G5 decision pack, authoritative conformance, external audit, remediation and auditor retest |
| BLK-010 | External assurance not completed | P0 | Open | Phase 9/Production | CISO/Legal/Controller | Phase 9 passed |
| BLK-011 | Tracked ZIP containing `.env.local` path and generated binaries are reachable from quarantined old ancestry | P0 | Open; historical Generation 2 clean-lineage work is evidence only, while credential, old-host/cache/fork/clone and formal incident closure remain pending | Phase 0 and every remote action | Repository owner together with Security, credential and Legal/Privacy owners | Signed rotation assessment, formal incident decision and complete hosted/distribution closure evidence |
| BLK-012 | Contract dev-tool audit reported 7 high, 1 moderate and 1 low findings | P0 | Locally remediated in narrow historical evidence; P0-A exact-current-candidate hosted reproduction plus upstream replacement tracking remain pending | BASE-06/CI images | Blockchain/Platform/CISO | P0-A exact candidate and hosted CI prove install, compile/type generation, typecheck, nonzero tests and zero full audit; upstream override-removal tracking recorded |
| BLK-013 | Docker image builds/provenance, Linux race tests and clean/current migration smoke not reproduced | P0 | Open; workflow gates defined locally | BASE-06/Phase 0 | Platform/SRE | Exact-clean-commit hosted CI, migrations and immutable image evidence |
| BLK-014 | Production claim policy, canonical compliance modules, actual multisig, compiler provenance and target EVM network are unapproved | P0 for G5 | Open. Polygon PoS chain 137 and Amoy are accepted planning targets only; no production-network, governance or claim-policy approval is inferred | G5A/G5B/Production | Legal/Registrar/MLRO/CISO/Blockchain/Custody/Risk | Signed G5 decision pack, reproducible compiler evidence, approved network/governance manifests, exact candidate freeze, external audit and retest |
| BLK-015 | Historical Generation 3 evidence/native-exit contract was incomplete | Historical P0 | Non-authoritative historical blocker; not an instruction to resume I5/R5/V5/C5 and not current delivery admission evidence | Historical Generation 3 lineage only | Historical task roles | Retained immutable historical receipts; current admission is governed only by P0-A |
| BLK-016 | Prior hosted workflow did not start a valid CI job set | P0 | Open. Run `30159010530` was `BuildFailed` / `startup_failure`, had a blank workflow name and zero jobs | P0-A | Platform/integrator | A later exact-candidate run has workflow name `CI`, overall `success`, nonzero mandatory jobs, every mandatory job succeeds, and its head SHA equals the local/remote candidate |
| BLK-017 | Accepted technical defaults lack professional gate approval | P0 for release | Open. South African private debt, ZAR, AWS `af-south-1`, Polygon 137/Amoy, PostgreSQL-native workflow, two-track demo/production, non-custody, no release-one secondary market and T-REX 4.1.3 reference are planning defaults only | G1/G2/G3/G5 | Named Legal, Finance, Accounting, Tax, MLRO, CISO, Custody, Blockchain, Risk, Architecture and external-audit owners | Signed gate packs and exact-release evidence; no agent text substitutes |
| BLK-018 | Web and contract dependency trees contain high-severity `brace-expansion` DoS advisory `GHSA-mh99-v99m-4gvg` | P0 | Open. On 2026-07-25 the mandatory web audit reported 14 high findings and the contract audit reported 8 high findings; the GitHub-reviewed advisory affects all releases through 5.0.7 and names 5.0.8 as the only patched release. The gate remains fail-closed | P0-A hosted CI and every release | Platform, Web, Blockchain and CISO dependency owners | Explicitly accepted narrow dependency-remediation scope; lockfile proof resolves every `brace-expansion` node to a compatible patched path; clean installs, audit, lint/build/typecheck/compile/tests and hosted CI all pass without lowering severity |

No production implementation phase may bypass its upstream blocker.

The detailed Generation 3 evidence below is preserved to avoid rewriting the
historical record. It is non-authoritative and must not be executed as a current
repair loop.

The 2026-07-24 pre-freeze candidate matrix stopped at `web.sharp-smoke`
before any Sharp code executed. PowerShell preserved the two-argument vector
but changed the planned script from 720 UTF-8 bytes, SHA-256
`99E0F57352403101C592D34B91591722B049C2C551698A2ED1F072031819F2B3`,
two backticks and six `${...}` tokens to 631 bytes, SHA-256
`37FE8506CB07DF0E94B487D6277173C0B69AD1C83808AF623BC560E3691CB560`,
zero backticks and zero `${...}` tokens. This was a fail-closed interpolation
defect, not a Sharp/module result or matrix PASS. Exact-I5 post-commit
reproduction remains part of BLK-015 exit evidence.

Exact candidate `93f5e8652354163a2f12ab6b88601e6cbaf35e0f`
proved the repaired Sharp boundary: the exact 720-byte Plan script produced the
sole required Sharp marker and native exit zero. The same 2026-07-24 matrix
then stopped at `web.unit.repo-root` even though pinned Vitest exited zero and
reported 3/3 files and 92/92 tests. ANSI SGR bytes split the human-formatted
summary, while the generic raw substring matcher did not parse a normalized
copy. Stdout was 443,168 bytes, SHA-256
`96B1F854E0ABCDC49777C599F0C5BAD167359A41602745A21D735C23D4234110`;
stderr was 117 bytes, SHA-256
`70330636AB2A07912C920723A08E81B5596F2A1F1BE456833074406D8EB76CA0`.
Cleanup reported none and quarantined only the root npm cache and web
`node_modules` under
`C:\Users\danie\AppData\Local\Temp\blockxone-phase0-matrix-9ae829790670425f8869d5eb3ba050d8`.
This is fail-closed semantic-parser failure evidence, not an accepted unit
result, full matrix PASS or evidence for any later label. BLK-015 still
requires a fresh full run over the final amended I5 bytes.

The subsequent pre-amend run43 under
`i5-full-matrix-8c20d866-run43-20260724` reached `web.lint`: pinned lint
returned native zero, but the exact clean-summary parser failed because the
UTF-8 check-mark bytes were decoded through CP437. Stdout was 449,954 bytes,
SHA-256
`3368C0F60999C3B3608A97BC68BEC88D24CFA96FDEBFE214991E3D46F352C643`;
stderr was 130 bytes, SHA-256
`3AA189F2F7B27187B26EDF74C101BF4A36E295FBC04406D6F8104C279BF0C73E`;
the exit receipt SHA-256 was
`F59A3A8103888BD6AAA891C3481DEF5435B8BD9FB3A63B1140B0953B6511FDBA`.
Later matrix labels did not run. Run44c under
`i5-web-path-diagnostic-run44c-20260724` reproduced the boundary and decoded
the final lint item as `Γ£ö No ESLint warnings or errors` with code points
U+0393/U+00A3/U+00F6 while `[Console]::OutputEncoding` was IBM437. Its
diagnostic SHA-256 was
`89B2183D30FC86B67EBF714C6C181E87FB056CA35141BC6239811CAA89FB0074`;
exact cleanup passed with five expected moves and no error. Exception fallback
was rejected after malformed byte `0x80` hung under PowerShell 7.6.3; the
amended boundary instead uses replacement fallback and rejects U+FFFD/U+FEFF
before logging or semantic acceptance. Runs 43 and 44c are failure/diagnostic
evidence only, not a matrix PASS.

The frozen runner and isolated test harness now hash to
`C08FD0D7F1B9A02296BEF242436F9716C10FC73D8427ED4B6F8251382819FEB0`
and
`584085BE6F54E75E607B4B5932C024103398048E0F0F157D54087E99E10A2C18`.
Run50 under
`i5-runner-encoding-aggregate-run50-20260724` passed the bounded runner-test
aggregate with stdout SHA-256
`4BC879F5B55A15ABA78CDB973E28F8710DC74F1C83F5EC61C95450CB26C5B1DF`
and exit-receipt SHA-256
`9EE7CC161CB1D314D3507BC17CD2DA3E89AC2A619E29992FBAA7B4BD08A6CE40`;
its `exit.txt` SHA-256 is
`9A271F2A916B0B6EE6CECB2426F0B3206EF074578BE55D9BC94F6F3FE3AB86AA`.
It proves 31 executable pass cases, two expected exit-7 cases, the process-tree
timeout, Windows `437,65001,437,437` child-code-page sequence, malformed-byte
rejection, 2 static/4 executable evidence mutations and 4 encoding-boundary
mutations. This is isolated runner-test evidence only.

Exactly two authorized clean-fixture repetitions then exercised the complete
eight-command web path through lint. Run51a fixture
`814e55ce8a84d96db25978314a9820ce33cc9120` and run51b fixture
`610976f06ead2a450886e7ad2cf5cba78fd9f230` had identical tree
`7ba74fe740cf371c7ef42841299ccebd00d21dc9`. Both native command sets exited
zero and matched the exact 19-line lint transcript with literal U+2714/
`E29C94`; both restored host/OS/child code page state and quarantined exactly
five expected generated artifacts with no cleanup error. Their repetition
receipt SHA-256 values are
`401475F8DFE02B2F44A8B1E54D706C60EDD3597665E3F3380E512BCEEDE9874B`
and
`DF4E374F6B8EDEC5AC591516034D03551905A14EFA22E0749DD93C01D59D093D`.
Independent encoding-scope review found no defect in the frozen bytes or both
repetitions, but this is web-path evidence only, not R5, a fresh 50-command
matrix or release approval. The exact amended-I5 full matrix remains required.

Run57 under
`i5-full-matrix-457fb88-run57-20260724` exercised exact commit
`457fb88e57c46d6a42add68b6fe96892e7e377b9`. The runner aggregate and matrix
labels through native-zero `go.test.discovery` passed, but its semantic parser
stopped fail closed because the obsolete raw-zero rule rejected valid
`Elapsed: 0.001` for `blockxone/cmd/migrate` and
`blockxone/internal/chainlog`; the other 11 no-test packages emitted `0`.
The exact 1,598 LF-joined Go JSON payloads have SHA-256
`FE88A21AAE71739E977CC95D9B28C8A64A2DD56000046634E699C9F5BF6754EB`;
the exact 39 no-test records have SHA-256
`A51EFCE53E6B68BD6E88E5E4D89DCC1C625DFCD808A06D513E0AD04D1260DD88`.
Stdout was 400,541 bytes, SHA-256
`FA68675A1C98C37DCA6201345F2CF013185E955C1D27D5EBB37AA3378F13C089`;
stderr was 126 bytes, SHA-256
`99DBFB293332EE3F1B466EA48AB08B07674CE3A3AD8F340056089F11791DBA7A`;
and the exit receipt SHA-256 was
`48E661A5335469494B622A15EBAFD25E4073A6159ED53978D5C1D2EA65379348`.
Cleanup reported none, pre/post repository state matched, both status views
were empty and remotes remained absent. Later labels did not run. Run57 is
failure evidence only, not a matrix PASS or an authorization for R5/V5/C5.
BLK-015 remains open until the repaired final bytes pass a fresh complete
matrix and the required distinct downstream gates.

Run58 under `i5-go-discovery-aggregate-run58-20260724` preserved the
pre-run58 runner/test pair
`F19734C253547834021544FF39F42FF4AA27BE5D57FD3D7FD547B8E9479CA421` /
`B719FEACE655CA8C5BFA1A1E05F4FECB6C33F81CE5ADB9254560ADE8863A46B8`
and stopped fail closed after 224,387 ms. The deliberately weakened elapsed
grammar first accepted ordered signed zero, while the harness expected the
later exponent case. Stdout/stderr SHA-256 values are
`CF4BC20F16DCE8AB7CD68005EB4D20126A2C0DF7906722EA36CDDDD74C89B982`
and
`C30F3DCF2962129891BCFCAF90562D357436DBDBEA90BA7EF57CA84371125A1F`;
the exit-receipt SHA-256 is
`A0D9F4661F1F6329E108CD5CD7BA36235AFBE57B8747A0909CC3BE9E9BB154BA`.
Repository pre/post state was exactly equal. This is a test-contract failure
receipt, not an aggregate PASS.

The repaired runner/test hashes are
`F19734C253547834021544FF39F42FF4AA27BE5D57FD3D7FD547B8E9479CA421`
and
`37BCCFBA90997B77577D01E2F3E35621C48E85CD1C568FC23B5982C1E6F3C13C`.
A dedicated read-only Go-discovery review passed those exact bytes and their
isolated 39-negative/hash/index/classification proof. Reverse substitution of
the sole signed-zero diagnostic exactly reconstructs the pre-run58 test hash,
and ordered mutation evidence proves signed zero precedes exponent. That scoped PASS does not
close BLK-015 or substitute for the no-edit aggregate, complete amended-I5
matrix, R5, V5 or C5.

## Historical Plan 00-12 truth boundary — non-authoritative

I4's aggregate matrix PASS is not accepted because mandatory native exits were maskable.

I4's individual command and mutation outputs remain narrow historical evidence only.

The attempted R4 produced only SECURITY-REVIEW-FAILURE-RECEIPT-v4.md; no R4, V4 or C4 exists.

The six recoverably moved .git/objects files were repository-metadata mutations, not tracked working-tree edits.

The v4 failure receipt SHA-256 is 0D9B3DF8697646FBB4747BD12B3521DA39E898C286593809CF9C3492176DD7B5.

P11 is 85964576707555b0b2ad3df6b297e1cb9a602d0a with Plan 00-12 SHA-256 A702B1F506E23FDF475702A76CB30041F295485DFE1BC922D00B19ADC0B439AC.

The Plan 00-12 task paths /root, /root/gen3_plan12_checker, /root/gen3_i5_builder, /root/gen3_r5_security_reviewer, /root/gen3_v5_verifier and /root/gen3_c5_admission_owner are pairwise distinct workflow provenance, not legal-person or professional independence.

Typed roots: TEST_CONTRACT_NATIVE_EXIT_MASKING, EVIDENCE_PROVENANCE_PATH_TRANSCRIPTION_ERROR, GENERATED_OUTPUT_ANCESTOR_REPARSE_ESCAPE, AGENT_ROLE_PROVENANCE_OMISSION and EVIDENCE_SCOPE_WORDING_OVERSTATEMENT.

Phase 0 remains in_progress, production completion remains zero, and release remains NO-GO.

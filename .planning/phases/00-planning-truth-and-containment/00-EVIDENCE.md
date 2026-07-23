# Phase 0 Evidence

## Authoritative status

Phase 0 remains `in_progress`. Production-gate progress is 0 of 12 phases,
0 completed plans and 0 completed requirements. Release status is **NO-GO**.
The one permitted builder summary is a filename-derived GSD artifact and is
not Phase, plan, requirement, professional or production approval.

The canonical evidence namespace is `EV-P0-001` onward in
`.planning/EVIDENCE-REGISTER.md`. Earlier working-tree and selective-delta
results remain historical evidence only; the Generation 3 records below do
not erase their limitations.

## Accepted local lineage

| Label | Commit | Meaning |
| --- | --- | --- |
| C2 | `a88658ad82f3d22aaf26e10b9eab6389084e6dd3` | Independently admitted immutable Generation 2 baseline |
| D3 | `d0c71d7919a6ffa4a18ef3e0fe62f41fb9867294` | Generation 3 containment research |
| P3 | `e00b5056c337b484ff11918dc3f7952c97cdfe64` | Accepted Plan 00-04 |
| P4 | `f081dfc211a767e660d93c0bd33f35b2f30a9803` | Accepted Plan 00-05 summary-semantics boundary |
| P5 | `7d87ed6e8fb1a8c2ef5eb13853a39fc5f96992d2` | Accepted Plan 00-06 Go advisory boundary |
| D5 | `78084349ff8b6385cc33e95900db6fd1094d68a0` | Exact two-file GO-2026-5970 remediation |
| P6 | `5a489930296830d827ac56690c506714001e06a2` | Accepted Plan 00-07 web advisory boundary |
| P7 | `c8c41dda2b5df129201a34b55c882743fa523b82` | Accepted Plan 00-08 PostCSS boundary |
| P8 | `ee017cd9b8ae2840dfee4d3053d714c6b10eedaa` | Accepted Plan 00-09 canonical-lock boundary |
| W7 | `059fc54c4d12b1d889a13d7295da7605006654c4` | Exact two-file canonical web dependency remediation |
| P9 | `08eeb7dc0475c311c35f3a5b5e54bc242b132a62` | Accepted Plan 00-10 evidence-staging correction |

P9 tree is `cc9bbb20ad55ec1bccc8e5f9ad7d7b930445908e`; its parent
is exact W7. `W7..P9` is only `00-10-PLAN.md`. The external P9 acceptance
receipt SHA-256 is
`4894F21F6938DB6E7592E2D0C37C2DED18ACA9942CC6FD246A5B329A9F1341E2`.

## Planning stops retained as evidence

- The first Next/Sharp candidate W5 was never committed after the live
  advisory boundary changed.
- The PostCSS W6 candidate was never committed after default npm 10.9.8
  produced a different clean-baseline lock than the stateful simulation.
- W7 is the accepted deterministic clean-baseline result: package SHA-256
  `C97792E078567B2A6B756EF1D765DC2841BC8276BCB9606A5898F7A560FAD268`
  and lock SHA-256
  `B3C27A7F07B2766ECB64A57F9357E5FC977083DD60273FC08D06E988BD60A6D3`.
- Plan 00-09 required a future validator both to enforce a new STATE plan
  total and to accept literal W7, whose immutable STATE still had the old
  total. The distinct evidence builder stopped before editing I3. Plan 00-10
  corrected the staging semantics as P9.

These are fail-closed planning/determinism stops. They are not silently
reclassified as passing implementation candidates.

## Exact-P9 complete local matrix

The distinct evidence builder ran the complete local contract at exact clean
P9 on 2026-07-23. The committed legacy planning validator passed literal P9;
the future validator is not claimed to pass W7 or P9.

| Gate | Exact-P9 result |
| --- | --- |
| Planning | PASS: v2.0, 12 phases, legacy GSD artifact progress 0%, 89 active requirements |
| Repository artifacts | PASS: 484 tracked paths across 20 HEAD-reachable commits |
| CI policy | PASS: mandatory failures propagate and deploy remains blocked |
| Compose policy | PASS: `migrate`, `api`, `web`, `worker`; 29 required-variable negatives |
| actionlint | PASS with actionlint 1.7.12 |
| Go tests/vet | PASS with exact Go 1.26.5 and `GOTOOLCHAIN=local`; 12 packages reported nonzero tests |
| golangci-lint | PASS: 0 issues |
| gosec | PASS: 85 files, 22,573 lines, 0 issues |
| govulncheck | PASS: 0 reachable vulnerabilities; 8 imported-package and 15 required-module findings are informational because no scanned symbol calls them |
| Web install/resolution | PASS: 524 packages; Next/@next/env/eight SWC lock entries/eslint 15.5.21; one Sharp 0.35.3/libvips 8.18.3; PostCSS 8.5.22; no nested Next PostCSS |
| Native Sharp | PASS: in-memory 2x3 RGBA image, 95-byte PNG, metadata format/dimensions exact |
| Web tests | PASS: preflight 4, configuration 5, runner 21, root unit 92 and package-root unit 92 |
| Web lint/build/containment | PASS: zero lint errors/warnings, Next 15.5.21 production build with 45 static pages, exact-tree cleanup and stable loopback refusal |
| Web dependency audits | PASS: full and runtime before build and full and runtime after containment, all zero findings |
| Contract install/preflight | PASS: 209 packages and 10 preflight tests |
| Contract compile/typecheck/tests | PASS: 27 Solidity files, solc 0.8.20, optimizer 200, Shanghai; typecheck; 59 Mocha tests |
| Contract dependency audits | PASS: runtime and full, zero findings |
| Raw Compose render | PASS |
| Bytecode evidence | PASS: 43 complete compiler outputs and 27 user artifacts; exact comparison SHA-256 `9D75271BB9A9E87D410D98DC9EAE4F0ADAA8597B7D55E4A72324EC2BEA78AF62` |

The configuration-only bytecode evidence compares C2 with accepted Task 2
commit `2a55a5fbf51a2018a650122eff313f3ce4e63dff`. It intentionally does not
claim that later identity, issuance or mock changes preserve bytecode.

## Exact-P9 warnings and controlled retries

- The system Go bootstrap is 1.25.5 and initially failed before package
  loading when `GOTOOLCHAIN=local` was applied. The builder selected the
  already installed exact Go 1.26.5 binary and prepended its bin directory;
  the complete required Go gates then passed. This is tool-selection evidence,
  not a code failure.
- The first build wrapper imposed a 60-second controller timeout and therefore
  produced no product verdict. Its partial `.next` was moved recoverably to
  quarantine. A clean retry completed in 37.76 seconds and passed.
- npm emitted deprecation notices for `inflight` and legacy `glob` versions.
  Exact full/runtime audits nevertheless returned zero; the notices are not
  suppressed and remain upstream dependency-maintenance evidence.
- Next lint emitted its announced future CLI migration notice.
- Browserslist reported seven-month-old browser data during the build.
- Solidity emitted three same-name declaration warnings and two unused
  parameter warnings. Compile, typecheck and all 59 tests passed; the warnings
  remain visible and are not represented as external audit clearance.

## Generated-output quarantine

P9 generated dependencies, caches, artifacts, TypeChain output and both the
timed-out and successful `.next` trees were moved without overwrite beneath:

`C:\Users\danie\AppData\Local\Temp\blockxone-i3-quarantine-67f8144dc1224a2c98090205c414e188`

The bytecode reproduction output is retained in the same bounded quarantine.
No tracked path was deleted or moved. P9 returned to a generated-path-free,
clean and remote-free state before builder evidence edits.

## Staged validator boundary

The updated validator is required to prove two states only:

1. the actual controlled I3 builder worktree before the summary, with exactly
   ten plans, updated STATE, no summary and GSD artifact state planned/0; and
2. exact I3 with the only permitted `00-04-SUMMARY.md` and GSD artifact state
   partial/10.

Both states retain authoritative production progress of zero, Phase 0
`in_progress`, ROADMAP Phase 0 unchecked, 89 unchecked requirements and
release status NO-GO. Mutation outcomes are frozen into this document before
I3; the exact-I3 post-commit rerun is bound externally because I3 cannot
self-record its own immutable commit.

The actual no-summary builder worktree passed planned/0 and a 36-case isolated
mutation suite. The suite covered missing/extra/case-mutated plans, generic and
wrong summaries, a real directory junction, STATE completion/plan totals,
ROADMAP completion/status/duplicates, checked/missing/duplicate/fake
requirements, GSD counters/status/dependencies/health, nonzero tools and
malformed JSON. Every mutation failed nonzero with the intended diagnostic.
The suite re-hashed all repository planning files afterward and proved the
source originals byte-identical.

The actual summary-bearing builder worktree then passed partial/10 and a
48-case isolated mutation suite. In addition to the no-summary cases, it
rejected a case-mutated or second summary, wrong phase/plan/status/release or
requirements metadata, missing `in_progress`, builder-only, task-separation
or explicit nonclaim statements, and a duplicate frontmatter key. Every
mutation failed nonzero with the intended diagnostic, and the suite again
proved repository originals byte-identical. The same 48-case suite remains
mandatory at exact I3.

## Evidence still required for Phase 0 exit

- Exact-I3 adversarial review by the distinct Task 7 reviewer.
- Exact-R3 independent full-matrix verification by the distinct Task 8
  verifier.
- Exact-V3 local admission by a distinct final-admission owner.
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
- Identity and governed issuance containment are locally implemented but do
  not close G5 or substitute for independent review and external retest.

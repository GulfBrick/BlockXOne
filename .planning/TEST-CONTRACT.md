# Authoritative Test and Toolchain Contract

## Toolchains

| Domain | Required version/policy |
| --- | --- |
| PowerShell | PowerShell 7 or later; the current process executable is recorded |
| Go | Exact pinned Go 1.26.5 leaf path and SHA-256, with its directory ahead of the prior `PATH` so transitive package loaders resolve the pinned `go.exe` first, and process `GOTOOLCHAIN=local` during all Go-backed identity and matrix commands |
| Web and contracts Node | Exact pinned Node 22.23.1 leaf path and SHA-256 |
| npm | Exact pinned npm CLI 10.9.8 leaf path and SHA-256; transitive hooks receive the validated pinned npm shim directory first on `PATH` |
| Solidity/Hardhat | Solidity 0.8.20, optimizer 200, Shanghai build target; Hardhat 3.10.0 and exact direct dependencies |
| Security tools | actionlint 1.7.12, golangci-lint 2.12.2, gosec 2.25.0 and govulncheck 1.6.0 |
| Containers | Version output is local evidence only; immutable image digests, SBOM/signing and hosted build evidence remain required |

## Required Phase 0 commands

This repository exposes one executable entry point for the complete local
Phase 0 matrix. It owns the frozen 11 tool checks and 39 matrix commands,
checks each direct native exit immediately, runs bounded no-overwrite cleanup,
and accepts success only after ignored-aware repository status is empty.

```powershell
pwsh -NoProfile -File .\.planning\scripts\invoke-phase0-matrix.ps1 -NodeExecutable "C:\Users\danie\AppData\Local\npm-cache\_npx\d295cebdb7c54afe\node_modules\node\bin\node.exe" -NpmCli "C:\Users\danie\AppData\Local\npm-cache\_npx\d8f2e63c6145eb9d\node_modules\npm\bin\npm-cli.js" -GoExecutable "C:\Users\danie\go\pkg\mod\golang.org\toolchain@v0.0.1-go1.26.5.windows-amd64\bin\go.exe" -BaselineManifest "C:\Users\danie\Documents\BlockXOne Phase0 Recovery 20260719\clean-root-20260720\generation-3-20260721\bytecode-baseline-c2.json" -CandidateManifest "C:\Users\danie\Documents\BlockXOne Phase0 Recovery 20260719\clean-root-20260720\generation-3-20260721\bytecode-explicit-shanghai.json" -BaselineCommit a88658ad82f3d22aaf26e10b9eab6389084e6dd3 -BaselineTree 13492dba6a709db7d093052824c5ddb3ee8c58e9 -CandidateCommit 2a55a5fbf51a2018a650122eff313f3ce4e63dff -CandidateTree 6b9f6672001b0f9d14d0dcb19756b206db2974cd -ToolCommit 2a55a5fbf51a2018a650122eff313f3ce4e63dff -ToolTree 6b9f6672001b0f9d14d0dcb19756b206db2974cd -ToolPath "contracts/scripts/capture-bytecode-manifest.mjs"
```

Do not copy individual matrix commands out of the repository-owned runner and
then call the result the authoritative Phase 0 matrix. The runner-test script
uses only disposable fixtures and bounded self-test processes; it does not
execute the real matrix or mutate the real repository.

The wrapper contract covers every direct child process launched by
`invoke-phase0-matrix.ps1`. Immutable child validators and package lifecycle
scripts can launch their own child processes; those grandchildren are not
intercepted by the wrapper. Their transitive Node/npm/Go resolution is
constrained by a validated, process-scoped `PATH`, and their own checks remain
part of the reviewed evidence boundary.

## Fixed environment boundaries

- Preserve the prior presence and value of `PATH`, prepend the pinned Node
  directory, validated pinned npm shim directory and pinned Go directory, prove
  all three resolve first for transitive hooks/package loaders, and restore the
  prior state in `finally`.
- Preserve the prior presence and value of `GOTOOLCHAIN`, set it to `local`
  before the first Go identity command, keep it through `go.govulncheck`, and
  restore it before web installation or from `finally` on failure.
- Preserve the prior presence and values of `NEXT_PUBLIC_API_URL` and
  `SERVER_ACTION_ALLOWED_ORIGINS`. The fixed `.example` values apply only to
  matrix labels 18 through 25 and are restored before contract installation or
  from `finally`.
- The `.example` URL and origin are local validation fixtures only. They are
  not production configuration, network selection or provider approval.

## Fail-closed native execution

- PowerShell native error preference is enabled when available, but the runner
  still captures the native exit code in the immediately adjacent statement.
- Immediately before the sole call-operator launch, the runner sets
  `[Console]::OutputEncoding` to BOM-less UTF-8 with replacement fallback.
  `[Console]::InputEncoding` and `$OutputEncoding` must remain unchanged. The
  bounded native error preference is restored by the inner `finally`; location
  and `[Console]::OutputEncoding` are restored by the outer `finally`.
  Restoration and unchanged-state checks require bidirectional
  `Encoding.Equals` plus a semantic fingerprint of code page, names, preamble,
  fallback behavior and fixed encode/decode probes. Runtime wrapper type is
  descriptive only.
- Every captured native string is scanned for U+FFFD and U+FEFF before raw
  logging or semantic acceptance. Either code point emits
  `NATIVE_OUTPUT_REJECTED`; native nonzero remains authoritative, while native
  zero with rejected decoding throws the typed
  `NATIVE_COMMAND_UTF8_DECODE_REJECTED` failure.
- A nonzero native result records the exact label and exit code. A later
  successful command cannot replace it.
- The first matrix failure remains primary while cleanup continues over the
  bounded inventory. Cleanup-only failure is also nonzero, and combined primary
  and cleanup failures retain both diagnostics.
- No alternate process launcher, nested shell launcher, command-name
  construction, dot-sourcing or ambient Node/npm/Go resolution is permitted in
  the runner.
- Every result-bearing production label is statically mapped to one explicit
  parser or zero-output gate; `go.test` is the sole native-zero-only label
  because `go.test.discovery` owns its discovery semantics. The generic
  existence matcher is prohibited. Each parser must follow its checked
  invocation and precede the next checked invocation. Plain machine markers
  require their exact raw-line count and are compared without trimming or color
  removal. Human-formatted output strips only bounded,
  standards-formed 7-bit or C1 ANSI SGR formatting from a parsing copy; raw
  `Output` and `Text` remain byte/string-identical. Non-SGR ESC, OSC and C1
  controls remain visible and fail anchored grammar.
- The top-level production chain is AST-bound exactly once and in this order:
  tool identities, `runner.tests`, the runner-test parser, the complete matrix,
  final ignored-aware Git status, its zero-output parser, the exact empty-status
  marker, then the sole matrix-PASS marker. Thirteen orchestration mutations
  prove deletion, duplication, reordering and premature success markers fail.
- Numeric evidence fields use ASCII `[0-9]`, bounded regular expressions,
  `NumberStyles.None`, `InvariantCulture` and overflow-checked `UInt64`
  parsing. Each parser counts label-bearing lines separately from exact
  grammar matches, so absent, duplicate, conflicting, malformed, misleading,
  signed, decimal, grouped, exponential and Unicode-number evidence fails.
- Planning validation must emit its exact ten ordered fields. Tool identities,
  artifact/CI/Compose policy, module verification, the runner-test marker and
  bytecode-comparator marker have exact multiplicity and grammar. Actionlint,
  `go vet`, quiet Compose render and final ignored-aware Git status must emit
  zero raw diagnostic lines.
- Go JSON discovery rejects duplicate or case-colliding properties, unknown
  properties/actions, wrong types, duplicate `(Package, Test)` pass
  identities, every fail event and every test-level skip. It requires exactly
  357 unique passing tests/subtests and one unique package-pass terminal across
  the exact ordinal 12-package tested set. The disjoint immutable 13-package
  no-test set must each complete an exact per-package `start -> output -> skip`
  state machine while unrelated package events may interleave globally. The
  pinned Go 1.26.5 raw-format contract requires action-specific property order,
  exact `?   <TAB>package<TAB>[no test files]<LF>` output and a skip `Elapsed`
  JSON number in unsigned plain-decimal grammar (including `0.0`, excluding
  signs and exponents). `TryGetDouble` must succeed, the value must be finite
  and nonnegative, and it must not exceed the native command wall duration plus
  the documented 250 ms host/Go scheduling and rounding allowance. The exact 39
  run57 no-test records are LF-joined without a final LF and hash-bound to
  SHA-256
  `A51EFCE53E6B68BD6E88E5E4D89DCC1C625DFCD808A06D513E0AD04D1260DD88`;
  their comma-joined observed indices are independently hash-bound to
  `348422110F0AA1C423320264332903C0D681D9FF7630261401BDCE176D555AD8`.
  They are embedded with 1,559 explicitly synthetic tested-package events in a
  representative interleaved 1,598-event stream, not claimed as a replay of
  all 1,598 original records. The self-test captures the production parser's
  sole classification line and asserts its zero/nonzero/max/bound fields rather
  than trusting a disconnected hard-coded summary.
  Missing, extra, duplicate, reordered, post-terminal, malformed, overlapping
  or conflicting package evidence fails. Gosec must report exactly one whole-line
  `Issues : <ASCII integer>` field with numeric zero; govulncheck must report
  both its unique no-reachable-vulnerability marker and unique numeric
  `affected by 0 vulnerabilities` field. Native exit remains authoritative
  even when output contains a valid-looking success summary.
- TAP suites require exact plan/tests/pass/fail/suites/cancelled/skipped/todo
  fields for 4, 5, 21 or 10 tests. Both Vitest entries require exact 3/3 file
  and 92/92 test summaries plus identical hermetic-cache create/cleanup paths.
  npm installs require one positive package count; all six audit labels
  require one invariant zero-vulnerability summary. Next lint requires the
  exact ordered 19-line raw npm/Next transcript ending in one literal U+2714
  success line; missing, extra, reordered, banner-mutated, SGR/control-bearing,
  CP437-mojibake or replacement-character output fails. Static-page generation
  (one final 45/45), production containment, Hardhat compile
  (27 files, solc 0.8.20, Shanghai) and Hardhat nodejs test aggregates
  (59/16/36/5 with no pending/failing/skipped/todo summary) each have their
  own exact fail-closed parser.
- `web.sharp-smoke` must receive the accepted Plan 00-12 JavaScript as one
  non-expandable PowerShell single-quoted here-string: exactly 720 UTF-8 bytes,
  SHA-256
  `99E0F57352403101C592D34B91591722B049C2C551698A2ED1F072031819F2B3`,
  two backticks and six literal `${...}` tokens. The runner checks those bytes
  before pinned Node, and the runner tests independently extract the sole
  JavaScript fence from exact-hash Plan 00-12, compare it with the literal,
  prove the PowerShell-to-Node argument bytes, and reject interpolation,
  byte/hash or argument-vector weakening. A Sharp-looking PASS line cannot
  mask native exit 7.
- “No tests found,” unsupported toolchain, malformed discovery output and
  security findings at or above the approved threshold are failures.
- The isolated runner harness must bound every child process, kill the process
  tree on timeout and prove the descendant is gone. Its Windows code-page probe
  must observe the child sequence `437,65001,437,437`; malformed byte `0x80`
  must be rejected within the watchdog with U+FFFD evidence and exact parent/
  child encoding restoration.

## Generated-output containment

The cleanup inventory is exactly 20 entries:

- repository: `node_modules`, `.npm-cache`;
- web: `node_modules`, `.next`, `coverage`, `.vite`, `.vitest`, `.npm-cache`,
  `out`, `build`, `dist`, `tsconfig.tsbuildinfo`, `next-env.d.ts`; and
- contracts: `node_modules`, `artifacts`, `.hardhat-cache`, `cache`,
  `typechain-types`, `.npm-cache`, `coverage`.

`apps/web/node_modules/.vite` is preserved by the parent `node_modules` move
and is not moved separately. Before the first move, the runner validates every
component root, existing source component, terminal source, resolved temporary
root, quarantine root and destination ancestor as non-reparse, requires every
destination absent and the source/quarantine on the same volume. It revalidates
source and destination immediately before each atomic file/directory move.
Failures do not overwrite or nest into a destination, and later bounded cleanup
entries are still attempted.

## Evidence scope and retained NO-GO

The preserved bytecode comparison proves exact equality only for the accepted
C2-versus-Task-2 compiler configuration: Solidity 0.8.20, optimizer 200,
Shanghai, 43 compiler contracts and 27 user artifacts. It is not current-I5
external audit or production bytecode provenance.

Contract overrides remain temporary controlled pins, not audit waivers:
`adm-zip` 0.6.0, `diff` 8.0.3 and `serialize-javascript` 7.0.7. They must be
removed only after the upstream dependency graph resolves compatibly and the
complete matrix passes again.

The web hermetic runner constrains its documented test surface; its fetch guard
is not an OS firewall and does not cover every Node networking primitive.
Docker image provenance, Linux race tests, hosted migration smoke, complete
hosted CI, incident closure, financial integrity, provider certification,
legal/accounting/tax approvals, external penetration/smart-contract audit and
human Phase 0 approval remain outstanding.

Passing this local contract is controlled engineering evidence only. Phase 0
remains in progress, authoritative production completion remains zero and the
release remains **NO-GO**.

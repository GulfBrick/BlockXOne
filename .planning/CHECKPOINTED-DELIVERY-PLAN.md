# BlockXOne Checkpointed Delivery Plan

**Replaces:** autonomous/background execution loop
**Delivery repository:** `work/blockxone-functional`
**Delivery branch:** `codex/functional-platform`
**GitHub target:** private `GulfBrick/BlockXOne` repository
**Release posture:** local demonstration recoverable; production NO-GO

## Delivery contract

BlockXOne will be delivered through finite rocks. Each rock has a fixed scope, a visible product outcome, executable acceptance evidence, and an explicit stop. A service process may remain running for demonstration, but it never keeps the Codex task open or controls whether a rock is complete.

No rock may:

- replace GitHub `main` without an explicit merge checkpoint;
- weaken repository visibility or access;
- call a development/mock stack production;
- bypass a failing security, financial, blockchain, compliance, recovery, or deployment gate;
- create another planning system outside this file and the existing native UI specifications;
- retry the same failing command without changing the diagnosis.

## P0-A — Authoritative baseline and clean-candidate CI admission

**Decision owner:** User
**Delivery owner:** Codex Integrator
**Baseline:** `d4f3ccc442871c590cc39ec7967e0bca53739739`
**Unchanged default branch:** `main` at `df3e1698f28891e7d23489a144eae2733bc8b79d`
**Mode:** Build rock with independent architecture and adversarial verification

### Goal

Make `work/blockxone-functional` on `codex/functional-platform` the single
current delivery source, make the planning contract truthful, and obtain one
named hosted `CI` run with nonzero jobs against the exact candidate commit.
Production remains NO-GO and GitHub `main` remains unchanged.

The GitHub repository becomes the local remote named `origin`. The current
local Gen3 remote is renamed `legacy-gen3`, documented as historical evidence,
and given the unsupported-scheme push sentinel
`disabled://blockxone/legacy-gen3-read-only`. The exact post-normalization
contract is:

- exactly two remotes: `origin` and `legacy-gen3`;
- `origin` fetch and push:
  `https://github.com/GulfBrick/BlockXOne.git`, without embedded credentials;
- `legacy-gen3` fetch:
  `C:\Users\danie\Documents\BlockXOne Production Gen3`;
- `legacy-gen3` push:
  `disabled://blockxone/legacy-gen3-read-only`;
- active branch upstream: `origin/codex/functional-platform`.

The rename does not fetch, prune, push or alter the legacy directory.

### Acceptance criteria

- **P0A-AC-01:** Current planning authority consistently names the functional
  repository, `codex/functional-platform`, checkpointed finite rocks, and the
  production NO-GO posture. Gen3 and autonomous-loop material remains
  historical evidence only.
- **P0A-AC-02:** R-01 records the exact published GitHub baseline; R-02 remains
  explicitly in progress.
- **P0A-AC-03:** A clean commit passes the planning, repository-artifact,
  production-Compose, CI-policy, workflow-syntax, functional-Compose and Go
  proof commands below.
- **P0A-AC-04:** A push of the exact candidate produces a named `CI` workflow
  that concludes `success`, contains every mandatory successful job, and is
  not `BuildFailed`/`startup_failure`.
- **P0A-AC-05:** GitHub `main`, production deployment blocking and every
  professional/regulatory gate remain unchanged.

### Allowed tracked paths

- `.planning/CHECKPOINTED-DELIVERY-PLAN.md`
- `.planning/STATE.md`
- `.planning/ROADMAP.md`
- `.planning/PROJECT.md`
- `.planning/DECISIONS.md`
- `.planning/APPROVALS.md`
- `.planning/BLOCKERS.md`
- `.planning/EVIDENCE-REGISTER.md`
- `.planning/scripts/validate-planning.ps1`
- `.planning/scripts/validate-ci-policy.ps1`
- `.planning/scripts/verify-p0a-hosted.ps1`
- `.github/workflows/ci.yml`
- `.github/CODEOWNERS`
- `.github/dependabot.yml`
- `docs/BLOCKXONE_AGENT_EXECUTION_LOOP.md`
- `docs/BLOCKXONE_PRODUCTION_MASTER_PLAN.md`

Exact ignored build/cache residue may be hash-inventoried and recoverably moved
to a unique directory outside the repository. It is not implementation input.
The receipt must cover the currently observed `.npm-cache/`,
`apps/web/.npm-cache/`, `contracts/.npm-cache/` and `seed.exe` with resolved
paths, type/reparse status, size and SHA-256 where finite. Unexpected or
reparse-point content fails closed; quarantine is unique and no-overwrite.

### Constraints and non-goals

- Do not modify `cmd/`, `internal/`, `migrations/`, contracts, web product code,
  provider behavior or production deployment.
- Do not replace the default branch, rewrite history, weaken a no-go control,
  introduce secrets or claim external legal/security/finance approval.
- `docs/BLOCKXONE_AGENT_EXECUTION_LOOP.md` may receive only a clear
  superseded/historical banner; its evidence is not rewritten.
- Master-plan edits are limited to current source authority, accepted planning
  defaults, modular-Go/PostgreSQL workflow direction and the G5A/G5B split.
- South Africa/private debt/ZAR/AWS/Polygon/PostgreSQL workflow decisions are
  accepted planning defaults only. They do not close G1, G2, G3 or G5.
- T-REX 4.1.3 is a reference/hardened-derivative direction contingent on a
  proprietary licence and the required professional approvals.
- CODEOWNERS and Dependabot configuration are preparatory, not enforced
  protection. CODEOWNERS may request review on a pull request targeting this
  branch but cannot provide segregation of duties with one principal and no
  branch rule. Dependabot version updates remain inactive until the
  configuration is present on the default branch.

### Required CI and repository-policy contract

- `ci.yml` triggers pushes to `codex/functional-platform`.
- Its planning job invokes `validate-planning.ps1 -ResidueMode CleanCandidate`.
- Every external `uses:` action is pinned to a full commit SHA.
- `validate-ci-policy.ps1` rejects regression of those three controls.
- The same validator checks CODEOWNERS owner syntax/current-principal
  expectations and the Dependabot v2 ecosystems, directories, schedules and
  explicit target-branch behavior. These checks validate candidate
  configuration; they do not claim enforcement.
- `validate-planning.ps1` exhaustively checks current authority in
  CHECKPOINTED-DELIVERY-PLAN, STATE, ROADMAP and PROJECT; requires DEC-001 and
  the old loop approval to be explicitly superseded; requires the historical
  loop banner; and rejects Gen3/autonomous-loop language in active/current
  fields. Its self-test mutates each authority invariant and proves fail-closed
  behavior.
- `verify-p0a-hosted.ps1` accepts only one unabbreviated lowercase 40-hex
  candidate SHA and proves the equality chain
  `CandidateSha == git rev-parse HEAD == git ls-remote origin
  refs/heads/codex/functional-platform == hosted run headSha`. It rejects a
  detached or wrong local HEAD, proves an ignored-aware clean tree, verifies
  the local branch/upstream/remote routing, checks live default-main invariants,
  and parses the exact hosted run and mandatory job set. Its self-test proves
  that empty-name, zero-job, abbreviated/invalid/wrong-SHA, detached/wrong-HEAD,
  failed, skipped and missing-job fixtures are rejected. It also rejects
  missing/extra remotes, swapped or credential-bearing origin URLs, any legacy
  push URL other than the exact unsupported-scheme sentinel, and a wrong
  upstream.
- Workflow syntax is checked with actionlint v1.7.12. A fail-closed version
  guard runs before linting and requires the first `actionlint -version` line
  to equal exactly `v1.7.12`; missing-binary and wrong-version negative fixtures
  must fail.

### Proof

```powershell
git diff --check
git status --porcelain=v1 --untracked-files=all --ignored=matching
pwsh -NoProfile -File ./.planning/scripts/validate-ci-policy.ps1 -AssertActionlintVersion
actionlint .github/workflows/ci.yml .github/workflows/deploy.yml
pwsh -NoProfile -File ./.planning/scripts/validate-planning.ps1 -ResidueMode CleanCandidate
pwsh -NoProfile -File ./.planning/scripts/validate-planning.ps1 -SelfTest
pwsh -NoProfile -File ./.planning/scripts/validate-repository-artifacts.ps1
pwsh -NoProfile -File ./.planning/scripts/validate-production-compose.ps1
pwsh -NoProfile -File ./.planning/scripts/validate-ci-policy.ps1
docker compose -f docker-compose.functional.yml config --quiet
go test ./...
pwsh -NoProfile -File ./.planning/scripts/verify-p0a-hosted.ps1 -SelfTest
pwsh -NoProfile -File ./.planning/scripts/verify-p0a-hosted.ps1 `
  -CandidateSha <candidate-sha> `
  -ExpectedMainSha df3e1698f28891e7d23489a144eae2733bc8b79d
```

The hosted run receipt must identify the exact candidate SHA, workflow name,
jobs, conclusion and URL. It must prove `headSha` equals the candidate,
`workflowName` is `CI`, every required job exists and succeeds, and the overall
conclusion is `success`. It must also prove the default branch remains `main`
and the live `heads/main` SHA remains
`df3e1698f28891e7d23489a144eae2733bc8b79d`. A failed mandatory job stops the
rock with its exact evidence; it is never converted into a pass.

## R-01 — Functional baseline recovery

**Outcome:** The recovered application starts deterministically from a clean database and exists as a reviewed private GitHub branch.

### Scope

- functional API image, migration, seed, worker, and web containers;
- internal web-to-API routing;
- deterministic local Compose build/start;
- current recovery documentation and receipts;
- no production provider, credential, or smart-contract changes.

### Acceptance

- `docker compose -f docker-compose.functional.yml config --quiet`
- `go test ./...`
- pinned Node 22.23.1/npm 10.9.8 hermetic web test suite
- production-mode Next.js build with explicit remote HTTPS configuration
- clean-volume migration and seed exit 0
- API and worker healthy
- web and API return HTTP 200
- no duplicate image-export race during `up -d --build`
- reviewed commit pushed as `codex/functional-platform` without replacing `main`

### Current evidence

- Compose configuration: PASS
- Go suite: PASS
- Web suite: PASS, 4 files / 94 tests
- Production-mode Next.js build: PASS, 45 routes
- Clean-volume migration: PASS
- Clean-volume seed: PASS
- Clean-volume API health: PASS
- Clean-volume worker health: PASS
- Clean-volume web smoke: PASS
- Deterministic shared-image build: PASS
- GitHub publication: pending

## R-02 — Canonical institutional UI and motion

**Outcome:** Investor and operator experiences look intentionally related, accessible, responsive, and production-consistent.

### Authoritative design inputs

- `.planning/milestones/pre-production-rebaseline-phases/01-brand-and-landing-foundation/UI-SPEC.md`
- `.planning/milestones/pre-production-rebaseline-phases/07-investor-portal-mvp/UI-SPEC.md`
- `.planning/milestones/pre-production-rebaseline-phases/08-operator-console-mvp/UI-SPEC.md`

### Canonical visual rules

| Role | Required treatment |
|---|---|
| Foundation | Midnight graphite `#0B131B`, slate surface `#0F1E28`, restrained elevation |
| Accent | Electric cyan `#27D0F7` to deep cyan `#00B8E6`; illumination is an accent, not a background effect |
| Text | Frost white `#EAF6FF`, accessible secondary text, steel grey `#7B8EA2` muted |
| States | Success `#10B981`, warning `#F59E0B`, danger `#EF4444` |
| Display font | Orbitron |
| Body font | Inter |
| Data font | JetBrains Mono |
| Investor UX | Calm, guided, card-led, one obvious primary action |
| Operator UX | Dense, decisive, traceable, table/detail-drawer oriented |
| Motion | 150-300 ms; transform/opacity first; maximum 1-2 decorative animated elements per view |
| Accessibility | Visible focus, keyboard completion, 44 px targets, AA contrast, reduced-motion parity |

### Work

1. Consolidate `design-tokens.css` and the overlapping tokens in `globals.css`.
2. Load Orbitron, Inter, and JetBrains Mono without layout shift.
3. Replace repeated raw page colors with semantic tokens.
4. Remove decorative holographic/neon/glass effects that compete with transaction state.
5. Normalize Framer Motion timings and wire component behavior to reduced-motion preferences.
6. Standardize navigation, headings, buttons, forms, cards, tables, alerts, empty states, and loading states.
7. Verify the public landing, investor login/portfolio/market/fund, operator login/issuer/compliance/tokenisation/admin, and error routes.

### Acceptance

- no competing runtime token systems;
- no raw brand hex values in page components;
- all core routes at 360, 768, 1024, and 1440 px without horizontal overflow;
- keyboard-only completion of primary demonstration flows;
- reduced-motion screenshots show no functional loss;
- stable loading/error/empty/success states;
- before/after visual receipts for investor and operator flows;
- web tests and production build remain green.

### 2026-07-25 checkpoint evidence

- Supplied logo master and brand board are preserved under `docs/brand/`.
- Deterministic transparent mark, wordmark, lockup, favicon, and application-icon derivatives are served from `apps/web/public/brand/`.
- The public shell, landing page, shared navigation, dashboard lockup, fonts, colors, radii, shadows, focus treatments, and base motion tokens use the canonical system above.
- Hermetic web suite: PASS, 4 files / 94 tests.
- Production-mode Next.js build: PASS, 45 routes.
- Live local web and API health: HTTP 200.
- Browser verification: PASS at 375 × 812 and 1440 × 900 for font loading, image loading, 44 px mobile portal target, and horizontal overflow.
- R-02 remains **in progress** until the protected investor/operator surfaces, intermediate breakpoints, keyboard flows, reduced-motion parity, and state coverage satisfy the full acceptance list.

## R-03 — Core workflow closure

**Outcome:** Demonstration workflows are API-backed, coherent, and fail closed.

### Demonstration paths

1. Investor authentication and session recovery.
2. Investor qualification/KYC state.
3. Offering discovery and fund detail.
4. Subscription/order creation with explicit eligibility gates.
5. Operator investor review and compliance decision.
6. Issuer/offering administration.
7. Tokenisation instruction lifecycle in mock mode, clearly labelled as non-production.
8. Audit/event visibility for every privileged transition.

### Acceptance

- happy path and denial path for each workflow;
- authorization verified server-side;
- no role override in the standard demonstration;
- no hidden stub presented as live provider behavior;
- idempotency and replay behavior verified for money/token-affecting commands;
- end-to-end smoke suite covers the demonstration script.

## R-04 — Protected staging

**Outcome:** A shareable HTTPS staging environment runs a saved revision with managed secrets and an executable rollback.

### Required staging contract

- separate staging domain and API origin;
- secret-managed configuration, never committed values;
- managed PostgreSQL, Redis, NATS, and object storage or explicitly approved equivalents;
- non-development authentication;
- non-mock integration endpoints or clearly isolated provider sandboxes;
- HTTPS, security headers, restricted CORS and Server Action origins;
- migration job before application rollout;
- health, readiness, logs, metrics, alerts, backup, restore, and rollback;
- seeded synthetic data only;
- revision/commit displayed in deployment receipts.

### Acceptance

- deploy from a protected GitHub revision;
- smoke tests pass from outside the local network;
- unauthorized routes fail closed;
- backup and restore exercise passes;
- rollback to the prior revision is timed and verified;
- no real customer, investor, identity, banking, or blockchain secret is used.

## R-05 — Production release gates

**Outcome:** Production becomes eligible only after every mandatory gate is closed with executable and professional evidence.

### Technical gates

- production Compose/deployment contract;
- real chain RPC, custody/signing, KYC/AML, sanctions, banking/payment, messaging, and storage providers;
- hardened ERC-3643 identity/compliance behavior;
- key management, rotation, revocation, and break-glass controls;
- penetration test and smart-contract audit remediation;
- dependency, container, secret, SAST, and infrastructure scanning;
- observability, incident response, disaster recovery, RPO/RTO proof.

### Financial and operational gates

- double-entry ledger;
- bank/custody/on-chain/subledger reconciliation;
- idempotent posting and reversal;
- settlement finality and exception queues;
- maker-checker controls and audit evidence;
- valuation, fees, cash breaks, token/register breaks, and close procedures;
- signed finance, operations, security, privacy, legal, compliance, and regulatory approvals.

### Release rule

Local and staging success do not make the system production-ready. Production remains NO-GO until the gate register contains named owners, evidence locations, dates, expiry/refresh rules, and approval for every mandatory control.

## GitHub protection plan

### Verified active controls

- repository visibility is private;
- one administrator/collaborator is present;
- vulnerability alerts are enabled;
- automated dependency security fixes are enabled;
- merged branches are deleted automatically;
- no deploy keys or webhooks are configured.

### Required upgrades before `main` is authoritative

1. Move the repository into a GitHub organization with private forking disabled.
2. Use a GitHub plan that supports protected private branches/rulesets.
3. Require pull requests, at least one approving review, conversation resolution, passing CI, linear history, signed commits where operationally supportable, and no force push/deletion.
4. Restrict GitHub Actions to approved actions and pin third-party actions to full commit SHAs.
5. Verify account 2FA and recovery codes in the GitHub UI.
6. Add CODEOWNERS for security-sensitive, financial, smart-contract, deployment, and policy paths.
7. Add staging/production environments with required reviewers and scoped secrets.

## Checkpoint handoff format

Every rock ends with:

- visible outcome;
- branch and commit;
- exact tests and exit status;
- runtime or deployment URL;
- security/release posture;
- remaining blockers;
- the next bounded rock.

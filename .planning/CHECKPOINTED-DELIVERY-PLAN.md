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
| Foundation | Dark graphite `#0B0F1A`, restrained surface elevation, strong readable borders |
| Accent | Cyan `#06B6D4` to blue `#3B82F6`; glow is an accent, not a background effect |
| Text | `#F9FAFB` primary, `#9CA3AF` secondary, `#6B7280` muted |
| States | Success `#10B981`, warning `#F59E0B`, danger `#EF4444` |
| Display font | Sora |
| Body font | IBM Plex Sans |
| Data font | JetBrains Mono |
| Investor UX | Calm, guided, card-led, one obvious primary action |
| Operator UX | Dense, decisive, traceable, table/detail-drawer oriented |
| Motion | 150-300 ms; transform/opacity first; maximum 1-2 decorative animated elements per view |
| Accessibility | Visible focus, keyboard completion, 44 px targets, AA contrast, reduced-motion parity |

### Work

1. Consolidate `design-tokens.css` and the overlapping tokens in `globals.css`.
2. Load the three canonical font families without layout shift.
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

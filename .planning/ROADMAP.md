# BlockXOne Production-Ready Rebuild Roadmap

## Current delivery authority

**Authoritative delivery repository:** `work/blockxone-functional`

**Authoritative delivery branch:** `codex/functional-platform`

**Execution mode:** checkpointed finite rocks

**Release posture:** production NO-GO

- **Execution contract:** `.planning/CHECKPOINTED-DELIVERY-PLAN.md`, accepted SHA-256 `5443CA4DB90D005DBA6C7AD12060D2A19F039D78FE42F4F4D2BA8D21213CD53D`.
- **GitHub target:** private `GulfBrick/BlockXOne` repository through `origin` at `https://github.com/GulfBrick/BlockXOne.git`.
- **Default-branch invariant:** GitHub `main` remains unchanged at `df3e1698f28891e7d23489a144eae2733bc8b79d`.
- **Historical boundary:** Generation 2, Generation 3 and the controlled autonomous loop are retained as non-authoritative evidence only.

## Current checkpoint sequence

| Checkpoint | Status | Current truth | Stop condition |
| --- | --- | --- | --- |
| P0-A | In progress | Make the functional repository/branch the single delivery source and admit one exact clean candidate through a successful named hosted `CI` run with nonzero mandatory jobs | Stop on any planning, repository, CI, workflow, Compose, Go, routing, default-main or hosted-job failure |
| R-01 | Published | Functional baseline `d4f3ccc442871c590cc39ec7967e0bca53739739` is published on `codex/functional-platform`; `main` was not replaced | Reopen only if the exact baseline or private branch receipt is disproved |
| R-02 | In progress | Canonical institutional UI/motion implementation exists, but protected surfaces, intermediate widths, keyboard flows, reduced-motion parity and complete state coverage remain open | Do not call R-02 complete before every acceptance item has evidence |
| R-03 | Pending | API-backed demonstration workflow closure | Begins only at an explicit checkpoint after R-02 |
| R-04 | Pending | Protected HTTPS staging with managed secrets, recovery and rollback | Begins only after R-03 acceptance |
| R-05 | Pending | Production release gates | Production remains NO-GO until every technical and professional gate closes |

## Downstream production gate map

This v2.0 phase map defines the full production-control perimeter. It is not a second execution loop: the checkpoint plan above is the sole current scheduler, and the phase gates remain fail-closed release obligations.

**Created:** 2026-07-19
**Profile:** quality and evidence first
**Objective:** deliver a bounded, legally permitted, financially reconcilable and operationally defensible multi-asset tokenization platform

## Program rules

- Production-gate progress starts at zero; earlier work remains reusable evidence or prototype code, not a passed production phase.
- Only work expressly included in the active finite rock may be executed.
- Missing evidence is failure. Builders cannot verify their own changes.
- Critical/high security, financial-integrity, tenant-isolation, contract-safety and false-success findings cannot be deferred.
- Every phase requires matching plan summaries, independent verification and any named human gate approval.
- Secondary trading, retail, cross-border, FX, multi-chain and additional asset classes are later milestones.

## Phase summary

| # | Phase | Outcome | Gate |
| ---: | --- | --- | --- |
| 0 | Planning Truth and Containment | Recoverable baseline, consistent planning state, fail-closed execution contract | Phase 0 calibration |
| 1 | Permitted Perimeter and Golden Product | Legally and commercially bounded first product | G1 |
| 2 | Architecture, Identity and Tenancy | Trusted architecture, identity, authorization and segregation of duties | G2 |
| 3 | Instrument and Financial Core | Typed instrument model, ledger, reservations and reconciliation | G3 |
| 4 | Compliance, Documents and Providers | Defensible compliance evidence and certified provider boundaries | G4 |
| 5 | Contracts and Chain Control Plane | Conformant governed contracts and reliable chain operations | G5A/G5B |
| 6 | Primary Issuance and Servicing | Complete golden subscription, issuance, servicing and redemption lifecycle | Golden lifecycle |
| 7 | Public, Investor and Operator Products | Accessible authoritative product surfaces and commercial readiness | G6/G7 |
| 8 | Reporting, Reliability and Operating Model | Reports, observability, recovery and trained operations | G8/G9 |
| 9 | Integrated Independent Assurance | Exact-release security, financial, contract, UX and resilience evidence | Assurance |
| 10 | Controlled Paid Pilot | Bounded real-value pilot and 30 stable days | Pilot exit |
| 11 | Limited Production and Hypercare | Formal go-live, bounded limits and operating handoff | Production decision |

## Phase checklist

- [ ] **Phase 0: Planning Truth and Containment**
- [ ] **Phase 1: Permitted Perimeter and Golden Product**
- [ ] **Phase 2: Architecture, Identity and Tenancy**
- [ ] **Phase 3: Instrument and Financial Core**
- [ ] **Phase 4: Compliance, Documents and Providers**
- [ ] **Phase 5: Contracts and Chain Control Plane**
- [ ] **Phase 6: Primary Issuance and Servicing**
- [ ] **Phase 7: Public, Investor and Operator Products**
- [ ] **Phase 8: Reporting, Reliability and Operating Model**
- [ ] **Phase 9: Integrated Independent Assurance**
- [ ] **Phase 10: Controlled Paid Pilot**
- [ ] **Phase 11: Limited Production and Hypercare**

## Phase details

### Phase 0: Planning Truth and Containment

**Goal:** establish a recoverable, versioned and internally consistent source baseline plus fail-closed execution and evidence controls.
**Requirements:** BASE-01 through BASE-07
**Depends on:** Nothing
**Gate:** Phase 0 calibration
**Status:** In progress

Success criteria:

1. Every pre-baseline worktree path is classified and a non-secret recovery artifact is hash-verified.
2. An approved selective baseline commit and clean isolated worktree exist.
3. PROJECT, REQUIREMENTS, ROADMAP, STATE and GSD analysis agree on milestone and progress.
4. Requirements map to phases, gates, owners and evidence.
5. Build/test/toolchain and production-feature limits fail closed.
6. One Phase 0 packet passes builder, independent verifier and adversarial review.

### Phase 1: Permitted Perimeter and Golden Product

**Goal:** approve the exact first jurisdiction, issuer/SPV, instrument, investor class, currency, providers, legal ownership model and paid-pilot proposition.
**Requirements:** LEGAL-01 through LEGAL-05, PROD-01 through PROD-02, COMM-01
**Depends on:** Phase 0
**Gate:** G1 — permitted operating model
**Status:** Pending

Success criteria:

1. Legal/regulatory activity, licence and responsibility matrix is signed by qualified owners.
2. Golden instrument terms and lifecycle are typed, versioned and legally reviewed.
3. Register, custody, client-money, payment, accounting and tax responsibilities are explicit.
4. Launch exclusions and limits are enforceable.
5. ICP and paid-pilot hypothesis are evidence-seeking and make no unsupported claims.

### Phase 2: Architecture, Identity and Tenancy

**Goal:** implement the target service/source-of-truth architecture and prove investor, operator, organisation, machine and privileged access boundaries.
**Requirements:** ARCH-01, IAM-01 through IAM-05, REL-01
**Depends on:** Phase 1
**Gate:** G2 — identity and tenant isolation
**Status:** Pending

Success criteria:

1. Investor authentication, wallet linking, session security and step-up controls are proven.
2. Operator OIDC, machine identity, organisation and issuer assignments are authoritative.
3. Central authorization and database isolation pass cross-tenant negative tests.
4. Maker-checker and privileged reauthentication prevent self-approval.
5. Environment, IaC, secrets and service boundaries support later phases safely.

### Phase 3: Instrument and Financial Core

**Goal:** establish the canonical multi-asset domain, immutable double-entry ledger, obligations, reservations, audit and reconciliation model.
**Requirements:** DOMAIN-01, FIN-01 through FIN-05, AUD-01
**Depends on:** Phase 2
**Gate:** G3 — financial integrity
**Status:** Pending

Success criteria:

1. Typed instrument terms distinguish common envelope from asset-specific adapters.
2. Balanced immutable journals reconstruct every balance with fixed precision.
3. Obligations and reservations prevent oversubscription, overspend and duplicate effects.
4. Posting rules, reversals, period controls and idempotency pass concurrent tests.
5. Bank, provider, custody, chain, register and general-ledger reconciliation has owned breaks.

### Phase 4: Compliance, Documents and Providers

**Goal:** implement auditable KYC/KYB/AML, document/privacy controls and authenticated provider integrations with safe unknown outcomes.
**Requirements:** COMP-01 through COMP-03, DOC-01, PROV-01 through PROV-03
**Depends on:** Phase 2
**Gate:** G4 — compliance and provider readiness
**Status:** Pending

Success criteria:

1. Identity, UBO, screening, risk, EDD, monitoring and review-expiry evidence is complete.
2. Policy decisions, overrides, suspensions and documents are versioned and access-controlled.
3. Provider webhooks are authenticated, replay-safe, idempotent and reconciled.
4. KYC, payment/bank and custody providers pass certification and outage drills.
5. Unknown outcomes never become fabricated approvals, cash or settlement.

### Phase 5: Contracts and Chain Control Plane

**Goal:** deliver a pinned, conformant permissioned-token stack plus governed signing, deployment, indexing, finality and reorganisation behavior.
**Requirements:** CHAIN-01 through CHAIN-07
**Depends on:** Phases 3 and 4
**Gate:** G5A — exact candidate freeze; G5B — external audit and retest
**Status:** Pending

Success criteria:

1. Official standard/version, interfaces and required behavior are pinned.
2. Identity, claims, compliance, mint, transfer, burn, freeze, force-transfer and recovery invariants pass adversarial tests.
3. Factory, initialization, roles and upgrades are governed without deployer residue.
4. HSM/MPC/KMS signing and durable nonce control replace raw production keys.
5. Receipt, confirmation, finality, replacement, drop and reorganisation states are reliable.
6. ABI, bytecode, source, compiler, addresses and governance match signed manifests.
7. G5A freezes the exact source, dependencies, compiler settings, bytecode, ABI, manifests, threat model and test evidence.
8. G5B requires an external specialist audit of that exact candidate, remediation of every accepted finding, auditor retest and supply/register/ledger reconciliation.

### Phase 6: Primary Issuance and Servicing

**Goal:** prove the complete primary lifecycle from product approval and subscription through reconciled issuance, servicing, redemption and durable receipts.
**Requirements:** LIFE-01 through LIFE-08
**Depends on:** Phases 3, 4 and 5
**Gate:** Golden lifecycle gate
**Status:** Pending

Success criteria:

1. Product approval, eligibility, allocation, payment and issuance use explicit durable states.
2. Cash is provider-confirmed and reconciled before governed mint.
3. Transfers, recovery and force transfer use legal cases, policy and dual control.
4. Distribution/coupon and redemption calculations are deterministic and reconciled.
5. Retry, reversal, return, timeout and exception paths cannot duplicate financial effect.
6. Final receipts tie terms, acceptance, ledger, provider, chain and legal register evidence.

### Phase 7: Public, Investor and Operator Products

**Goal:** deliver accessible product surfaces that expose authoritative state, safe actions and verified commercial claims.
**Requirements:** UX-01 through UX-07, COMM-02
**Depends on:** Phases 2 and 6
**Gate:** G6 — product experience; G7 — commercial readiness
**Status:** Pending

Success criteria:

1. Public trust/legal/conversion experience uses approved claims and working lead capture.
2. Investor qualification, opportunity, subscription, holdings, servicing and redemption journeys are authoritative.
3. Operator compliance, treasury, reconciliation, token, servicing, audit and admin workspaces enforce permissions and maker-checker.
4. Pending, failed, reversed, action-required and final states are clear and recoverable.
5. WCAG 2.2 AA, keyboard, screen-reader, responsive, zoom and performance gates pass.
6. Analytics are privacy-safe and server-authoritative.
7. Customer discovery, pricing validation and pilot enablement use evidence-backed inputs.

### Phase 8: Reporting, Reliability and Operating Model

**Goal:** deliver trusted reporting, private production infrastructure, observability, recovery, runbooks and trained operations.
**Requirements:** REL-02 through REL-05, REP-01, OPS-01 through OPS-03
**Depends on:** Phases 3, 4, 5 and 6
**Gate:** G8 — platform readiness; G9 — operational readiness
**Status:** Pending

Success criteria:

1. Production IaC, networking, workload identity and secrets are private and reproducible.
2. CI/CD blocks failed tests/scans and produces signed SBOM/provenance evidence.
3. Logs, metrics, traces and alerts correlate critical business, financial and chain workflows.
4. Backup, PITR, restore, failover and DR meet approved objectives.
5. Investor, finance, audit and regulatory reports reconcile to authoritative sources.
6. Runbooks, on-call, vendor escalation, reconciliation and period close are owned and rehearsed.

### Phase 9: Integrated Independent Assurance

**Goal:** independently test the exact release across security, finance, contracts, accessibility, performance, recovery and operations.
**Requirements:** ASSURE-01 through ASSURE-08
**Depends on:** Phases 7 and 8
**Gate:** Exact-release assurance
**Status:** Pending

Success criteria:

1. Full automated, cross-tenant and lifecycle adversarial suites pass.
2. Penetration, cloud/IaC and exact-bytecode contract audits are remediated and retested.
3. Financial/reconciliation walkthrough and accessibility/UAT certification pass.
4. Performance, soak, resilience and operational drills meet approved targets.
5. Evidence maps to exact commits, artifacts, environment, schema and bytecode.

### Phase 10: Controlled Paid Pilot

**Goal:** operate one bounded real-value product under daily control-room oversight and prove stability, reconciliation and recovery.
**Requirements:** PILOT-01 through PILOT-08
**Depends on:** Phase 9
**Gate:** Pilot exit
**Status:** Pending

Success criteria:

1. One approved issuer/instrument/jurisdiction/currency/chain operates within signed limits.
2. Daily reconciliation is 100% with no unexplained material break.
3. No duplicate financial effect or false-success state occurs.
4. Required issuance, servicing and redemption/maturity scenarios complete.
5. Provider, reorganisation, restore, failover, key and incident drills pass.
6. Thirty consecutive stable days and customer/domain-owner approvals are recorded.

### Phase 11: Limited Production and Hypercare

**Goal:** make the formal go/no-go decision, enable bounded production, operate hypercare and hand off to steady-state governance.
**Requirements:** LAUNCH-01 through LAUNCH-06
**Depends on:** Phase 10
**Gate:** Production decision
**Status:** Pending

Success criteria:

1. Named executives approve go/no-go and residual risk against the exact evidence pack.
2. Production starts with approved customer, value, asset, currency, chain and provider limits.
3. Hypercare, incident coverage and rollback authority are staffed.
4. Limit increases require evidence and risk approval.
5. Legacy migration/archive/retirement is controlled and recoverable.
6. Steady-state risk, control, operations and product ownership formally accept handoff.

## Historical disposition

- March Phase 1 brand/landing work is historical design evidence and may be reused after validation.
- March Phase 2 public frontend work is prototype implementation and must pass the active production requirements.
- March Phase 7/8 portal plans are retired from execution and must be regenerated after Phase 6 freezes APIs, state machines, authorization and financial truth.
- Earlier readiness-phase artifacts remain historical evidence only.
- Expansion capabilities are not counted in v2.0 completion.

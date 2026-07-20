# BlockXOne v2.0 Production Requirements

**Defined:** 2026-07-19
**Status model:** unchecked until reproducible evidence and required human approval exist
**Active requirements:** 89
**Production phases:** 12

## Requirement rules

- Every active ID maps to exactly one delivery phase and at least one production gate or phase exit.
- A checked requirement needs evidence tied to the exact commit, artifact, schema, environment and bytecode where applicable.
- Prototype UI, narrative documents, unit tests or agent assertions are not sufficient on their own.
- Legal, accounting, AML, custody, external audit and production approvals must name the qualified human owner.
- Expansion capabilities are excluded from v2.0 and require later requirements.

## Phase 0 — Planning Truth and Containment

- [ ] **BASE-01:** PROJECT, REQUIREMENTS, ROADMAP, STATE and GSD analysis agree on milestone, current phase, progress and status.
- [ ] **BASE-02:** Every pre-baseline dirty-worktree path has an owner, category and disposition, with a verified non-secret recovery artifact.
- [ ] **BASE-03:** An approved selective baseline commit and isolated delivery branch/worktree preserve required source and planning evidence.
- [ ] **BASE-04:** A production feature allowlist and no-go register identify disabled demo, marketplace, mock, unsupported and dangerous behavior.
- [ ] **BASE-05:** Production startup rejects mock/dev/default/raw-key/public-document modes and missing critical configuration.
- [ ] **BASE-06:** Build, lint, test, migration, deployment, rollback and toolchain commands are reproducible and fail closed.
- [ ] **BASE-07:** Decision, risk, blocker, control, artifact, approval and evidence registers have owners and version-history policy.

## Phase 1 — Permitted Perimeter and Golden Product

- [ ] **LEGAL-01:** A jurisdiction-specific regulated-activity, licence, responsibility and prohibited-activity matrix is approved.
- [ ] **LEGAL-02:** First jurisdiction, issuer/SPV, investor class, distribution perimeter and currency are approved.
- [ ] **LEGAL-03:** The legal ownership/register model and precedence across token, register, custodian and contractual records are approved.
- [ ] **LEGAL-04:** Custody, safeguarding/client-money, banking, payment and provider responsibility/liability boundaries are approved.
- [ ] **LEGAL-05:** Legal-document, enforceability, accounting, tax, privacy and regulatory-reporting workplans name qualified owners and required opinions.
- [ ] **PROD-01:** One golden instrument has a typed, versioned term schema, lifecycle, disclosures, risks, fees, restrictions and servicing rules.
- [ ] **PROD-02:** Release limits, exclusions, provider responsibilities and product-approval requirements are signed and enforceable.
- [ ] **COMM-01:** ICP, buyer problem, bounded paid-pilot proposition and customer-validation plan are approved without unsupported ROI or liquidity claims.

## Phase 2 — Architecture, Identity and Tenancy

- [ ] **ARCH-01:** Runtime, service boundaries, source-of-truth precedence, workflow, event, evidence and trust architecture are approved.
- [ ] **IAM-01:** Investor identity supports secure email/passkey onboarding, session management, recovery and required MFA.
- [ ] **IAM-02:** Wallet linking uses replay-resistant domain-bound proofs and never substitutes for human/entity eligibility.
- [ ] **IAM-03:** Operator OIDC, machine identity and organisation/issuer/resource assignments are authoritative and revocable.
- [ ] **IAM-04:** Central authorization and database isolation enforce tenant, role, assignment and resource scope across UI, API and data.
- [ ] **IAM-05:** Segregation of duties, maker-checker, privileged reauthentication, break-glass and access-review controls are enforced and audited.
- [ ] **REL-01:** Environment separation, IaC, workload identity, secrets and private service foundations support secure later-phase implementation.

## Phase 3 — Instrument and Financial Core

- [ ] **DOMAIN-01:** A typed common instrument envelope and controlled asset adapters prevent arbitrary metadata from changing legal/economic behavior.
- [ ] **FIN-01:** Immutable double-entry journals and accounts reconstruct balances and enforce debit/credit equality.
- [ ] **FIN-02:** Obligations, cash/token/allocation reservations and capacity constraints prevent duplicate or excessive financial effects.
- [ ] **FIN-03:** Controller-approved posting rules cover subscriptions, issuance, fees, suspense, returns, servicing, redemptions, tax and reversals.
- [ ] **FIN-04:** Bank, payment, custody, chain, legal-register, token-subledger and general-ledger reconciliations have owned material breaks.
- [ ] **FIN-05:** Fixed precision, stable idempotency, concurrency, reversals, accounting periods and balance reconstruction pass adversarial tests.
- [ ] **AUD-01:** Critical mutations couple domain state, financial postings, audit records and reliable outbox events transactionally.

## Phase 4 — Compliance, Documents and Providers

- [ ] **COMP-01:** KYC/KYB, UBO, authority and source-of-funds/wealth evidence has explicit collection, review, expiry and refresh states.
- [ ] **COMP-02:** Screening, PEP/sanctions, risk, EDD, rescreening and transaction monitoring are versioned, evidence-backed and fail closed.
- [ ] **COMP-03:** Policy decisions, reasons, overrides, suspensions, escalation, second approval and review dates are immutable and auditable.
- [ ] **DOC-01:** Documents and acceptance records use secure storage, malware controls, least privilege, retention, privacy, legal hold and version proof.
- [ ] **PROV-01:** Provider adapters authenticate requests/callbacks, prevent replay/duplicates, preserve raw evidence safely and use stable idempotency.
- [ ] **PROV-02:** KYC, bank/payment and custody providers pass due diligence, contracts, certification, sandbox and production-readiness evidence.
- [ ] **PROV-03:** Timeout, unknown outcome, outage, retry, return and provider reconciliation states never fabricate approval, cash or settlement.

## Phase 5 — Contracts and Chain Control Plane

- [ ] **CHAIN-01:** The exact official permissioned-token standard/version, interfaces, compiler, libraries and conformance target are pinned.
- [ ] **CHAIN-02:** Identity, claims, eligibility, compliance, mint, transfer, burn, pause, freeze, force-transfer and recovery invariants are enforced.
- [ ] **CHAIN-03:** Factory, initialization, role handoff, upgrade/migration, multisig, timelock and emergency governance eliminate unintended privilege.
- [ ] **CHAIN-04:** Production signing uses HSM/MPC/KMS policy plus durable signer-specific nonce leasing and unknown-broadcast control.
- [ ] **CHAIN-05:** Indexing and transaction state handle receipt success, confirmation, finality, replacement, drop, revert, replay and reorganisation.
- [ ] **CHAIN-06:** Reproducible bytecode, ABI, source, compiler inputs, addresses, roles and network configuration are captured in signed manifests.
- [ ] **CHAIN-07:** Exact-release independent audit and supply/balance/legal-register/ledger reconciliation pass before deployment approval.

## Phase 6 — Primary Issuance and Servicing

- [ ] **LIFE-01:** Product/offering approval verifies legal, product, accounting, compliance, custody, settlement, documents and servicing readiness.
- [ ] **LIFE-02:** Subscription and allocation enforce eligibility, document acceptance, limits, precision, availability and reservation atomically.
- [ ] **LIFE-03:** Cash matching and reconciliation precede maker-checker mint, finality and legal-register completion.
- [ ] **LIFE-04:** Transfer, force transfer and recovery require authoritative cases, policy, eligible destinations, approvals and final reconciliation.
- [ ] **LIFE-05:** Distribution, dividend or coupon schedules, entitlement, tax, funding, payout, return and correction are deterministic and reconciled.
- [ ] **LIFE-06:** Redemption, amortisation, maturity, call/put and default paths distinguish reservation, payoff, burn, payout, return and recovery.
- [ ] **LIFE-07:** Statements, confirmations, receipts and exports tie terms, acceptance, provider, ledger, chain and register evidence.
- [ ] **LIFE-08:** Duplicate, concurrent, partial, timeout, reversal, retry and exception paths are idempotent, recoverable and observable.

## Phase 7 — Public, Investor and Operator Products

- [ ] **UX-01:** One production design system supports institutional public, investor and dense operator surfaces at WCAG 2.2 AA.
- [ ] **UX-02:** Public trust, legal, security, asset and conversion content uses approved claims and functioning lead capture.
- [ ] **UX-03:** Investor qualification, opportunity, subscription, holdings, documents, servicing and redemption journeys use authoritative workflows.
- [ ] **UX-04:** Operator compliance, treasury, reconciliation, token, servicing, audit and admin workspaces enforce role, scope and maker-checker.
- [ ] **UX-05:** Shared state, timeline, amount, document, approval, exception and receipt components prevent false success and support recovery.
- [ ] **UX-06:** Responsive, mobile, keyboard, screen-reader, zoom, reduced-motion and performance gates pass critical journeys.
- [ ] **UX-07:** Product instrumentation is server-authoritative, pseudonymous, purpose-limited and excludes regulated evidence and secrets.
- [ ] **COMM-02:** Discovery, pricing, diligence, claims, sales stages and pilot enablement are customer-validated and aligned to release limits.

## Phase 8 — Reporting, Reliability and Operating Model

- [ ] **REL-02:** Production IaC, networking, workload identities, secrets, databases and providers are private, reproducible and environment-bound.
- [ ] **REL-03:** CI/CD blocks failed tests/scans and produces signed artifacts, SBOM, provenance, migrations and release records.
- [ ] **REL-04:** Logs, metrics, traces, alerts and correlation cover critical identity, financial, provider, workflow and chain states.
- [ ] **REL-05:** HA, backup, PITR, restore, failover, DR and provider/region contingency meet approved objectives through rehearsals.
- [ ] **REP-01:** Investor, financial, accounting, audit, management and regulatory reports reconcile to authoritative records and versioned terms.
- [ ] **OPS-01:** Runbooks, training, on-call, vendor escalation, access reviews and operational ownership cover every critical service and workflow.
- [ ] **OPS-02:** Daily reconciliation, exception control room, servicing calendar, period close and evidence retention are operated and signed.
- [ ] **OPS-03:** Incident, privacy, breach, complaint, key, provider, chain, migration, wind-down and customer-communication procedures are rehearsed.

## Phase 9 — Integrated Independent Assurance

- [ ] **ASSURE-01:** Full unit, database, integration, workflow, E2E, contract, chain, financial and non-functional suites pass the exact candidate.
- [ ] **ASSURE-02:** Cross-tenant, privilege, replay, duplicate, lifecycle and false-success adversarial scenarios pass.
- [ ] **ASSURE-03:** Independent penetration and cloud/IaC tests are remediated and retested.
- [ ] **ASSURE-04:** Exact-bytecode smart-contract and chain-integration audit is remediated and retested.
- [ ] **ASSURE-05:** Controller/auditor financial-control, posting and reconciliation walkthrough passes.
- [ ] **ASSURE-06:** Accessibility, usability and customer UAT certify critical normal and failure journeys.
- [ ] **ASSURE-07:** Performance, capacity, soak, resilience, backup, failover and incident drills meet approved targets.
- [ ] **ASSURE-08:** Exact-release evidence register is complete and named domain owners sign or explicitly block release.

## Phase 10 — Controlled Paid Pilot

- [ ] **PILOT-01:** Pilot is limited to one approved issuer, instrument, jurisdiction, currency, chain, investor class and signed value limits.
- [ ] **PILOT-02:** Paid pilot, named sponsors, daily control room, stop criteria and expansion conditions are active.
- [ ] **PILOT-03:** Bank, provider, custody, chain, legal register, ledger and GL reconcile 100% every pilot day.
- [ ] **PILOT-04:** No duplicate financial effect, false success or unexplained material break occurs.
- [ ] **PILOT-05:** Required issuance cycles, one servicing event and permitted redemption/maturity scenarios complete with evidence.
- [ ] **PILOT-06:** Provider, reorganisation, restore, failover, key and incident drills pass under pilot conditions.
- [ ] **PILOT-07:** At least 30 consecutive stable days meet all guardrails.
- [ ] **PILOT-08:** Customer and Legal, MLRO, Controller, CISO, Operations and Executive Risk owners approve or reject pilot exit in writing.

## Phase 11 — Limited Production and Hypercare

- [ ] **LAUNCH-01:** Formal go/no-go and residual-risk decision names the exact candidate, evidence and accountable authorities.
- [ ] **LAUNCH-02:** Production enables only approved customer, value, asset, currency, chain, provider and investor limits.
- [ ] **LAUNCH-03:** Hypercare, on-call, incident command, customer support and rollback authority are staffed and tested.
- [ ] **LAUNCH-04:** Limit increases require operating evidence and formal risk approval.
- [ ] **LAUNCH-05:** Legacy migration, archive, access removal and retirement are controlled, reconciled and recoverable.
- [ ] **LAUNCH-06:** Steady-state Product, Risk, Compliance, Finance, Security and Operations accept ownership and cadence.

## Traceability summary

| Phase | Requirement IDs | Count | Gate |
| ---: | --- | ---: | --- |
| 0 | BASE-01..07 | 7 | Phase 0 calibration |
| 1 | LEGAL-01..05, PROD-01..02, COMM-01 | 8 | G1 |
| 2 | ARCH-01, IAM-01..05, REL-01 | 7 | G2 |
| 3 | DOMAIN-01, FIN-01..05, AUD-01 | 7 | G3 |
| 4 | COMP-01..03, DOC-01, PROV-01..03 | 7 | G4 |
| 5 | CHAIN-01..07 | 7 | G5 |
| 6 | LIFE-01..08 | 8 | Golden lifecycle |
| 7 | UX-01..07, COMM-02 | 8 | G6/G7 |
| 8 | REL-02..05, REP-01, OPS-01..03 | 8 | G8/G9 |
| 9 | ASSURE-01..08 | 8 | Exact-release assurance |
| 10 | PILOT-01..08 | 8 | Pilot exit |
| 11 | LAUNCH-01..06 | 6 | Production decision |
| **Total** |  | **89** |  |

## Historical requirement disposition

The March rebuild IDs `STRAT-*`, `UX-*`, `WEB-*`, `IAM-*`, `API-*`, `DATA-*`, `CHAIN-*`, `PROV-*`, `SEC-*` and `REL-*` remain historical evidence inputs only. Their prior completion labels do not satisfy active v2.0 IDs. Reusable outputs must be revalidated against the active requirement and exact gate evidence.

## Out of scope for v2.0

- Public or automated secondary marketplace.
- Retail distribution.
- Cross-border/FX launch.
- Multiple production chains or bridges.
- Unapproved asset classes.
- Guaranteed liquidity or yield.
- Broad DeFi integration.
- Native mobile applications.
- Autonomous waiver of regulated or production gates.

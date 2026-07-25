# BlockXOne Production-Ready Rebuild

## Current delivery authority

**Authoritative delivery repository:** `work/blockxone-functional`

**Authoritative delivery branch:** `codex/functional-platform`

**Execution mode:** checkpointed finite rocks

**Release posture:** production NO-GO

- **Execution contract:** `.planning/CHECKPOINTED-DELIVERY-PLAN.md`, accepted SHA-256 `5443CA4DB90D005DBA6C7AD12060D2A19F039D78FE42F4F4D2BA8D21213CD53D`.
- **GitHub target:** private `GulfBrick/BlockXOne` repository through `origin` at `https://github.com/GulfBrick/BlockXOne.git`.
- **Published R-01 baseline:** `d4f3ccc442871c590cc39ec7967e0bca53739739` on `codex/functional-platform`.
- **Protected default-branch invariant:** GitHub `main` remains unchanged at `df3e1698f28891e7d23489a144eae2733bc8b79d`.
- **Current delivery sequence:** P0-A clean-candidate admission, R-02 completion, R-03 workflow closure, R-04 protected staging, then R-05 production release gates.
- Generation 2, Generation 3, and `docs/BLOCKXONE_AGENT_EXECUTION_LOOP.md` are non-authoritative historical evidence only and must not be executed as the current delivery process.

## What This Is

An evidence-gated rebuild of BlockXOne into a regulated multi-asset tokenization operating system, beginning with one narrowly approved private-market product and expanding only through later product approvals.

## Vision

BlockXOne is a governed multi-asset tokenization operating system for regulated private-market issuance and servicing. It coordinates legal product setup, investor and organisation qualification, subscriptions, reconciled cash settlement, permissioned token issuance, legal-register control, servicing, reporting and redemption.

Blockchain is one controlled subsystem. It does not replace legal ownership, accounting, banking, custody, identity or compliance records.

## Core Value

BlockXOne enables institutions to launch and operate approved tokenized private-market products through one evidence-rich workflow while giving eligible investors a clear, accessible path from qualification through final settlement and servicing.

## Production objective

Deliver one legally permitted, financially reconcilable and operationally defensible real-value product, then expand through new separately approved milestones.

The first production milestone is complete only after independent assurance, a bounded paid pilot, 30 stable days, complete daily reconciliation and named human go-live approval.

## Product surfaces

### Public trust and education site

- Explain supported outcomes without crypto speculation.
- State regulatory, legal, custody and product boundaries precisely.
- Provide trust, security, legal and privacy evidence.
- Capture qualified design-partner and demo enquiries.

### Investor portal

- Identity, MFA/passkey and optional wallet linking.
- KYC/KYB evidence and action-required recovery.
- Approved opportunities, terms, risks and documents.
- Subscription, funding, allocation, issuance and final receipts.
- Holdings, statements, servicing and controlled redemption.

### Operator console

- Organisations, issuers, products and offerings.
- Compliance cases and evidence.
- Subscription, allocation, cash and reconciliation.
- Governed token/register operations.
- Servicing, corporate actions, reporting and audit.
- Users, roles, assignments, providers and environment controls.

## Launch perimeter

Accepted technical planning defaults, all subject to the still-pending G1, G2, G3 and G5 professional gates:

- South African private debt as the first jurisdiction/instrument perimeter;
- one issuer or issuing SPV;
- professional/institutional/otherwise eligible investors;
- ZAR settlement;
- AWS `af-south-1` as the infrastructure planning region;
- Polygon PoS mainnet (chain 137) and Amoy testnet as the chain planning targets;
- a modular Go domain backend with PostgreSQL-native durable workflow, financial, audit and reconciliation state;
- two-track demo/production delivery with synthetic, visibly labelled demo behavior isolated from fail-closed production behavior;
- one KYC/KYB provider;
- one bank/payment route;
- no client-fund or client-asset custody by BlockXOne; any external bank, custodian or signing model remains professionally selected and approved;
- T-REX 4.1.3 as a reference/hardened-derivative direction only, contingent on a proprietary licence and the required Legal, Registrar, MLRO, CISO, Blockchain, Custody, Risk and external-audit approvals;
- primary subscription, issuance, servicing, reporting and controlled redemption.

Explicit release-one exclusions:

- retail distribution;
- public secondary trading or matching;
- guaranteed liquidity;
- cross-border distribution;
- FX;
- multi-chain or bridge flows;
- unsupported asset classes;
- uncontrolled self-custody;
- DeFi composability;
- anonymous or compliance-avoidant participation.

These are implementation-planning boundaries, not legal conclusions, provider approvals, custody authority, G1/G2/G3/G5 closure or production authorization. No secondary market in release one is permitted.

## Non-negotiable invariants

1. Multi-asset architecture does not imply multi-asset approval.
2. Identity is not a wallet.
3. Legal register, bank, provider, custodian, ledger and finalized chain remain distinct sources reconciled by policy.
4. Every financial effect is fixed-precision, balanced, idempotent, reserved, reversible by counter-entry and reconcilable.
5. Unknown provider or chain outcomes remain unknown until proven.
6. UI and API never fabricate finality.
7. Tenant and resource authorization is enforced in API and data layers, not only routes or UI.
8. Critical actions use segregation of duties and appropriate step-up authentication.
9. Mocks, debug modes, raw production keys and default credentials fail closed outside explicitly isolated development environments.
10. Evidence maps to exact commit, artifact, schema, environment and bytecode.
11. Builders cannot verify or approve their own work.
12. Agents prepare regulated decisions but do not replace Legal, MLRO, Controller, Tax, external audit or Executive Risk authority.

## Primary users

- Issuer or asset-manager executive.
- Product/issuance operations.
- Compliance analyst and MLRO.
- Finance, Controller and Treasury.
- Transfer/tokenization agent.
- Platform and security administration.
- Professional/institutional investor.
- Auditor, counsel and risk reviewer.

## Target architecture direction

- TypeScript public/investor/operator web product with Next.js limited to the UI/BFF boundary.
- Strongly modular Go domain services; separate deployment is introduced only where scale or assurance boundaries justify it.
- PostgreSQL-native durable workflow orchestration and canonical business, financial, audit and reconciliation records; workflow transitions, timers, claims and accepted source events remain transactionally bound to the database.
- Immutable double-entry subledger with obligations and reservations.
- Transactional audit and reliable outbox.
- Permissioned EVM token stack tied to a pinned standard and signed deployment manifests.
- HSM/MPC/KMS signing with durable nonce and policy enforcement.
- Independent finality/reorganisation-aware indexer.
- Provider adapters with authenticated callbacks and reconciliation.
- Private reproducible infrastructure, signed releases, observability, backup and DR.

## Source-of-truth order

1. Approved professional and governance decisions.
2. `.planning/CHECKPOINTED-DELIVERY-PLAN.md` for current delivery scope, branch, rock and stop conditions.
3. Production master plan and active requirements for the downstream production-control perimeter.
4. Phase context, plans, controls and ADRs that do not conflict with the checkpoint plan.
5. Exact code, tests, migrations and deployment manifests.
6. Reproducible evidence and external assurance.
7. Historical Generation 2/Generation 3/controlled-loop material is evidence only.
8. Agent messages are coordination only and never authoritative by themselves.

## Execution model

Use `.planning/CHECKPOINTED-DELIVERY-PLAN.md`. Each finite rock has a fixed scope, visible outcome, executable evidence, explicit stop and checkpoint handoff. A failed check stops the rock with its evidence; it cannot be converted into a pass or an unbounded retry loop.

The superseded `docs/BLOCKXONE_AGENT_EXECUTION_LOOP.md` remains historical only. Independent technical review may be required by a rock, but agents cannot supply legal, financial, custody, provider, mainnet, real-money, migration, external-audit or go-live approval.

## Success definition

BlockXOne is production-ready only when all active requirements have reproducible evidence, G1-G9 and exact-release assurance pass, the bounded pilot meets its exit criteria, and authorized domain owners issue an explicit production decision.

Passing builds, unit tests or a testnet deployment alone are not production readiness.

## Requirements

The authoritative active catalogue is `.planning/REQUIREMENTS.md`: 89 requirements mapped across 12 dependency-gated phases. Earlier March requirement IDs are historical evidence inputs and do not count toward v2.0 completion.

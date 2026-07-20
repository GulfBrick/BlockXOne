# BlockXOne Production-Ready Rebuild

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

Recommended planning defaults, subject to qualified approval:

- one jurisdiction, initially assumed South Africa;
- one issuer or issuing SPV;
- one approved private debt note or closed-ended fund interest;
- professional/institutional/otherwise eligible investors;
- ZAR settlement;
- one EVM network;
- one KYC/KYB provider;
- one bank/payment route;
- one approved custody/signing model;
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

- TypeScript-first public/investor/operator web product.
- Dedicated domain services and durable workflow orchestration; Next.js is not the sole backend.
- PostgreSQL for canonical business, workflow, financial, audit and reconciliation records.
- Immutable double-entry subledger with obligations and reservations.
- Transactional audit and reliable outbox.
- Permissioned EVM token stack tied to a pinned standard and signed deployment manifests.
- HSM/MPC/KMS signing with durable nonce and policy enforcement.
- Independent finality/reorganisation-aware indexer.
- Provider adapters with authenticated callbacks and reconciliation.
- Private reproducible infrastructure, signed releases, observability, backup and DR.

## Source-of-truth order

1. Approved professional and governance decisions.
2. Production master plan and active requirements.
3. Phase context, plans, controls and ADRs.
4. Exact code, tests, migrations and deployment manifests.
5. Reproducible evidence and external assurance.
6. Agent messages are coordination only and never authoritative by themselves.

## Execution model

Use `docs/BLOCKXONE_AGENT_EXECUTION_LOOP.md`:

- one persistent Program Controller;
- one bounded builder by default;
- one independent verifier;
- one rotating domain adversarial reviewer;
- maximum two repair cycles;
- one production phase active at a time;
- explicit human gates for legal, financial, custody, provider, mainnet, real-money, migration and go-live decisions.

## Success definition

BlockXOne is production-ready only when all active requirements have reproducible evidence, G1-G9 and exact-release assurance pass, the bounded pilot meets its exit criteria, and authorized domain owners issue an explicit production decision.

Passing builds, unit tests or a testnet deployment alone are not production readiness.

## Requirements

The authoritative active catalogue is `.planning/REQUIREMENTS.md`: 89 requirements mapped across 12 dependency-gated phases. Earlier March requirement IDs are historical evidence inputs and do not count toward v2.0 completion.

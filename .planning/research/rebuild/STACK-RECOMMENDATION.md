# BlockXOne Stack Recommendation

**Date:** 2026-03-29
**Decision:** recommend a TypeScript-first rebuild for frontend, BFF, API, and indexing; use Solidity plus Foundry for contracts

## Executive Recommendation

### Recommended target stack

- **Monorepo:** `pnpm` + Turborepo
- **Public site and portals:** Next.js 16 + React 19 + TypeScript
- **UI system:** Tailwind CSS v4 + shadcn/ui + Motion
- **Investor web3 client:** `viem` + `wagmi`
- **Investor identity:** Privy
- **Operator identity:** Auth0 Organizations with RBAC
- **Backend services:** NestJS + TypeScript
- **Database:** PostgreSQL
- **Cache/session acceleration:** Redis
- **Workflow orchestration:** Temporal or equivalent durable workflow engine
- **Contracts:** Solidity + Foundry + OpenZeppelin
- **On-chain indexing:** Envio HyperIndex or equivalent dedicated indexer
- **Object and document storage:** S3-compatible storage
- **Infra target:** AWS-first deployment model

## Why This Stack

### 1. TypeScript-first is the strongest fit for modern web3 applications

The current web3 ecosystem gravity is around:
- Next.js
- React
- viem
- wagmi
- wallet and embedded-auth SDKs
- TypeScript-based indexers and orchestration tooling

For a fresh rebuild, aligning frontend, BFF, API contracts, and indexing around TypeScript reduces translation friction and increases delivery speed.

### 2. Next.js is the right frontend and BFF layer, but not the whole backend

Next.js now explicitly supports the backend-for-frontend pattern through route handlers and proxy features, but its own docs also state that these capabilities are not a full backend replacement.

That is exactly the right split for BlockXOne:
- use Next.js for public content, session-aware UI edges, and BFF-style request shaping
- use dedicated backend services for core domain logic, provider integrations, and workflow execution

### 3. NestJS is the best rebuild backend for this use case

This is an inference based on the product shape, not a direct vendor claim.

Why NestJS over the current Go API for a fresh rebuild:
- it fits a TypeScript-first monorepo
- it has clean module boundaries for identity, assets, orders, workflows, and providers
- it plays well with modern auth SDKs and shared types
- it is easier to keep aligned with the frontend and indexer layers than a split-language rewrite

### 4. Solidity plus Foundry is the right contract toolchain

Foundry now has strong guidance and first-class support for invariant testing, multi-chain deployment patterns, and modern upgrade workflows. For BlockXOne that matters because access control, supply invariants, eligibility rules, and admin operations must be tested aggressively.

### 5. OpenZeppelin remains the default contract foundation

OpenZeppelin stays the practical default for:
- role-based access control
- pausability
- upgrade safety
- audited primitives

### 6. Use a dedicated indexer, not ad hoc polling

A tokenization platform needs:
- holdings views
- transaction history
- portfolio projections
- reconciliation between business state and chain state

That means BlockXOne needs a real indexing subsystem, not direct chain reads from the app alone.

## Identity Recommendation

### Investor identity

Recommended: **Privy**

Why:
- supports email, SMS, passkeys, OAuth, and external wallets
- supports linking multiple account types to one user
- supports MFA for higher-value wallet actions
- issues access tokens usable by the backend

This fits a regulated investor product better than a wallet-only login pattern.

### Operator identity

Recommended: **Auth0 Organizations + RBAC**

Why:
- organization-aware roles map naturally to issuer, compliance, admin, and servicing teams
- RBAC support is explicit and mature
- machine-to-machine patterns and privileged APIs are well understood

If BlockXOne later requires fully self-hosted enterprise identity, Keycloak is the fallback option, but Auth0 is the recommended speed-to-market path.

## Contract Recommendation

### Standard strategy

Recommended launch baseline:
- **ERC-3643-style permissioned token architecture** for regulated fungible instruments
- **OpenZeppelin role and upgrade primitives**
- **Safe-based treasury and admin controls** for multisig governance

Rationale:
- stronger transfer control and identity alignment than a plain ERC-20
- better fit for funds, debt, and similar regulated assets
- better operator safety

### Transaction UX strategy

Recommended:
- support standard wallets via `wagmi` and `viem`
- use smart-account or relayed-transaction patterns selectively for investors after core flows are working
- do not make account abstraction a prerequisite for launch

## Indexing Recommendation

Recommended: **Envio HyperIndex** as the primary evaluation target for the rebuild.

Why:
- purpose-built for on-chain data
- clear product focus on fast indexing
- keeps chain state ingestion as its own subsystem

If the team later prefers a lighter self-hosted path, Ponder is a valid alternative to evaluate during implementation.

## Infrastructure Recommendation

Recommended target:
- AWS
- RDS PostgreSQL
- ElastiCache Redis
- S3
- CloudFront
- WAF
- ECS Fargate or EKS depending on team ops maturity
- Temporal Cloud or self-hosted Temporal depending compliance constraints

This is an inference based on enterprise and regulated-app requirements rather than a single external source.

## What Not To Do

- Do not keep one mixed login for investors and operators.
- Do not use Next.js route handlers as the only backend.
- Do not keep Hardhat as the primary contract toolchain if starting fresh.
- Do not make wallet login the only identity model.
- Do not rely on direct chain calls from UI components for reporting and reconciliation.

## Source Anchors

- Next.js authentication and BFF guidance: https://nextjs.org/docs/app/guides/authentication and https://nextjs.org/docs/app/guides/backend-for-frontend
- Tailwind CSS v4: https://tailwindcss.com/blog/tailwindcss-v4
- shadcn/ui monorepo docs: https://ui.shadcn.com/docs/monorepo
- Privy auth docs: https://docs.privy.io/authentication/user-authentication/privy-auth
- Auth0 B2B authorization docs: https://auth0.com/docs/get-started/architecture-scenarios/business-to-business/authorization
- Reown AppKit overview: https://docs.reown.com/appkit/overview
- Foundry invariant testing guide: https://www.getfoundry.sh/guides/invariant-testing
- OpenZeppelin upgrade and role-management docs: https://docs.openzeppelin.com/upgrades-plugins/foundry-upgrades and https://docs.openzeppelin.com/contracts/
- Envio docs: https://docs.envio.dev/

## Inference Notes

- The TypeScript-first recommendation is my synthesis from the current state of the web3 tooling ecosystem and the needs of this product.
- NestJS, AWS, and Temporal are recommended architectural fits, not direct claims from the cited docs.

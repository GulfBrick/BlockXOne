# BlockXOne Rebuild Decision Pack

**Date:** 2026-03-30
**Purpose:** refresh the rebuild research with current-source verification before architecture or UI execution continues

## Executive Position

BlockXOne should be planned as a regulated multi-asset tokenization operating system with three product surfaces:

1. public trust and education site
2. investor portal
3. operator console

That conclusion still holds after the 2026-03-30 research refresh.

The important refinement is this:

- tokenization is not primarily a wallet problem
- it is not primarily a contract problem either
- it is a lifecycle orchestration problem wrapped around controlled tokens

The practical consequence is that the rebuild should optimize for:

- identity and qualification
- workflow durability
- role separation
- auditability
- controlled token operations
- investor clarity

## Source-Backed Market And Product Signals

### 1. Tokenization has moved from pure pilot language into operational design language

The World Economic Forum report published on **21 May 2025** frames tokenization as a new model of digital ownership with benefits such as transparency, efficiency, and accessibility, but also highlights the real blockers: legacy infrastructure, regulatory fragmentation, limited interoperability, and liquidity constraints.

Planning implication for BlockXOne:

- the product cannot be framed as a generic "web3 app"
- it needs explicit market design, settlement, ledger, and workflow choices

### 2. The strongest live product pattern is still split servicing app plus investor app

Tokeny's current product documentation still separates:

- a **Servicing App** for issuers and agents
- an **Investor App** for discovery, qualification, subscription, holdings, and transfer

This is one of the strongest product-pattern validations for the BlockXOne public versus investor versus operator split.

Planning implication for BlockXOne:

- investor and operator are not just different nav states
- they are structurally different products with different density, tone, and first-run workflows

### 3. Real tokenization platforms still center on qualification, distribution, and servicing

Tokeny's investor and servicing docs emphasize:

- qualification before investment
- subscription order creation
- document signing
- payment or settlement handling
- token minting after approval
- portfolio management
- controlled secondary activity

Planning implication for BlockXOne:

- the MVP should not be organized around "connect wallet and buy token"
- it should be organized around qualification, order, settlement, holding, and servicing

## Standards Research

### ERC-3643 remains the strongest launch baseline

The official ERC-3643 EIP still encodes the exact behaviors that matter for BlockXOne's launch scope:

- verified identity checks
- compliance transfer checks
- freezing
- controlled transfers

That is still a stronger fit than a plain ERC-20 for regulated private-market assets.

Planning implication for BlockXOne:

- launch architecture should be ERC-3643-style permissioned fungible tokenization
- do not design the core product around plain ERC-20 assumptions

### ERC-4361 is useful, but only as one identity factor

The official ERC-4361 spec standardizes Sign-In with Ethereum. It is still useful for wallet-based authentication, but it should not be treated as the whole identity model for a regulated platform.

Planning implication for BlockXOne:

- use SIWE when wallet identity is useful
- do not force wallet login to be the first or only investor identity mechanism
- do not use wallet-based auth for privileged operator identity

### ERC-4337 is strategically relevant, but not required for day one

ERC-4337 remains important because it enables smart-account patterns and better UX around sponsored transactions and programmable account behavior.

But current docs still show that it adds implementation complexity and account-model constraints.

Planning implication for BlockXOne:

- design the platform so smart-account or sponsored-transaction UX can be added
- do not make account abstraction the prerequisite for launch

## Identity Research

### Next.js guidance still points away from custom auth

The official Next.js App Router auth guide, last updated **25 March 2026**, explicitly recommends using an authentication library rather than hand-rolling auth for production.

Planning implication for BlockXOne:

- the current repo-local transitional auth should not be promoted into the rebuild standard
- identity should be delegated to purpose-built providers

### Investor identity: Privy remains a strong fit

Current Privy docs still support:

- email or SMS passwordless login
- passkeys
- social login
- wallet login
- MFA for wallet-sensitive actions
- a single user object across linked accounts
- backend-verifiable access tokens

Planning implication for BlockXOne:

- investor onboarding can start with email or passkey
- wallet can be linked after identity is established
- higher-risk wallet actions can add MFA

This is a strong fit for an investor portal that must feel more like digital private banking than a crypto wallet gateway.

### Operator identity: Auth0 Organizations remains a strong fit

Current Auth0 Organizations docs still emphasize:

- B2B implementations
- branded federated login flows per organization
- organization-specific roles
- machine-to-machine access in the scope of organizations

Planning implication for BlockXOne:

- operator identity should be modeled as B2B organization-aware access
- roles should attach to organization membership
- M2M support matters for provider and admin automation later

## Workflow And Backend Research

### Durable execution is not optional for this product

Temporal still describes its core value as "crash-proof execution" that resumes after crashes, outages, or delays. That maps directly onto tokenization workflows:

- onboarding
- KYC review
- subscription approval
- payment reconciliation
- token issuance
- redemption
- distributions

Planning implication for BlockXOne:

- long-running workflows should use a durable orchestration engine
- state-machine logic should not be scattered through controllers and ad hoc jobs

## Frontend And Web3 Stack Research

### Next.js remains correct for the public/BFF layer

Current Next.js docs still support the BFF pattern and modern auth flows. That keeps it a good choice for:

- public site
- investor portal UI
- operator console UI
- edge-aware request shaping
- session-aware route protection

Planning implication for BlockXOne:

- Next.js should remain the frontend platform
- it should not become the only backend

### viem plus wagmi remains the right wallet client combination

Current official docs still position:

- `viem` as the low-level wallet and chain client layer
- `wagmi` as the React connectivity and state layer

Planning implication for BlockXOne:

- use `viem` and `wagmi` for investor-facing wallet interactions
- avoid mixing older ethers-first assumptions into the rebuilt UI

## Contract And Indexing Research

### Foundry is still the correct contract toolchain

Current Foundry docs and release notes continue to strengthen the case:

- invariant testing remains first-class
- access-control invariants are an explicit testing pattern
- recent releases improved fuzzing and deep test performance

Planning implication for BlockXOne:

- contract development should use Foundry
- invariants should cover solvency, access control, supply, and transfer restrictions

### OpenZeppelin is still the default access-control foundation

Current OpenZeppelin access docs continue to position:

- `AccessControl`
- `AccessManager`
- managed hierarchical roles

as the standard way to enforce contract authorization.

Planning implication for BlockXOne:

- use OpenZeppelin access patterns as the baseline
- avoid hand-rolled admin systems for token and treasury contracts

### Dedicated indexing is still required

Envio's current docs still position HyperIndex as a dedicated on-chain indexing product.
Ponder also remains a credible open-source TypeScript indexing framework.

Planning implication for BlockXOne:

- chain data should be indexed in a dedicated subsystem
- do not rely on direct UI chain reads for reporting or holdings reconciliation

## UI And Product Architecture Research

### Public site

The public site should do five things:

1. explain tokenization clearly
2. explain what BlockXOne actually does
3. explain supported launch asset classes
4. explain operator and investor entry paths
5. convert interest into demo or login intent

### Investor portal

Research-backed pattern:

- qualification first
- subscription workflow second
- portfolio and documents always visible
- transfer and redemption as controlled lifecycle actions

Recommended top-level investor information architecture:

- Home
- Qualification
- Opportunities
- Orders
- Portfolio
- Documents
- Redemptions
- Settings

### Operator console

Research-backed pattern:

- servicing dashboard
- compliance queues
- asset setup
- token controls
- reporting
- audit

Recommended top-level operator information architecture:

- Dashboard
- Assets
- Compliance
- Subscriptions
- Redemptions
- Treasury
- Token Operations
- Reports
- Audit
- Admin

## Recommended Decisions For Discussion

These are recommendations, not locked decisions.

### 1. Launch wedge

Recommend:

- launch around regulated funds and adjacent private-credit structures first

Why:

- it aligns with the current repo surface
- it aligns with current tokenization product patterns
- it keeps the multi-asset story intact without overextending launch scope

### 2. Product split

Recommend:

- public site
- investor portal
- operator console

not a single app with mixed-role entry and mixed-role first-run states

### 3. Identity

Recommend:

- investor: Privy-centered auth with email or passkey first and wallet linking second
- operator: Auth0 Organizations with organization-scoped roles

### 4. Backend architecture

Recommend:

- Next.js for public and portal UI
- dedicated backend services for domain logic
- durable workflows for long-running operational processes
- dedicated indexer for chain state

### 5. Contract architecture

Recommend:

- ERC-3643-style permissioned fungible token design
- OpenZeppelin access-control base
- Foundry for testing and deployment workflows

## Hard Questions Still Open

These are the decisions the research does not answer on its own:

1. Which exact launch asset class is first?
2. Which jurisdictions are in scope at launch?
3. Is the operator product sold to issuers, fund managers, platform operators, or all three?
4. Will investors ever need self-custodial-only operation, or is hybrid wallet abstraction acceptable?
5. Should the rebuild stay inside this repo or move to a new monorepo/app layout?

## Sources

- World Economic Forum, **Asset Tokenization in Financial Markets**, published **21 May 2025**: https://www.weforum.org/reports/asset-tokenization-in-financial-markets-the-next-generation-of-value-exchange
- ERC-3643: https://eips.ethereum.org/EIPS/eip-3643
- ERC-4361: https://eips.ethereum.org/EIPS/eip-4361
- ERC-4337: https://eips.ethereum.org/EIPS/eip-4337
- Next.js App Router authentication guide, updated **25 March 2026**: https://nextjs.org/docs/app/guides/authentication
- Privy auth docs: https://docs.privy.io/authentication/user-authentication/privy-auth
- Auth0 Organizations docs: https://auth0.com/docs/manage-users/organizations
- Auth0 RBAC docs: https://auth0.com/docs/manage-users/access-control/rbac
- Temporal docs: https://docs.temporal.io/
- Viem wallet client docs: https://viem.sh/docs/clients/wallet
- Wagmi official site and docs: https://wagmi.sh/
- Foundry invariant testing guide: https://www.getfoundry.sh/guides/invariant-testing
- OpenZeppelin access docs: https://docs.openzeppelin.com/contracts/api/access
- Envio docs: https://docs.envio.dev/
- Tokeny Servicing App docs: https://docs.tokeny.com/docs/servicing-app
- Tokeny Investor App docs: https://docs.tokeny.com/docs/investor-app
- Tokeny onboarding docs: https://docs.tokeny.com/docs/onboard-investors
- Tokeny qualification docs: https://docs.tokeny.com/docs/qualify-investors
- Securitize official site: https://securitize.io/
- Deloitte 2025 financial services predictions press release: https://www.deloitte.com/us/en/about/press-room/deloitte-releases-2025-financial-services-industry-predictions-report.html
- BCG 2025 payments report snippet on tokenized RWAs: https://web-assets.bcg.com/25/91/2269153c468ca43684442f055cb0/2025-global-payments-report-sep-2025.pdf

## Inference Notes

- The investor-versus-operator split, Privy plus Auth0 combination, and recommended launch wedge are my synthesis from the sources above and the current BlockXOne repo shape.
- The sources validate the product pattern and technical direction. They do not, on their own, choose BlockXOne's exact go-to-market scope. That still needs product discussion.

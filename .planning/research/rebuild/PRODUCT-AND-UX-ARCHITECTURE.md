# BlockXOne Product And UX Architecture

**Date:** 2026-03-29
**Purpose:** define how BlockXOne should look, feel, and route as a rebuilt multi-asset tokenization platform

## Product Surface Model

BlockXOne should be three surfaces, not one:

### 1. Public surface

Purpose:
- explain what BlockXOne is
- explain tokenization simply
- show supported asset classes
- establish trust
- route users to the correct product path

Primary routes:
- `/`
- `/how-it-works`
- `/asset-classes`
- `/for-investors`
- `/for-operators`
- `/security-and-compliance`
- `/request-demo`
- `/investor/login`
- `/operator/login`

### 2. Investor portal

Purpose:
- onboarding
- qualification and wallet linking
- discovery
- subscription
- portfolio and reporting
- redemption and document access

Primary routes:
- `/investor/login`
- `/investor/onboarding`
- `/investor/qualification`
- `/investor/market`
- `/investor/assets/[slug]`
- `/investor/portfolio`
- `/investor/orders`
- `/investor/documents`
- `/investor/redemptions`
- `/investor/settings`

### 3. Operator console

Purpose:
- asset creation
- compliance review
- subscription and redemption operations
- token controls
- treasury and servicing
- audit and platform administration

Primary routes:
- `/operator/login`
- `/operator/dashboard`
- `/operator/assets`
- `/operator/compliance`
- `/operator/subscriptions`
- `/operator/redemptions`
- `/operator/treasury`
- `/operator/token-ops`
- `/operator/reports`
- `/operator/audit`
- `/operator/admin`

## Landing Page Architecture

The landing page must explain the product before it asks for a login.

### Recommended section order

1. **Hero**
   - Headline: multi-asset tokenization operating system
   - Subhead: who it serves and what it solves
   - CTAs: `Request demo`, `Investor portal`, `Operator login`
2. **What tokenization means**
   - simple lifecycle diagram
   - off-chain plus on-chain explanation
3. **Supported asset classes**
   - funds
   - debt
   - private equity and SPV interests
   - real-estate vehicles
   - stable-value or treasury-style products
4. **How BlockXOne works**
   - structure
   - onboard
   - subscribe
   - issue
   - service
   - redeem or transfer
5. **Built for institutions**
   - compliance
   - audit
   - governance
   - servicing
6. **Investor experience**
   - onboarding
   - marketplace
   - holdings
   - documents
7. **Operator experience**
   - issuance
   - compliance queue
   - token controls
   - reporting
8. **Trust and controls**
   - identity
   - transfer rules
   - audit
   - operational visibility
9. **Final CTA**
   - request demo
   - investor login
   - operator login

## UX Rules

### Public rules

- Never send users to a mixed login page from the hero.
- Public CTAs must identify the audience explicitly.
- The site should explain the product before it asks for credentials.

### Investor rules

- Default to clarity and trust over crypto-native jargon.
- Wallet connection is optional and contextual, not the first screen.
- Portfolio, documents, and qualification status must be visible at a glance.

### Operator rules

- Density is acceptable, confusion is not.
- Tables, queues, status chips, and audit traces are core UX primitives.
- High-risk actions must have deliberate confirmation and traceability.

## Visual Direction

### Preserve

- BlockXOne logo mark
- dark graphite background direction
- cyan and blue electric accent family
- geometric, hexagonal, precision-oriented motif

### Improve

- replace generic crypto hero video dependence with structured messaging and stronger layout
- remove emoji and gimmicky trust badges
- introduce a more intentional type system
- make the visual language feel institutional, not hackathon-like

## Recommended Design System

### Color system

Use the current palette as the base:
- background: `#0B0F1A`
- surface: `#111827`
- surface-secondary: `#161F36`
- accent-primary: `#3B82F6`
- accent-info: `#06B6D4`
- text-primary: `#F9FAFB`
- text-secondary: `#9CA3AF`

Add a stricter semantic token system for:
- success
- warning
- danger
- info
- audit or neutral

### Typography

Recommended pairings:
- display: `Sora`
- body: `IBM Plex Sans`
- data and ledger values: `JetBrains Mono`

Rationale:
- Sora gives the public surface a distinctive but controlled futuristic feel
- IBM Plex Sans keeps dense operator interfaces readable
- JetBrains Mono fits audit and transaction data

### Motion

- use subtle reveal motion on public sections
- use fast, functional transitions in app surfaces
- avoid decorative floating effects as a primary identity device
- always respect reduced motion

## Layout Model

### Public site

- wide editorial layout
- clear narrative blocks
- diagram-led explanation
- strong CTA split between investor and operator

### Investor portal

- top nav plus contextual side panels on desktop
- mobile-first card stack for holdings and workflows
- lightweight notifications and status banners

### Operator console

- persistent left sidebar
- command bar
- dense tables
- split detail drawers
- audit ribbon or event timeline for high-risk workflows

## Immediate UX Conclusions

1. The current `/login` page should be retired from public use.
2. The first public deliverable is a real landing page, not a video plus login shortcut.
3. The rebuild should likely use separate route groups or separate apps for public, investor, and operator surfaces.
4. The current BlockXOne visual identity is worth keeping, but the copy hierarchy and layout need a full reset.

## Source Anchors

- BlockXOne local design tokens and logo assets in the repo
- UI/UX Pro Max skill guidance used for accessibility, hierarchy, layout, and design-system choices
- Tokeny servicing and investor app structure: https://docs.tokeny.com/docs/t-rex-platform

## Inference Notes

- The route model, typography pairing, and public-section structure are my recommendations for BlockXOne based on the current repo, the preserved brand system, and current tokenization product patterns.

---
phase: "07"
name: "investor-portal-mvp"
created: 2026-03-30
---

# Phase 7: Investor Portal MVP - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning
**Mode:** Derived from live route audit, current landing and auth split, route inventory, and UI UX Pro Max guidance

<domain>
## Phase Boundary

Turn the current investor area into a trustworthy product for onboarding, qualification, asset discovery, subscription, portfolio, documents, and redemption.

</domain>

<decisions>
## Implementation Decisions

### Product Strategy
- Investor login, signup, and first-run onboarding stay on the investor surface only.
- The first authenticated investor destination should be a portfolio and qualification cockpit, not a generic dashboard or a mixed-role screen.
- Wallet linking is additive. It should support trading, transfer, or signature-heavy actions, but it must not be the product's identity model.

### UX Direction
- The investor portal should feel calmer, clearer, and more guided than the operator product.
- The investor home should explain current status first:
  - qualification state
  - wallet readiness
  - portfolio value
  - available actions
- Asset discovery, order progress, and redemption should read like regulated financial workflows, not crypto-native toy flows.

### Verification Focus
- Verify investor login, signup, session restore, qualification flow, market browsing, portfolio visibility, and wallet-linking prompts.
- Treat ambiguous copy, missing status context, and dead-end workflow screens as product defects.

</decisions>

<code_context>
## Existing Code Insights

### Current Investor Routes
- `apps/web/src/app/investor/login/page.tsx`
- `apps/web/src/app/investor/register/page.tsx`
- `apps/web/src/app/investor/kyc/page.tsx`
- `apps/web/src/app/investor/market/page.tsx`
- `apps/web/src/app/investor/funds/[id]/page.tsx`
- `apps/web/src/app/investor/orders/page.tsx`
- `apps/web/src/app/investor/portfolio/page.tsx`
- `apps/web/src/app/investor/p2p/page.tsx`

### Reusable Foundations
- `apps/web/src/lib/auth-context-v2.tsx`
- `apps/web/src/lib/role-routing.ts`
- `apps/web/src/components/layout-wrapper.tsx`
- `apps/web/src/components/auth/EmailLoginForm.tsx`
- `apps/web/src/components/wallet/WalletWidget.tsx`

### Current Defects
- Investor pages use inconsistent layout language and card composition.
- Qualification and portfolio state are not framed as one investor story.
- Some pages still read like internal demos rather than a client-facing portal.
- The current investor default route historically pointed to KYC instead of a true home cockpit.

</code_context>

<specifics>
## Specific Ideas

- Create one investor workspace language with:
  - summary hero
  - qualification banner
  - portfolio metrics
  - open actions
  - document and order visibility
- Split investor navigation into:
  - Home
  - Qualification
  - Opportunities
  - Orders
  - Portfolio
  - Redemptions
- Use plain status language such as:
  - identity review pending
  - wallet linked
  - subscription awaiting payment
  - redemption in review

</specifics>

<deferred>
## Deferred Ideas

- Native investor mobile app
- Social or community features
- Advanced self-custody flows beyond launch needs

</deferred>

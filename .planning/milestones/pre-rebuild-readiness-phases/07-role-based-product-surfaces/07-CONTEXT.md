---
phase: "07"
name: "role-based-product-surfaces"
created: 2026-03-29
---

# Phase 7: Role-Based Product Surfaces - Context

**Gathered:** 2026-03-29
**Status:** Ready for planning
**Mode:** Derived from route inventory, auth-flow inspection, UI shell review, and UI UX Pro Max guidance

<domain>
## Phase Boundary

Turn the current mixed public and auth web experience into explicit investor and operator product surfaces, then verify role journeys against the live `blockxone` backend.

</domain>

<decisions>
## Implementation Decisions

### Product Surface Strategy
- Treat `Investor` as the public-facing product surface with signup, wallet or email login, onboarding, KYC, market, portfolio, and order flows.
- Treat `Operator` as the staff surface for admin, compliance, issuer, tokenisation-agent, and wealth-manager roles, with a separate login and a denser operational shell.
- Keep one backend and shared auth model where reasonable, but stop mixing investor signup and privileged staff access inside one login screen.

### UI/UX Direction
- Use an enterprise gateway landing pattern that routes users clearly to investor or operator entry points.
- Use a calmer guided shell for investor journeys and a data-dense dashboard shell for operator journeys.
- Replace mixed visual language and emoji icon shortcuts with consistent SVG-based components, semantic tokens, and explicit state messaging.

### Verification Focus
- Verify routing, redirect, session, and permission behavior across both surfaces against the live backend.
- Treat structural UX defects that create role ambiguity or auth confusion as production defects, not polish items.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/web/src/components/layout/dashboard-layout.tsx` already provides a reusable back-office shell.
- `apps/web/src/app/investor/*`, `apps/web/src/app/admin/*`, `apps/web/src/app/compliance/*`, `apps/web/src/app/issuer/*`, `apps/web/src/app/tokenisation-agent/*`, and `apps/web/src/app/wm/*` already separate persona routes.
- `apps/web/src/lib/auth-context-v2.tsx` centralizes client auth state and redirect behavior.
- `apps/web/DESIGN_SYSTEM.md` and `apps/web/INTEGRATION_GUIDE.md` contain reusable frontend conventions that can be reconciled with the real app.

### Established Patterns
- `apps/web/src/app/page.tsx` markets multiple personas but still pushes users toward one shared `/login`.
- `apps/web/src/app/login/page.tsx` combines investor onboarding, wallet auth, and staff/admin messaging in one screen.
- `apps/web/src/components/auth/EmailLoginForm.tsx` already contains role-based redirect logic, which can be split into clearer surface-specific flows instead of duplicated.

### Integration Points
- `apps/web/src/app/page.tsx`
- `apps/web/src/app/login/page.tsx`
- `apps/web/src/components/auth/EmailLoginForm.tsx`
- `apps/web/src/lib/auth-context-v2.tsx`
- `apps/web/src/app/api/auth/*`
- `apps/web/src/app/investor/*`
- `apps/web/src/app/admin/*`
- `apps/web/src/app/compliance/*`
- `apps/web/src/app/issuer/*`
- `apps/web/src/app/tokenisation-agent/*`
- `apps/web/src/app/wm/*`

</code_context>

<specifics>
## Specific Ideas

- Introduce explicit entry points such as `/login/investor` and `/login/operator`, plus a landing page that explains the two surfaces clearly.
- Keep investor signup, wallet connection, KYC progression, and portfolio discovery on the investor side only.
- Keep staff and operator login on the operator side only, with role-based post-login routing into admin, compliance, issuer, tokenisation-agent, and wealth-manager areas.
- Standardize navigation, typography, token usage, and empty, loading, and error states per surface before adding cosmetic polish.

</specifics>

<deferred>
## Deferred Ideas

- Marketing-only redesign work that does not improve readiness
- New product verticals or novel investor features
- Native mobile adaptations

</deferred>

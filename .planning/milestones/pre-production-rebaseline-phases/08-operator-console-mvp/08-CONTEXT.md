---
phase: "08"
name: "operator-console-mvp"
created: 2026-03-30
---

# Phase 8: Operator Console MVP - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning
**Mode:** Derived from route audit, current operator persona routes, legacy dashboard review, and UI UX Pro Max guidance

<domain>
## Phase Boundary

Turn the current admin, compliance, issuer, tokenisation-agent, and wealth-manager areas into one coherent BlockXOne operator console.

</domain>

<decisions>
## Implementation Decisions

### Product Strategy
- Operator access is not one dashboard. It is one console with role-specific work areas.
- Operator home pages must be operational first:
  - queue summary
  - blockers
  - pending approvals
  - audit-sensitive actions
- Dense information is acceptable, but only when grouped and intentional.

### UX Direction
- Use a persistent operator shell with stronger navigation structure than the investor product.
- Favor split panels, queue cards, tables, and audit timelines over large decorative hero surfaces.
- Use explicit work-language:
  - pending case review
  - wallet approval required
  - mint queue blocked
  - payout reconciliation pending

### Verification Focus
- Verify role routing for admin, compliance, issuer, tokenisation-agent, offering-manager, and transfer-agent users.
- Verify shell consistency, action discoverability, and page-level information hierarchy.

</decisions>

<code_context>
## Existing Code Insights

### Current Operator Routes
- `apps/web/src/app/admin/*`
- `apps/web/src/app/compliance/*`
- `apps/web/src/app/issuer/*`
- `apps/web/src/app/tokenisation-agent/*`
- `apps/web/src/app/wm/*`

### Reusable Foundations
- `apps/web/src/components/layout/dashboard-layout.tsx`
- `apps/web/src/components/layout-wrapper.tsx`
- `apps/web/src/components/ui/data-table.tsx`
- `apps/web/src/components/ui/chart-card.tsx`
- `apps/web/src/lib/role-routing.ts`

### Current Defects
- Home pages do not yet feel like one system.
- Some operator pages still use placeholder metrics and generic cards.
- Navigation language is inconsistent across roles.
- The shell exists, but the operator information architecture is still under-defined.

</code_context>

<specifics>
## Specific Ideas

- define one operator shell with:
  - primary nav
  - page status header
  - action rail
  - queue modules
  - audit or recent activity rail
- treat each role area as a workstream inside one console:
  - Admin
  - Compliance
  - Issuer
  - Token operations
  - Wealth manager
  - Transfer ledger

</specifics>

<deferred>
## Deferred Ideas

- advanced customization per operator persona
- white-label themes
- mobile-first operator console beyond essential responsiveness

</deferred>

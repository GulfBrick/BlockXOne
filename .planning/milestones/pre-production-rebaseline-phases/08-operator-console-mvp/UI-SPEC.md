# UI-SPEC: Operator Console MVP

## Intent

Define the design contract for the rebuilt BlockXOne operator console.

## Product Feel

- decisive
- data-dense
- operational
- traceable
- controlled

## Primary UX Goals

1. Show queue state, risk, and blockers quickly.
2. Make role-specific actions easy to find.
3. Keep dense workflows readable under pressure.
4. Surface audit context near privileged actions.

## Layout Contract

### Operator Home Pages

- page header with role context and primary action
- top metrics that reflect live workload, not vanity stats
- main work area for queues or active items
- right rail or lower section for recent events, audit, or escalations

### Queue Pages

- filters at the top or left
- strong row hierarchy
- quick status scanning
- direct links into detail or approval views

### Privileged Action Pages

- explain effect before action
- confirmation state visible
- audit note or reason field where required
- result state after action is explicit

## Component Contract

- operator status header
- workload metric cards
- queue table
- detail drawer or side panel
- audit timeline
- action summary card
- exception banner

## Visual Rules

- same BlockXOne palette as public and investor surfaces
- tighter spacing and denser layouts than investor pages
- stronger border hierarchy and panel separation
- restrained glow effects
- semantic status colors used with labels, not alone

## Interaction Rules

- primary action must be obvious on every high-value page
- destructive or privileged actions require confirmation
- tables must support keyboard navigation and visible focus
- every empty state must explain what queue condition created it

## Accessibility

- body text minimum `14px` only for dense data rows; keep `16px` elsewhere
- strong contrast for status and risk panels
- no icon-only controls without labels or tooltips
- tables and forms must remain usable on laptop-width screens

## Pages Covered

- `/admin`
- `/admin/users`
- `/admin/roles`
- `/admin/features`
- `/compliance`
- `/compliance/queue`
- `/compliance/rules`
- `/compliance/audit`
- `/issuer`
- `/tokenisation-agent`
- `/tokenisation-agent/*`
- `/wm`
- `/wm/funds`
- `/wm/investors`
- `/wm/ledger`
- `/wm/reports`

## Quality Bar

The operator console must feel like an institutional operations product, not a startup demo dashboard.

# Phase 1 Deliverable: Public Information Architecture

## Objective

Define the public structure of BlockXOne so visitors understand the product before they ever hit an authentication screen.

## Audience Model

### Primary audiences

- institutional issuers and operators
- wealth managers and distribution partners
- investors evaluating tokenized opportunities

### Secondary audiences

- compliance and operations stakeholders
- strategic partners and service providers
- press, analysts, and ecosystem participants

## Launch Scope Messaging

### Launch-ready asset classes

- private funds
- private credit programs
- real-estate investment vehicles
- structured debt and cash-equivalent programs

### Future-ready but not launch-led

- commodities-backed structures
- invoice and receivables programs
- other regulated private-market instruments

Public copy should say "multi-asset tokenization platform" while the launch detail stays anchored on regulated funds and adjacent private-market structures.

## Public Route Tree

### Core public routes

- `/`
- `/how-it-works`
- `/asset-classes`
- `/for-investors`
- `/for-operators`
- `/security-and-compliance`
- `/request-demo`

### Auth routes

- `/investor/login`
- `/operator/login`
- `/investor/register`

### Protected routes

- `/investor/*`
- `/operator/*`

## Navigation Model

### Top navigation

- Platform
- Asset Classes
- For Investors
- For Operators
- Security
- Request Demo

Right side actions:
- `Investor login`
- `Operator login`

### Footer navigation

- How it works
- Asset classes
- Security and compliance
- Investor experience
- Operator experience
- Contact or request demo

## CTA Rules

- The hero must never send everyone to one generic login page.
- The highest-intent CTA for institutions is `Request demo`.
- The highest-intent CTA for existing investors is `Investor login`.
- The highest-intent CTA for existing internal or institutional operators is `Operator login`.
- `Explore assets` may exist, but only after the platform is explained.

## Public Story Sequence

1. what BlockXOne is
2. how tokenization works
3. what asset classes the platform supports
4. how issuers and operators use it
5. how investors use it
6. why the controls are trustworthy
7. where each audience goes next

## Audience Routing Rules

### Investors

Public pages can show:
- marketplace teaser
- onboarding process
- reporting benefits
- login and registration entry

Public pages cannot show:
- operator workflows
- admin actions
- compliance queue actions

### Operators

Public pages can show:
- issuer and servicing capabilities
- compliance controls
- audit and governance story
- operator login and demo path

Public pages cannot expose:
- actual admin consoles
- token control actions
- internal workflow states

## Recommended App Boundary

Use a monorepo with three apps:
- `apps/public`
- `apps/investor`
- `apps/operator`

Reason:
- clearer deployment and auth boundaries
- easier brand consistency with shared packages
- less risk of route or session leakage between investor and operator surfaces

If implementation starts in one Next.js codebase for speed, it should still use strict route groups and separate auth middleware from day one.

## Phase 2 Build Boundary

Phase 2 should implement:
- public site shell
- top nav and footer
- landing page
- how-it-works page
- asset-classes page
- investor login page
- operator login page

It should not yet implement the full investor or operator product interiors.

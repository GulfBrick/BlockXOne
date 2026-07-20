# UI-SPEC: Investor Portal MVP

## Intent

Define the design contract for the rebuilt BlockXOne investor portal.

## Product Feel

- calm
- guided
- high-trust
- institutional
- readable before dense

## Primary UX Goals

1. Show qualification and account readiness immediately.
2. Make asset discovery and holding status legible.
3. Keep investor actions clear, low-anxiety, and well-explained.
4. Make wallet usage feel optional and contextual.

## Layout Contract

### Home

- summary hero with current investor readiness
- qualification banner near the top
- portfolio metrics before detail modules
- next-best-actions section
- recent orders and documents beneath summary content

### Market And Asset Detail

- assets presented as product cards with status, yield or structure cues, and access requirements
- asset detail pages use overview first, documents second, actions third
- subscription CTA must always sit next to suitability and qualification context

### Orders And Redemptions

- timeline-driven status layout
- plain-language labels for submission, review, payment, issue, and settlement states
- no dense operator jargon on investor pages

## Component Contract

- qualification banner
- portfolio metric strip
- asset opportunity card
- document list row
- order timeline card
- wallet readiness panel
- next action card

## Visual Rules

- same BlockXOne palette as the public site
- softer contrast steps than operator pages
- less dense tables, more grouped cards
- display font only for page titles and a few key numbers
- no decorative effects that compete with financial data

## Interaction Rules

- one dominant action per page
- destructive or high-risk actions must be confirmed
- loading and empty states must explain what happens next
- wallet prompts only appear when the current action truly needs a wallet

## Accessibility

- body text minimum `16px`
- high-contrast banners for qualification state
- visible labels on all forms
- keyboard-safe navigation across market cards and timelines

## Pages Covered

- `/investor/login`
- `/investor/register`
- `/investor/portfolio`
- `/investor/kyc`
- `/investor/market`
- `/investor/funds/[id]`
- `/investor/orders`
- `/investor/p2p`

## Quality Bar

The investor portal must feel like a regulated investment product, not a crypto dashboard.

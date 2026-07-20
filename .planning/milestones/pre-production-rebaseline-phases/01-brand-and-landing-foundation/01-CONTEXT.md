# Phase 1 Context: Brand And Landing Foundation

## Goal

Define the first implementation target for the rebuild:
- public information architecture
- landing page narrative
- investor versus operator route split
- preserved BlockXOne brand system with upgraded UX rules

## Why This Phase Comes First

The current repo fails at the first product moment. The public landing and login experience does not explain the platform clearly enough and mixes personas that should be separated.

If the public story stays muddy, every deeper rebuild decision will drift.

## Inputs

- `.planning/research/rebuild/TOKENIZATION-RESEARCH.md`
- `.planning/research/rebuild/STACK-RECOMMENDATION.md`
- `.planning/research/rebuild/PRODUCT-AND-UX-ARCHITECTURE.md`
- current logo asset at `apps/web/public/logo.png`
- current design tokens at `apps/web/src/styles/design-tokens.css`

## Must-Haves

- Preserve the BlockXOne logo and color direction
- Replace the mixed `/login` mental model with separate investor and operator entry points
- Explain tokenization in plain language before asking for authentication
- Keep the design institutional, accessible, and responsive

## Non-Goals

- Rebuilding the full investor portal in this phase
- Rebuilding the full operator console in this phase
- Finalizing every backend integration detail

## Risks

- Over-indexing on visual polish before information clarity
- Letting wallet UX dominate the public entry path
- Repeating the current mistake of mixing privileged and non-privileged flows

## Phase Exit Signal

This phase is complete when the BlockXOne public IA and landing-page spec are good enough that a user can understand:
- what the platform does
- who it is for
- how tokenization works at a high level
- where investors log in
- where operators log in

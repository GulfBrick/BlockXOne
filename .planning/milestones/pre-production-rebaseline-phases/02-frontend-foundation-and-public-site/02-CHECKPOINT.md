# Phase 2 Checkpoint: Frontend Foundation And Public Site

## Status

In progress as of 2026-03-30.

## Completed In This Checkpoint

- Replaced the old mixed landing page with a content-first public marketing surface.
- Split entry routes into:
  - `/investor/login`
  - `/investor/register`
  - `/operator/login`
  - `/login` as a public chooser instead of a mixed auth form
- Added public content routes for:
  - `/how-it-works`
  - `/asset-classes`
  - `/for-investors`
  - `/for-operators`
  - `/security-and-compliance`
  - `/request-demo`
- Preserved the BlockXOne logo and dark cyan-blue visual direction while replacing the sprint-era hero and login structure.
- Added centralized role-to-home routing so investor and operator roles land in the correct workspace after authentication.
- Added layout-level route protection so investor and operator surfaces no longer rely on page-by-page auth checks.
- Standardized token retrieval for the rebuilt operator pages to the shared `bx_auth_v2` session model.
- Corrected logout flow so users return to the right login surface instead of the old mixed route.

## Verification

- `npm run build` passes in `apps/web`.
- `http://localhost:3000` responds with `200`.
- `http://localhost:8080/healthz` responds with `200`.
- The built web app is currently serving via `npm run start`.

## Remaining Phase 2 Work

- Clean remaining lint debt in older admin, wallet, dashboard-layout, and utility components.
- Tighten design-system consistency across older operator pages that still use older card, spacing, and form patterns.
- Decide whether the rebuild keeps one Next.js app with stricter route groups for now or splits public, investor, and operator into separate apps before Phase 3.
- Review public metadata, trust messaging, and SEO structure one more time before marking the frontend foundation complete.

## Exit Signal

Phase 2 can be marked complete once the frontend foundation is coherent enough that:
- the public site is clearly separate from privileged product surfaces
- session and route behavior are consistent across rebuilt pages
- the remaining lint debt no longer obscures the rebuild direction
- the next phase can focus on identity architecture instead of basic frontend cleanup

# BlockXOne platform releases

## 1.1.0-rc.6 — Branded TEST entry correction

- Built from published rc.4 source `ff9e716cf09f1743cdb07d423ab60ca0e77eb506`. The unreleased rc.5 funding candidate is excluded; skipping its number does not include or approve its features.
- Admit only the exact `https://testnet.bx1.co.za` branded origin alongside the existing preview-origin admission, retaining the pinned TEST backend, preview environment and auth/HTTPS gates.
- Redirect GET/HEAD from the exact previous stable TEST alias to the branded origin before session refresh or host-only callback cookie handling, preserving path/query. Refuse legacy-alias mutation requests without replaying their bodies; do not trust forwarded host headers or change same-origin auth checks.
- Preserve existing application data, roles, wallet adapter, schemas and contracts. This is not a MAINNET parity release or financial activation. MAIN public navigation is a separately scoped patch on its existing production source.
- Cloud tests/build and DNS, HTTPS, callback, alias-redirect and hosted sign-in/registration checks must be recorded for this exact candidate. Previous release evidence is not reassigned; a source change alone does not prove the domain is configured or authentication works.

## 1.1.0-rc.4 — Accurate subscription-state wording

- Correct dashboard, portfolio and new fictional offering-template language: these records are subscription instructions and requested amounts, not canonical funding obligations or settled holdings.
- Preserve all saved offering versions, database records and scoped workflow controls. No schema, contract, permission or provider change.
- rc.3 remains exact source `253bd3f81928645614ab0a4be3b6c379ce0b404d`, cloud run `35555160057`. This correction requires its own cloud and hosted verification; evidence is not silently reassigned.

## 1.1.0-rc.3 — Connected offering and subscription workspaces

- Replace responsibilities-first landings with operational investor opportunities/orders, issuer products/incoming orders and compliance queues in the existing branded application.
- Retain selected role, organisation and environment across pages, private evidence, commands and durable retries. Server and database enforce the same operating context.
- Add explicit organisation-authority provenance and owned individual investment accounts; no automatic memberships, organisation mappings or approval seeds.
- Investor instructions and issuer inbox share one subscription record, accepted version/fingerprint and exact units/amount. AWAITING_FUNDING is not a holding, settled payment or token issuance.
- Additive database cutover revokes unscoped writes; apply only after cloud acceptance and deploy this scoped candidate immediately afterward. Existing logins and saved identifiers remain intact.
- This candidate does not claim a completed MAINNET parity release or either full settled product journey. Acceptance evidence is retained against the exact source; no previous run is reassigned to this candidate.

## 1.1.0-rc.2 — Consistent post-MFA dashboard landing

- Keep setup and account-security continuations unchanged while routing a completed MFA sign-in to `/portal` on validated TESTNET/MAINNET deployments.
- Accept only the exact `/portal` client destination, not query-supplied redirects.
- The prior rc.1 source `9621da42586bc3423a603469fd662336e144d5a3` passed cloud run `35549941325` (web tests, isolated fund/portal SQL, typecheck/build). This follow-up requires its own cloud result; previous proof is not reassigned to changed source.

## 1.1.0-rc.1 — Role dashboards

- One shared `/portal` dashboard model for all nine canonical roles in TESTNET and MAINNET.
- Dashboard context is selected only from fresh active native role/organisation assignments after existing MFA admission.
- Existing applicant registration and manual test onboarding are preserved; a self-selected persona grants no operator role.
- Responsibilities, workflow actions, hand-offs and MetaMask authority boundaries differ by role, not by a separate application.
- Exact approved brand artwork replaces the temporary text emblem. Shared carbon/midnight/chrome/cyan tokens and Archivo typography replace the portal-only palette.
- Existing test records provide bounded work counts. Unavailable business adapters never report fake balances, funding or holdings.
- The dashboard shows product version and deployment source identity. This candidate does not activate financial operations, add roles, modify schemas or deploy contracts.

### Acceptance still required

Cloud test/build results and authenticated hosted visual checks are recorded against the exact source commit. This candidate alone is not full testnet journey acceptance or MAINNET production admission. Product-organisation integration, financial core, governed issuance, servicing and exit remain subsequent connected workflow work, using this application and release lineage.

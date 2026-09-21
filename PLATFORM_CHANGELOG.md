# BlockXOne platform releases

## 1.1.0-rc.9 — Stage 1 entry and identity-context candidate

- Based on rc.8 source `de105558585e803cba36e750798b9c6c6ea658c8`, preserving existing auth/security, portal, account, funding and journal history.
- Correct initial investor/wealth-manager intent, multiple immutable-persona applications, exact selected application commands and explicit authorised capacities in the existing shell. Signed-in registration offers Continue, Switch account and Add a capacity.
- Share validated hosted identity entry across TESTNET/MAINNET without admitting legacy test-only business commands on MAINNET. Unknown runtime configuration no longer defaults to LOCAL_PILOT; historical records are retained.
- Requires `supabase/features/bx1_entry.sql` after the existing portal/authority/funding sequence. Review routing is server-owned and default-closed; organisation application review remains Stage 2. Apply and verify schema before releasing dependent routes.
- Existing cloud workflow now builds both configurations and separately verifies additive entry SQL. Cloud checks and hosted journey acceptance are pending, not claimed by this changelog.
- No real role grants, settlement routes, fund movements, contract changes or production financial admission. Existing branded deployments remain unchanged until controlled release. Full platform parity and eight-stage completion remain unproven.

## 1.1.0-rc.8 — Integrated branded-entry and funding candidate

- Base this candidate on accepted rc.7 source `57868141d87ac6eeba446be452793017da3f2da8`, retaining the exact branded TEST origin, legacy-alias redirect ordering, registration metadata/header alignment and strict same-origin request admission.
- Integrate the previously unaccepted rc.5 funding work and its separately reviewed corrections into the same application: existing account/subscription obligations, reviewed TEST token routes, payer-signed receipt claims, independently verified evidence, Treasury/Controller reconciliation and balanced immutable journals/reversals.
- Preserve all-nine-role and selected-organisation workflow boundaries. No second customer/order model, settlement asset, receiving address, financial authority or privileged test user is seeded. A claim signature is not payment; an accounting reversal is not a refund; funding does not imply issuance or a holding.
- Keep the existing cloud acceptance workflow, its isolated funding PostgreSQL fixture, exact Edge verifier typecheck and read-only Amoy provider check. A registration-browser-proof dispatch runs only that bounded browser proof, not the funding campaigns.
- rc.5 was not an accepted or hosted funding release. This integrated candidate requires its own exact-source cloud and hosted evidence; rc.7 registration evidence is retained as history, not reassigned to changed source.
- MAINNET financial admission remains false. This candidate does not claim completed signup/email delivery, a funded investor journey, governed issuance, servicing, exit or full TESTNET/MAINNET lifecycle parity.

## 1.1.0-rc.7 — Native registration submission repair

- Align registration page metadata and middleware referrer policy for clean forms and validated intent/error presentation state. Native same-origin form POSTs must retain the canonical Origin rather than sending null and being rejected before Supabase signup.
- Keep unknown, duplicated and token-bearing query states private; do not accept missing, null or foreign request origins. Existing signup validation, email confirmation, account isolation and role grants remain unchanged.
- Add cloud Chromium proof of the real hosted registration document and browser-generated native POST Origin using an empty, intercepted invalid body. No credentials, consent, accounts, emails or real-world transactions are created by this request-level proof.
- Based on rc.6 source 259ddc4e555f454faf123f368f0dabc5a2ef33d6; rc.5 funding remains excluded. This correction does not prove email delivery, completed KYC, financial flows or MAINNET parity.

## 1.1.0-rc.6 — Branded TEST entry correction

- Built from published rc.4 source `ff9e716cf09f1743cdb07d423ab60ca0e77eb506`. The unreleased rc.5 funding candidate is excluded; skipping its number does not include or approve its features.
- Admit only the exact `https://testnet.bx1.co.za` branded origin alongside the existing preview-origin admission, retaining the pinned TEST backend, preview environment and auth/HTTPS gates.
- Redirect GET/HEAD from the exact previous stable TEST alias to the branded origin before session refresh or host-only callback cookie handling, preserving path/query. Refuse legacy-alias mutation requests without replaying their bodies; do not trust forwarded host headers or change same-origin auth checks.
- Preserve existing application data, roles, wallet adapter, schemas and contracts. This is not a MAINNET parity release or financial activation. MAIN public navigation is a separately scoped patch on its existing production source.
- Cloud tests/build and DNS, HTTPS, callback, alias-redirect and hosted sign-in/registration checks must be recorded for this exact candidate. Previous release evidence is not reassigned; a source change alone does not prove the domain is configured or authentication works.

## 1.1.0-rc.5 — Previously unaccepted canonical funding candidate

- Candidate source `a0aca177d9bfc6672fc7e8a1ba113eb45a51ab0b` extended the existing account/subscription records with exact funding obligations, Treasury/Controller review, two-provider Amoy receipt verification and balanced journals/reversals.
- Its cloud SQL acceptance did not pass; it was not deployed as an accepted funding release. rc.6 and rc.7 deliberately excluded these changes while repairing branded entry and registration.
- rc.8 integrates this work only with separately reviewed corrections and new exact-source acceptance. The rc.5 version number or source availability is not proof of a working hosted financial flow.

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


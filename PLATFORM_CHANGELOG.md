# BlockXOne platform releases

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

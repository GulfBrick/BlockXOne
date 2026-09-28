# Stage 2 provider-evidence integration boundary

This increment adds a Sumsub sandbox adapter to the existing BlockXOne portal. Its provider-evidence schema is shared by TEST and MAIN, but the current writer functions and web routes admit **TEST sandbox operations only**. MAIN remains fail-closed until a separately reviewed live provider adapter, credentials and operating admission are delivered. It does not approve customers, product eligibility, mandates, roles, or accounts. No provider credentials or hosted settings are committed here.

## TEST environment configuration (names only)

Set these **server-only** variables on the existing Vercel `block-x-one` Preview deployment for `testnet.bx1.co.za`, after the migration and restricted database LOGIN have been reviewed and provisioned. Never use `NEXT_PUBLIC_` for these values.

| Variable | Purpose |
|---|---|
| `BLOCKXONE_SUMSUB_SANDBOX_APP_TOKEN` | Sumsub app token created in Sandbox mode |
| `BLOCKXONE_SUMSUB_SANDBOX_APP_SECRET` | Secret paired with that sandbox app token |
| `BLOCKXONE_SUMSUB_SANDBOX_WEBHOOK_SECRET` | Distinct webhook HMAC secret; configure SHA256 or SHA512 in Sumsub |
| `BLOCKXONE_SUMSUB_SANDBOX_CLIENT_ID` | Exact Sumsub sandbox client ID expected in the signed webhook |
| `BLOCKXONE_SUMSUB_SANDBOX_INDIVIDUAL_LEVEL` | Existing sandbox verification level for an individual |
| `BLOCKXONE_SUMSUB_SANDBOX_COMPANY_LEVEL` | Existing sandbox verification level for a company |
| `BLOCKXONE_PROVIDER_EVIDENCE_DATABASE_URL` | TLS-verified Supabase connection as only `bx1_provider_evidence_writer`; no broad database/service-role credential |
| `NEXT_PUBLIC_BLOCKXONE_SUMSUB_SANDBOX_ENABLED` | Set to `true` only after TEST credentials, webhook endpoint and restricted writer are configured and probed; then prove a genuine sandbox event through the visible applicant flow before acceptance. Absent/false keeps the start action hidden. This is a presentation gate, never backend authority. |

The webhook URL is `https://testnet.bx1.co.za/api/portal/kyc/webhook`. Sumsub must send `X-Payload-Digest-Alg` and `X-Payload-Digest` over the exact raw JSON bytes. SHA1, missing signatures, unbound external IDs, non-sandbox events and an unexpected client ID are rejected. A token is scoped to one application revision and expires after 600 seconds.

Apply `20260924110608_stage2_provider_evidence.sql` after the existing Stage 2 entity-account and MFA-shell migrations in each environment; MAIN first needs its missing Stage 2 baseline and is not made operational by this migration. It creates the writer role as `NOLOGIN`; the deployment owner separately assigns a password and grants LOGIN in TEST after the restricted function/role review. Do not activate the MAIN writer role or paste credentials into SQL migrations, issue logs, chat, or source control. The TEST Vercel secret must use `sslmode=verify-full` and the exact Supabase TEST project host and role; connection configuration refuses any other project, username, port, or SSL policy.

## Verification and remaining acceptance

- The `test-portal.mjs` cloud PostgreSQL17 fixture applies this migration and calls `proveProviderEvidence` with disposable synthetic records. It tests binding, idempotency, reordering, wrong environment, scope and no admission/role side effects. A passing run is still required for the exact release commit.
- Web unit tests prove HMAC, request signing, credential failure, actor/revision checks, and no persistence on forged callbacks. These are **not** an actual Sumsub delivery proof.
- The applicant WebSDK component and reviewer evidence view are coded, but hosted acceptance still needs: provider sandbox app/levels and callback configuration; restricted writer credential; a genuine sandbox event received and shown in the correct application/reviewer context; information-request/resubmission and independent reviewer decisions; and recurring/ongoing-monitoring policy. None is inferred from a passing test or a configured secret.

Primary provider contracts: [Sumsub webhook verification](https://docs.sumsub.com/docs/webhook-manager), [API request authentication](https://docs.sumsub.com/reference/authentication), [SDK token](https://docs.sumsub.com/reference/generate-access-token), [user-verification events](https://docs.sumsub.com/docs/user-verification-webhooks).

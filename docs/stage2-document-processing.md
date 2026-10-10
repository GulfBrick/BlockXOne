# Stage 2 private-document processing adapter

This extends the existing quarantine/scan/promotion lifecycle. It is not a malware engine, a new customer portal or provider acceptance. Installing source/schema does not activate scanning. An appointed independent engine must process actual bytes and supply an authenticated result before a document can become usable evidence.

## Deployment and admission boundaries

The additive feature is `supabase/features/bx1_document_processing.sql`, after the existing quarantine and retention migrations. It preserves historical document facts and wraps the existing scan-result and promotion functions with mandatory attempt fencing. The processing admission defaults to `NOT_ADMITTED`; the new function-only processing role is `NOLOGIN`. Do not activate either from an example or a test result.

The existing scanner writer remains separate from the processing worker. Worker claims, byte retrieval and explicit failure cannot record CLEAN, promote, approve customers, assign mandates or authorise retention/disposal. Browser and service roles receive no processing-table or worker-function grants.

An actual operating owner must appoint the engine/adapter, configure isolated TEST credentials privately, validate exact-byte clean/malicious results and retries, and retain the admission reference. MAIN requires its own live appointment and admission, never TEST secrets. TEST's existing synthetic document route remains explicitly synthetic; old unscanned files are not relabelled clean.

## Server-only configuration (names, never values)

Retain the existing scanner settings: `SUPABASE_URL`, `BLOCKXONE_DOCUMENT_STORAGE_SECRET_KEY`, `BLOCKXONE_DOCUMENT_SCANNER_ID`, `BLOCKXONE_DOCUMENT_SCANNER_HMAC_KEY`, `BLOCKXONE_DOCUMENT_SCANNER_DATABASE_URL`, plus the existing receipt writer configuration for uploads.

Add:

| Name | Purpose |
| --- | --- |
| `BLOCKXONE_DOCUMENT_PROCESSING_DATABASE_URL` | TLS-verified current-project connection as only `bx1_document_processing_worker`; no broad owner/service-role connection |
| `BLOCKXONE_DOCUMENT_PROCESSING_WORKER_ID` | Fixed appointed adapter identity; must match the admitted database policy |

Never use `NEXT_PUBLIC_`, commit credentials or send private document data/keys through chat or CI logs. TEST uses only `fegnnnlseuejkrusbbkv`; MAIN uses only `oqkevkjbkpugjotihtda`. Direct port 5432 or the existing pooler port 6543 with exactly `sslmode=verify-full` are allowed by the project/role validators.

## Durable protocol

1. The authenticated upload stages bytes in private quarantine. The registry and one document/hash-bound processing job commit atomically. Exact retries do not create duplicate jobs.
2. The configured service sends a signed CLAIM to `/api/portal/documents/processing`. A new request UUID is a new delivery attempt request; an identical UUID never consumes another job, including after lease expiry or an empty response.
3. A claim supplies a server-created attempt UUID, admission epoch, exact byte manifest, `bx1-scan:<attempt UUID>` reference and 120-second lease. Empty queue is not scanner success.
4. A signed BYTES request must match the document/attempt/epoch/hash. The server independently rehashes private Storage bytes and checks the live lease/epoch again at the release decision. It returns raw bytes, not a bearer URL or base64 payload. Revocation cannot retract bytes already delivered.
5. The independent engine actually scans those bytes. It sends its result to the existing `/api/portal/documents` PATCH receiver, using the claim's exact reference and manifest hash. A HMAC alone is not proof that an engine ran: engine acceptance must be separately demonstrated.
6. The database requires current policy/identity/epoch/attempt and live lease for a first result. Late or replaced attempts cannot change the document. Exact durable-result replay remains idempotent; conflicts fail. CLEAN records a result, not ownership, approval or completed promotion.
7. The existing verified promotion path releases only clean, rehashed immutable bytes and records completion after its receipt succeeds. If promotion fails, retry the same recorded result; do not rescan, create another result or reset it to queued.
8. The service can send FAIL for ENGINE_UNAVAILABLE or DELIVERY_FAILED; backoff is 30 seconds and the maximum is five attempts. INVALID_DOCUMENT and HASH_MISMATCH stop processing without inventing a MALICIOUS verdict. Old leases cannot fail or requeue a new attempt. Required evidence failure rolls back the database transition.

Processing policy or identity changes advance the authority epoch. Historical items are explicitly mapped as LEGACY from retained facts. No fake attempt is created; unfenced historical clean-result recovery requires a separately reviewed rebind. A mapped state is not engine acceptance or authorisation to delete evidence.

## Signed service requests

The endpoint accepts only bounded strict JSON and a canonical destination, not browser actions. Headers are `x-bx1-scanner-timestamp` (Unix seconds) and `x-bx1-scanner-signature` (`sha256=<hex>`). The request HMAC input is `bx1-document-processing-v1:<timestamp>.<exact raw JSON bytes>`; timestamps must be within five minutes. This domain differs from the existing scanner-result callback signing input.

Body contracts:

- CLAIM: `command`, `request_id` UUID.
- BYTES: `command`, `document_id`, `attempt_id`, positive `authority_epoch`, `sha256`.
- FAIL: BYTES fields plus one admitted failure `code`.

Worker/scanner identities come from server configuration and admitted policy; body-selected roles, identities, verdicts, arbitrary URLs or SQL are rejected. Claims return metadata only; BYTES returns a private/no-store attachment. The database remains authoritative for lease state, retry ceiling, admission and result fencing.

## Proof versus acceptance

Run the existing exact-source platform cloud workflow, including both environment builds and the full PostgreSQL17 chain. The new proof requires actual separate database connections/PIDs for claim contention, then tests duplicate request receipts, expiry/retry/exhaustion, epoch revocation, stale results, result/promotion replay and audit rollback. Web proof covers HMAC, strict inputs, project/TLS/role configuration and post-download denial. No local application runtime, tests, builds or database are required.

These automated cloud fixtures prove orchestration boundaries, not real engine processing, Sumsub acceptance, hosted participant admission or complete Stage 2. Actual scanner selection, clean/malicious processing, provider events, retained documents, mandate/account handoffs and policy-approved disposition/disposal remain named acceptance tasks in the native roadmap.

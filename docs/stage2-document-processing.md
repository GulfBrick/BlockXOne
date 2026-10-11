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

## Bounded TEST ClamAV producer (S2-SCAN-20261011)

`apps/web/scripts/document-scanner-runner.mjs` supplies the missing one-attempt producer. It consumes the existing CLAIM/BYTES/FAIL protocol and existing signed result PATCH; it has no database, Storage, policy, role, approval or disposal interface. Its only destination is `https://testnet.bx1.co.za`. MAIN, alternate hosts, redirects, cookies and cached replies are rejected. This source does not activate any processing policy or writer LOGIN.

The executable is fixed to `/usr/local/bin/clamscan`, version `1.4.6`. Cloud installation independently verifies the official Linux x86_64 package SHA256 `d3ee9e401974855a1edc1761b1425417d126de618d5f0c91cd51209f69f6fcc2`. Its extracted executable SHA256 is pinned to `08160a5c11103e1a7af3b783b25e947a52bb0a598c40102c7aaa6525e477f7bf`. The runtime requires that exact executable hash before both version and scan launches, verifies a regular non-group/world-writable file, and rejects mismatched returned engine receipts before result delivery. Both real-engine proof scans assert that same pin. Version text or an environment variable alone is not package attestation. An operating owner must separately approve and protect that installed engine and the signature database before admission.

In addition to the existing worker/scanner identity and HMAC-key variables, private runner configuration requires:

| Name | Binding |
| --- | --- |
| `BLOCKXONE_ENVIRONMENT` | Exactly `TESTNET` |
| `BLOCKXONE_APP_ORIGIN` | Exactly the canonical TEST origin above |
| `BX1_SCANNER_DATABASE_PATH` | Absolute regular-file path to one appointed signature file (`.ndb`, `.hdb`, `.hsb`, `.ldb`, `.cvd` or `.cld`), not a default or mixed directory |
| `BX1_SCANNER_DATABASE_SHA256` | Exact SHA256 of every byte of that file; missing, changed or writable-by-others files fail closed |

The runner reads and hashes that entire signature file, then loads only its immutable private snapshot. No unrecorded default signature files are loaded. Real operating signature coverage, authenticity and freshness are owner admission prerequisites: the custom fixture signature database is not an acceptable production malware database. Credentials and database paths are never CLI parameters or logged values.

The server manifest must match the exact worker/scanner, actor/document path, attempt/reference/epoch, 4 MiB maximum, accepted PDF/PNG/JPEG type, hash and live 120-second lease. Downloaded full bytes are rehashed and their declared file magic is checked before entering ClamAV stdin. The engine receives no inherited credentials, shell, persistent document file or caller-selected command. Internal extraction uses a private memory-backed `/dev/shm` directory which is removed in `finally`; this does not promise that libclamav never creates temporary extracted files. No engine logfile, leave-temps, force-to-disk or deletion flag is enabled.

Engine/version execution is bounded to 60 seconds, with bounded private stdout/stderr and remaining-lease delivery margins. A complete single-file summary and exact engine version are required. Exit 0 alone is not CLEAN; missing/skipped/multiple-file summaries, errors, warnings, signals, timeouts and encrypted/resource-limit detections fail closed. Exit 1 is MALICIOUS only for a complete non-limit/non-encrypted detection; uncertain scan errors are not a verdict. Real-engine fixture proof and mocked HTTP/subprocess negative tests produce separate receipts.

The existing CLEAN callback returns `{ id, state: 'SCANNED_CLEAN' }` only after its verified promotion path finishes; MALICIOUS returns `REJECTED`. These exact envelopes are checked, not generic HTTP success. A callback may nevertheless record a result before a later promotion or reply fails. After its first PATCH attempt, the runner retries only the same raw body, observation timestamp, reference and authentication timestamp/signature (three bounded sends); it never rescans or sends FAIL. Before a result is attempted, admitted failures use only the existing failure codes and current lease.

`runOnce` returns sensitive claim/result recovery state in memory to its private worker caller. `recoverResult` can retry the exact authenticated result without another engine run while its five-minute authentication window is current. A caller must protect any retained state and reconcile unresolved or expired delivery through the existing authority; it must not start a different result for the same attempt. The one-shot CLI deliberately logs no recovery JSON and has **no durable crash-recovery store or scheduler**. CLI recovery-required exit is not completed processing or a resilient admitted worker. Durable operating-state storage/recovery and appointment remain separate activation prerequisites.

Cloud verification uses `node --test apps/web/scripts/document-scanner-runner.node-test.mjs` for mocked boundary negatives, then `node apps/web/scripts/document-scanner-engine-proof.mjs` for actual pinned ClamAV scanning of two in-memory valid PDFs with a harmless custom signature. No real documents, customer tokens, hosted API/Storage credentials or database connections enter either proof. The real-engine receipt explicitly excludes production signature coverage and hosted worker acceptance. Source-only review, cloud proof, owner admission and actual hosted document promotion/attachment remain distinct; this increment does not close Stage 2, authorise disposal or satisfy Stage 4 product readiness.

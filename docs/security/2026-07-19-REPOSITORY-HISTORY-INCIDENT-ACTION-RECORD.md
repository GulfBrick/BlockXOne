# Repository History Incident — Human Action Record

**Incident:** `BX1-SEC-2026-07-19-01`
**Status:** DRAFT / NOT APPROVED
**Rule:** Record references, owners, timestamps and conclusions only. Never paste secret values, private keys, access tokens, personal data or unredacted provider logs into this file, Git, chat or CI output.

## 1. Assigned owners

| Responsibility | Named person | Organisation/team | Assigned at | Evidence reference |
| --- | --- | --- | --- | --- |
| Incident commander | Pending | Pending | Pending | Pending |
| Repository owner | Pending | Pending | Pending | Pending |
| Security/CISO owner | Pending | Pending | Pending | Pending |
| Legal/privacy owner | Pending | Pending | Pending | Pending |
| Platform/build-cache owner | Pending | Pending | Pending | Pending |
| Independent verifier | Pending | Pending | Pending | Pending |

## 2. Credential classification and rotation

Complete one row for every possible class. `Not present` requires a provider-owner or secured-incident-workspace evidence reference; an agent inference is insufficient.

| Secret class | Environment/privilege scope | Live, placeholder or not present | Revoked/rotated at | Dependants updated/restarted | Audit-log review reference | Owner sign-off |
| --- | --- | --- | --- | --- | --- | --- |
| Firebase Admin/service account | Pending | Pending | Pending | Pending | Pending | Pending |
| Blockchain/tokenisation signer | Pending | Pending | Pending | Pending | Pending | Pending |
| Authenticated RPC token | Pending | Pending | Pending | Pending | Pending | Pending |
| KYC provider key/secret | Pending | Pending | Pending | Pending | Pending | Pending |
| Custody provider key/signing credential | Pending | Pending | Pending | Pending | Pending | Pending |
| Payment provider secret | Pending | Pending | Pending | Pending | Pending | Pending |
| Webhook shared secrets | Pending | Pending | Pending | Pending | Pending | Pending |
| App Check debug token | Pending | Pending | Pending | Pending | Pending | Pending |
| Sentry/telemetry credential | Pending | Pending | Pending | Pending | Pending | Pending |
| Other discovered class | Pending | Pending | Pending | Pending | Pending | Pending |

If a live signing key is found, attach the separately approved on-chain role-revocation, replacement-key ceremony and affected-address/transaction assessment. Do not record key material here.

## 3. Distribution and cache inventory

| Surface | Assessed by | Result | Containment/expiry action | Completed at | Evidence reference |
| --- | --- | --- | --- | --- | --- |
| GitHub branches/tags/pull-request refs/cached views | Pending | Pending | Pending | Pending | Pending |
| Forks and collaborator clones | Pending | Pending | Pending | Pending | Pending |
| CI artifacts and logs | Pending | Pending | Pending | Pending | Pending |
| Docker builders and local/remote caches | Pending | Pending | Pending | Pending | Pending |
| Container registries/images | Pending | Pending | Pending | Pending | Pending |
| SBOM/provenance/artifact stores | Pending | Pending | Pending | Pending | Pending |
| Backups and retention systems | Pending | Pending | Pending | Pending | Pending |

Evidence must be preserved under the authorised incident-retention policy. Do not silently delete evidence.

## 4. Approved history response

Select exactly one after credential action:

- [ ] **Option A — new clean repository or clean-root production lineage (recommended).**
- [ ] **Option B — coordinated GitHub all-ref history rewrite.**

| Decision field | Record |
| --- | --- |
| Decision rationale | Pending |
| Exact repositories/refs in scope | Pending |
| Branch-protection/force-push approval, if Option B | Not applicable or pending |
| Old-repository restriction and retention | Pending |
| Collaborator migration/fresh-clone plan | Pending |
| Repository owner approval | Pending |
| Security approval | Pending |
| Legal/privacy approval | Pending |

## 5. Clean-candidate verification

| Required evidence | Exact target/result | Independent reviewer | Status |
| --- | --- | --- | --- |
| Full reachable-history artifact validator | Pending clean commit/ref | Pending | Pending |
| Dedicated redacted secret scan of files and history | Pending clean commit/ref | Pending | Pending |
| Old-to-new source manifest/diff | Pending | Pending | Pending |
| Hosted CI, Linux race and migration matrix | Pending | Pending | Pending |
| Immutable image, SBOM and provenance | Pending | Pending | Pending |
| GitHub/cache/fork/clone closure evidence | Pending | Pending | Pending |

## 6. Incident and Phase 0 disposition

| Approval | Name | Decision | Timestamp | Evidence/signature reference |
| --- | --- | --- | --- | --- |
| Incident commander | Pending | Pending | Pending | Pending |
| Repository owner | Pending | Pending | Pending | Pending |
| Security/CISO | Pending | Pending | Pending | Pending |
| Legal/privacy | Pending | Pending | Pending | Pending |
| Independent verifier | Pending | Pending | Pending | Pending |
| Phase 0 Program Council | Pending | Pending | Pending | Pending |

This record does not itself close the incident. Phase 0 remains failed until every required evidence item is complete and the named authorities approve the exact clean candidate.

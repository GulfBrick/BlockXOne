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

**Local technical-preparation authorisation:** On 2026-07-20 the user and repository decision owner authorised creation and validation of local Option A candidates only. No push was authorised. Generation 1 `C1` was rejected by the mandatory scanner. Generation 2 `R2` passed pre-metadata admission. This does not satisfy the formal selection below because credential action and named repository, Security and Legal/Privacy sign-offs remain pending.

| Local generation 2 field | Record |
| --- | --- |
| Accepted plan SHA-256 | `C91001B50979FA87CB7BDB88E20AAF1FF51E18B57EB590F7B737DEC8824ACA7C` |
| Rejected candidate (`C1`) | `38c23993ad866c1f95df192c4cb3075bf246218b`; safe rejected manifest preserved |
| Generation 2 checkpoint (`Q2`) | `ecbe7f950d1945c5eb2dfaa767caa6aebb80353b` |
| Parentless generation 2 root (`R2`) | `81e06c32976b3c15460c298bd453a1dfce20f3b9` |
| Exact `Q2` / `R2` tree | `0ca7a6dca26d3abef859160a50b93710fc118ddf` |
| Standalone local target | `C:\Users\danie\Documents\BlockXOne Production Clean v2`; `codex/production-clean-root-v2`; no remote |
| External exact-candidate record | `C:\Users\danie\Documents\BlockXOne Phase0 Recovery 20260719\clean-root-20260720\CANDIDATE-MANIFEST-v2.md` |

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
| Full reachable-history artifact validator | `R2` pre-metadata check passed locally; exact `C2` receipt must be recorded externally | Pending | Local technical evidence only |
| Dedicated redacted secret scan of files and history | Gitleaks 8.30.1 safe wrapper passed `R2` with zero findings; exact `C2` scan remains | Pending | Pending exact candidate |
| Old-to-new source manifest/diff | `Q2`/`R2` tree equality proved; generation 2 manifest path recorded above | Pending | Pending exact candidate |
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

# Program Risk Register

| ID | Risk | Likelihood | Impact | Current treatment | Owner |
| --- | --- | --- | --- | --- | --- |
| R-001 | Incorrect regulated perimeter or legal ownership model | Medium | Critical | G1 professional opinions and signed exclusions | Legal/Board/MLRO |
| R-002 | Cash, token, register and accounting records diverge | High | Critical | Double-entry ledger, reservations, daily reconciliation, material-break stop | Controller/Treasury |
| R-003 | Cross-tenant or privilege breach | High | Critical | Central auth, RLS, negative matrix, SoD and independent penetration test | CISO/CTO |
| R-004 | Duplicate or fabricated financial effect | High | Critical | Stable idempotency, atomic claims, provider evidence, reconciliation | Backend/Controller |
| R-005 | Contract identity/compliance/role bypass | High | Critical | Pinned conformance, invariants, external exact-bytecode audit | Blockchain/CISO |
| R-006 | Signer, nonce, finality or reorganisation failure | High | Critical | KMS/HSM/MPC, durable nonce queue, explicit chain state and drills | Blockchain/SRE |
| R-007 | Mock/dev/default behavior reaches production | High | Critical | Feature allowlist and startup/config negative tests | CTO/CISO |
| R-008 | UI reports completion before authoritative finality | High | High | Shared state machines, E2E failure paths and receipt evidence | Product/QA |
| R-009 | KYC/provider outage or unknown outcome is mishandled | High | High | Authenticated adapters, unknown states, retries and reconciliation | MLRO/Operations |
| R-010 | Sensitive documents or telemetry leak | Medium | Critical | Private storage, least privilege, redaction, DLP and privacy review | DPO/CISO |
| R-011 | Delivery agents overwrite or self-approve unsafe work | Medium | High | Isolated worktrees, file ownership, independent verification | Program Controller |
| R-012 | Unsupported commercial claims or pricing | Medium | High | Legal claim review and 10-15 customer validation sprint | Commercial/Legal |
| R-013 | Provider/external-audit lead time delays pilot | High | High | Early selection, contracts and readiness calendar | COO/Program Council |
| R-014 | Current code volume creates false sense of completion | High | High | Production progress reset, active requirement/evidence gates | Program Council |
| R-015 | Recovery, migration or cutover loses data | Medium | Critical | PITR, restore, dual run, reconciliation and rehearsed rollback | SRE/Controller |

Risks remain open until their phase evidence and authorized acceptance are recorded.

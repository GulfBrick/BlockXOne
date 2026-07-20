# Production Control Map

| Control domain | Preventive controls | Detective controls | Corrective controls | Primary phases |
| --- | --- | --- | --- | --- |
| Scope/legal | Feature allowlist, product approval, signed terms | Compliance/legal review, claim audit | Disable product, notify, remediation decision | 0, 1, 7, 11 |
| Identity/tenancy | OIDC/passkey/MFA, assignments, RLS, SoD | Access logs, negative tests, access review | Revoke, contain tenant, incident response | 2, 9 |
| Financial integrity | Fixed precision, double entry, reservations, idempotency | Reconciliation, trial balance, break ageing | Reversal, suspense, freeze affected workflow | 3, 6, 8 |
| Compliance | Eligibility policy, KYC/KYB, screening, dual control | Rescreening, monitoring, QA review | Suspend, EDD, case escalation | 4, 6 |
| Providers | Signed callbacks, stable keys, environment binding | Provider/bank reconciliation, health alerts | Unknown state, retry, manual resolution | 4, 6, 8 |
| Contracts | Conformance, roles, identity/claim checks, timelock | Invariants, audit, role/config monitoring | Pause, governed recovery/migration | 5, 9 |
| Chain operations | KMS policy, durable nonce, confirmation policy | Receipt/reorg/indexer monitoring | Replace/cancel/replay/reconcile | 5, 8 |
| Product UX | Server authority, explicit states, dangerous-action review | E2E, accessibility and user observation | Recovery paths, support, corrections | 7, 9 |
| Platform/release | Private IaC, secrets, signed artifacts, blocking CI | Scans, drift, alerts, provenance | Rollback, restore, incident process | 0, 8, 9 |
| Operations | Owned runbooks, training, limits | Daily control room, SLA/age monitoring | Escalation, stop flow, communications | 8, 10, 11 |

Detailed control evidence is indexed in `.planning/EVIDENCE-REGISTER.md` and the applicable phase control map.

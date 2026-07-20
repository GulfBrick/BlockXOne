# Blocker Register

| ID | Blocker | Severity | Status | Blocks | Owner | Exit evidence |
| --- | --- | --- | --- | --- | --- | --- |
| BLK-001 | Phase 0 exact clean commit not independently verified | P0 | Open; `C1` rejected, `R2` passed pre-metadata admission, exact `C2` evidence pending | Phase 0 | Independent verifier | `00-VERIFICATION.md` passed against exact clean commit |
| BLK-002 | Golden instrument and jurisdiction not professionally approved | P0 for G1 | Open | G1/Phase 1 | Legal/Product/Controller | Signed G1 decision pack |
| BLK-003 | Frontend had no automated tests | P0 | Remediated in working tree; exact-commit reproduction pending | Phase 0 evidence | Frontend/QA | 38 tests plus live containment probe on exact clean commit |
| BLK-004 | Production Compose was invalid | P0 | Remediated in working tree; exact-commit reproduction pending | Phase 0 evidence | Platform/SRE | Compose config plus 29 missing-variable negatives on exact clean commit |
| BLK-005 | CI/deploy/security paths contained false-success behavior | P0 | Static containment implemented; hosted mutation evidence pending | Phase 0/Release | Platform/CISO | Hosted CI failure propagation plus blocked deploy/rollback evidence |
| BLK-006 | Mock/default/raw-key production risks | P0 | Startup/config containment implemented; providers and signer deliberately unimplemented | Phase 0/Phases 4-5 | CTO/CISO | Exact-commit negative tests, then G4/G5 implementations |
| BLK-007 | No production-grade ledger/reservation/reconciliation | P0 | Open | G3 | Controller/Backend | G3 passed |
| BLK-008 | Compliance/payment/custody provider certification absent | P0 | Open | G4 | MLRO/Treasury/Custody | G4 passed |
| BLK-009 | Contract conformance, identity and privileged-operation gaps | P0 | Open; mint-to-unregistered expectation retained as explicit no-go | G5 | Blockchain/CISO/Legal | G5 plus external retest |
| BLK-010 | External assurance not completed | P0 | Open | Phase 9/Production | CISO/Legal/Controller | Phase 9 passed |
| BLK-011 | Tracked ZIP containing `.env.local` path and generated binaries are reachable from quarantined `origin/main` and old ancestry | P0 | Open; local generation 2 clean lineage prepared, but credential, old-host/cache/fork/clone and formal incident closure remain pending | Phase 0 and every remote action | Repository owner together with Security, credential and Legal/Privacy owners | Signed rotation assessment, formal Option A approval and complete hosted/distribution closure evidence |
| BLK-012 | Contract dev-tool audit reported 7 high, 1 moderate and 1 low findings | P0 | Remediated in working tree: exact patched overrides, full/runtime audits zero; exact-clean hosted reproduction pending | BASE-06/CI images | Blockchain/Platform/CISO | Clean exact-candidate CI proves install, compile/type generation, typecheck, 57 tests and zero full audit; upstream override-removal tracking recorded |
| BLK-013 | Docker image builds/provenance, Linux race tests and clean/current migration smoke not reproduced | P0 | Open; workflow gates defined locally | BASE-06/Phase 0 | Platform/SRE | Exact-clean-commit hosted CI, migrations and immutable image evidence |

No production implementation phase may bypass its upstream blocker.

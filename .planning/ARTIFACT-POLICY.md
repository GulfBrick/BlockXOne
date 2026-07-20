# Artifact and Evidence Policy

## Version-controlled artifacts

- PROJECT, REQUIREMENTS, ROADMAP and STATE.
- Phase context, plans, validation, verification, summaries and evidence indexes.
- Decision, risk, blocker, control, dependency and approval registers.
- ADRs, schemas, state machines, posting rules, role matrices and runbooks.
- Source, tests, migrations, IaC, CI/CD and deployment manifests.
- Redacted machine-readable test/scan reports where practical.

## External controlled artifacts

- Legal, tax and accounting opinions.
- Provider contracts/certifications.
- Penetration and smart-contract audit reports subject to confidentiality.
- Key-ceremony and production-access evidence.
- Customer/pilot approvals and regulated case evidence.

Repository indexes must reference these through stable identifiers and access-controlled locations without committing confidential contents.

## Prohibited repository artifacts

- Actual secrets, credentials, keys, seed phrases or raw tokens.
- Live identity documents, screening payloads, bank details or customer personal data.
- Local `.env` files, agent/connector state, logs, executables, caches or dependency trees.
- Generated evidence that cannot be tied to exact source/artifact/environment.

## Evidence lifecycle

1. Generate from exact target.
2. Record command/tool/version/time/environment.
3. Hash or sign immutable artifacts where applicable.
4. Review independently.
5. Mark Captured, Passed, Failed, Superseded or Approved.
6. Invalidate affected evidence after material change.
7. Retain according to legal, audit, privacy and incident requirements.

---
phase: "04"
name: "compliance-workflow-verification"
created: 2026-03-29
---

# Phase 4: Compliance Workflow Verification - Context

**Gathered:** 2026-03-29
**Status:** Verified complete
**Mode:** Derived from route inspection, policy review, and localhost flow probes

<domain>
## Phase Boundary

Prove that KYC case transitions, compliance queue visibility, wallet approval gating, and downstream eligibility in `blockxone` behave as one coherent compliance workflow.

</domain>

<decisions>
## Implementation Decisions

### Workflow State Strategy
- The latest reviewed KYC case should drive eligibility instead of any historical approved case.
- KYC rejection must propagate into `investor_profile` and wallet state so the persisted model does not contradict itself.
- Wallet approval and rejection endpoints should enforce explicit state transitions instead of silently no-oping.

### Verification Strategy
- Use real localhost API probes to prove the workflow rather than relying on route inspection alone.
- Treat empty-body POST transition failures as workflow defects because they break scripted or frontend-driven state changes.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `cmd/api/routes.go` contains the full KYC, compliance queue, and wallet approval flow.
- `internal/policy/policy.go` decides whether a user can subscribe, trade, or have a wallet approved.
- `internal/middleware/request_validator.go` sits in front of transition endpoints and can break no-body POST actions if it drifts.
- `internal/events/outbox.go` and `internal/audit/audit.go` provide traceability primitives once the route handlers emit the right state changes.

### Established Patterns
- Compliance case creation and submission are user-driven and should be auditable.
- Approval and rejection endpoints are operator-driven and should update both durable state and emitted events.
- Wallet approval is meaningful only if it follows the same KYC decision model as subscription and trading policy checks.

### Integration Points
- `cmd/api/routes.go`
- `internal/policy/policy.go`
- `internal/middleware/request_validator.go`
- `internal/events/outbox.go`
- `migrations/001_init.sql`

</code_context>

<specifics>
## Specific Ideas

- Keep `POST /kyc/cases/:id/submit`, `POST /compliance/cases/:id/approve`, and `POST /compliance/cases/:id/reject` usable without fake JSON bodies.
- Make KYC rejection revoke previously approved or pending wallets for the affected user.
- Verify the compliance queue sees submitted cases and that wallet approval returns to `400` after the latest KYC rejection.

</specifics>

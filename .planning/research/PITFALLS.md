# Production Research: Pitfalls

## Pitfall 1: Sprint Code Drift

- Warning signs: docs disagree, build wiring references missing symbols, multiple localhost defaults coexist
- Prevention: baseline phase must reconcile runtime, docs, and environment contracts before new feature work
- Phase mapping: Phase 1

## Pitfall 2: Mock Versus Production Divergence

- Warning signs: provider and monitoring modules exist in isolation but are not exercised through real workflows
- Prevention: create explicit integration phases for KYC, custody, payments, tokenization, and observability
- Phase mapping: Phases 4, 5, and 7

## Pitfall 3: Large Route Layer Fragility

- Warning signs: changes in auth, compliance, or token flows require editing `cmd/api/routes.go` in many places
- Prevention: stabilize behavior first, then extract high-risk orchestration incrementally instead of rewriting blindly
- Phase mapping: Phases 2 and 3

## Pitfall 4: Build Environment Ambiguity

- Warning signs: `go list` and `go build` disagree, CI/runtime versions drift, missing module entries appear late
- Prevention: pin toolchains, verify from clean shells and CI, and treat module hygiene as part of the product baseline
- Phase mapping: Phases 1 and 8

## Pitfall 5: Operational Readiness Assumptions

- Warning signs: monitoring docs exist, but alerting and health checks are not verified in a live stack
- Prevention: require staging-like smoke tests, dashboards, alerts, and runbooks before release
- Phase mapping: Phases 7, 8, and 9

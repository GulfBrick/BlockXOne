# Production Research: Features

## Table Stakes

- Clean checkout can build all backend binaries and the frontend
- Local infrastructure boots with documented commands and healthy dependencies
- Authentication, RBAC, and audit controls work consistently in non-demo flows
- KYC, wallet approval, subscription, token ops, and redemption flows are testable end-to-end
- Environment configuration is centralized and consistent
- Monitoring, health checks, and structured logs reflect actual runtime state
- CI validates backend, frontend, contracts, and core security checks

## Differentiators

- Provider abstraction layers for KYC, custody, and payments
- Mock and EVM chain modes behind a shared adapter
- Role-specific UX for admin, compliance, investor, issuer, and token agent users
- ATS-style RFQ marketplace already present as part of the product model

## Anti-Features For This Milestone

- More feature sprinting before the current platform is verified
- UI-only additions that do not improve core production readiness
- Multi-chain and advanced market-structure work before baseline chain reliability
- New third-party integrations before the current ones are wired and validated

## Implication

The roadmap should prioritize readiness debt over breadth. The next milestone should prove the existing product, not expand it.

# BlockXOne — Asset Tokenization Platform (MVP Build)

This repository is a **production-shaped MVP** for **BlockXOne**, implementing the core lifecycle described in the deck:
- Offering creation & publishing (Offering Manager)
- KYC/KYB + wallet approval (Compliance Officer)
- Subscription + payment recording
- Whitelist + mint/burn + freeze/force-transfer (Tokenisation Agent / Transfer Agent)
- Cap table + portfolio
- Redemptions + payouts
- ATS-style **RFQ** secondary trading (v1)

> Note: On-chain execution is implemented via a **Chain Adapter** abstraction.
> - `CHAIN_MODE=mock` (default): fully runnable end-to-end locally without a blockchain.
> - `CHAIN_MODE=evm`: wiring stubs are provided; you plug in contract addresses + ABI bindings.

---

## Quick start (local)

### 1) Prereqs
- Docker + Docker Compose
- Go 1.22+

### 2) Start dependencies
```bash
cp .env.example .env
docker compose up -d
```

### 3) Run migrations + seed demo users
```bash
make migrate
make seed
```

### 4) Run API + worker (two terminals)
```bash
make api
```

```bash
make worker
```

API runs at: `http://localhost:8080`

---

## Demo flow (scripted)
Run a complete issuance + secondary trade + redemption journey with role switching:

```bash
make e2e
```

---

## Repo layout
- `cmd/api` — HTTP API
- `cmd/worker` — outbox publisher + event handlers
- `internal/*` — modular domain packages (identity, compliance, offering, payments, tokenops, ledger, corpactions, marketplace, audit, events)
- `migrations/` — Postgres schema + seed data
- `docs/` — state machines, role matrix, OpenAPI notes
- `contracts/` — Solidity sources (compile/deploy in your environment for `CHAIN_MODE=evm`)
- `scripts/` — e2e journey, helper curl scripts

---

## Environment notes
- Auth is **dev header auth** by default for speed (`AUTH_MODE=dev`).
- All privileged actions are recorded in `audit_log` (append-only semantics).
- Event-driven workflows use an **Outbox** table + **NATS** pub/sub.

---

## Next steps (to production)
1. Replace dev auth with OIDC (Auth0/Cognito/Keycloak)
2. Integrate a KYC vendor (Sumsub/Onfido/Persona) in `internal/compliance/vendor/*`
3. Replace `CHAIN_MODE=mock` with `CHAIN_MODE=evm` + contract deployments + indexer
4. Harden operational controls (rate limiting, WAF, SOC2 controls, key mgmt, etc.)

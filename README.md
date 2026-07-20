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
- Go 1.24+
- Node.js 18+

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

Seeded local demo users after `make seed`:
- `investor@blockxone.local` — Investor
- `offering.manager@blockxone.local` — Offering Manager
- `compliance@blockxone.local` — Compliance Officer
- `issuer@blockxone.local` — Issuer Fund Manager
- `transfer.agent@blockxone.local` — Transfer Agent
- `token.agent@blockxone.local` — Tokenisation Agent
- `admin@blockxone.local` — Super Admin

Shared local demo password: `Admin123!`

### 4) Run API + worker (two terminals)
```bash
make api
```

```bash
make worker
```

API runs at: `http://localhost:8080`
Monitoring endpoints:
- `http://localhost:8080/healthz`
- `http://localhost:8080/health/detailed`
- `http://localhost:8080/metrics`

### 5) Run the web app (Next.js)
```bash
cd apps/web
npm ci
npm run dev
```

Web runs at: `http://localhost:3000`

> If PowerShell blocks `npm` with an execution policy error, run the same commands in **cmd.exe**, or use:
> `cmd /c "npm ci"` then `cmd /c "npm run dev"`.

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
- Local `.env.example` keeps `APP_ENV=dev` and `AUTH_MODE=dev` for fast header-auth development and seeded demo-user walkthroughs.
- Non-dev environments default to `AUTH_MODE=jwt`, require `JWT_SECRET`, and reject `AUTH_MODE=dev`.
- `DEV_ALLOW_ROLE_OVERRIDE` is a local-development escape hatch only and should stay `false` outside `APP_ENV=dev`.
- Seeded demo users are created by `make seed`; runtime login no longer auto-provisions local users on demand.
- Local browser/API defaults are `http://localhost:3000` for web and `http://localhost:8080` for API.
- CORS and rate limits are controlled by `CORS_ALLOWED_ORIGINS`, `RATE_LIMIT_API`, and `RATE_LIMIT_AUTH`.
- All privileged actions are recorded in `audit_log` (append-only semantics).
- Event-driven workflows use an **Outbox** table + **NATS** pub/sub.

---

## Next steps (to production)
1. Replace dev auth with OIDC (Auth0/Cognito/Keycloak)
2. Integrate a KYC vendor (Sumsub/Onfido/Persona) in `internal/compliance/vendor/*`
3. Replace `CHAIN_MODE=mock` with `CHAIN_MODE=evm` + contract deployments + indexer
4. Harden operational controls (rate limiting, WAF, SOC2 controls, key mgmt, etc.)

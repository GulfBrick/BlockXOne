# BlockXOne — Asset Tokenization Platform (MVP Build)

## Hosted website release

The current `apps/web` package contains the public BlockXOne website prepared for
the existing `block-x-one` Vercel project. Set its Root Directory to `apps/web`,
Framework Preset to Next.js, and Node.js Version to 22.x. The package's Vercel
configuration runs installation and builds with the pinned Node/npm toolchain.

Set these non-secret values for both production and preview:

```text
BLOCKXONE_WEB_SURFACE=public
NEXT_PUBLIC_BLOCKXONE_WEB_SURFACE=public
BLOCKXONE_RELEASE_MODE=production
NEXT_PUBLIC_BLOCKXONE_RELEASE_MODE=production
NEXT_PUBLIC_DEMO_REQUEST_ENABLED=false
NEXT_PUBLIC_DEMO_REQUEST_ENDPOINT=https://oqkevkjbkpugjotihtda.supabase.co/functions/v1/demo-request
SERVER_ACTION_ALLOWED_ORIGINS=block-x-one.vercel.app,bx1.co.za,www.bx1.co.za
```

Leave `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_DEMO_PRIVACY_NOTICE_URL` unset for
this showcase release. The enquiry endpoint is configured to the existing
Supabase function; platform authentication and financial APIs are not migrated
by this website release. Intake is
disabled: the enquiry form is not rendered and cannot submit personal details.
Enabling intake separately
requires an approved, published privacy notice and verified Supabase origin,
abuse-control, retention, and notification configuration. Do not use placeholder
controller details or turn off the enabled-intake validation gates.

This release does not host or authorize financial operations, investor accounts,
payments, token issuance, or production blockchain execution. Authenticated
platform and API routes remain unavailable on the public website. The historical
MVP setup below is not the deployment procedure for this hosted website.

Vercel commercial use requires an eligible paid plan. Connecting `bx1.co.za`
requires the exact DNS records issued for this project; preserve existing email
and verification records. Never publish `.env` files, preview credentials,
database secrets, signer assets, runtime dumps, or local support artifacts.

Validate a preview deployment and merge through a normal pull request. Do not
force-replace the existing `main` history. A technically successful deployment
does not establish eligibility for commercial use on the selected hosting plan.

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

### 4) Run API + worker (two terminals)
```bash
make api
```

```bash
make worker
```

API runs at: `http://localhost:8080`

### 5) Run the web app (Next.js)
```bash
cd apps/web
npm ci
npm run dev
```

Web runs at: `http://localhost:5000`

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
- Auth is **dev header auth** by default for speed (`AUTH_MODE=dev`).
- All privileged actions are recorded in `audit_log` (append-only semantics).
- Event-driven workflows use an **Outbox** table + **NATS** pub/sub.

---

## Next steps (to production)
1. Replace dev auth with OIDC (Auth0/Cognito/Keycloak)
2. Integrate a KYC vendor (Sumsub/Onfido/Persona) in `internal/compliance/vendor/*`
3. Replace `CHAIN_MODE=mock` with `CHAIN_MODE=evm` + contract deployments + indexer
4. Harden operational controls (rate limiting, WAF, SOC2 controls, key mgmt, etc.)

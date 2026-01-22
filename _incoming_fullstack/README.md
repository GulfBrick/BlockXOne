# BlockXOne (Fullstack Dev Bundle)

This bundle combines:
- **Backend**: Go (Gin) API + Postgres + Redis + NATS + MinIO, with RBAC, KYC workflow, wallet approval, whitelist/mint/burn, cap table/holdings, RFQ marketplace settlement, redemptions, audit log.
- **Frontend**: Next.js app (your existing UI) with **MetaMask integration** (wagmi) + **multi-chain selector** (testnets + mainnets).

## Ports (local dev)
- Frontend: http://localhost:5000
- Backend API: http://localhost:8080
- Postgres: localhost:5432
- Redis: localhost:6379
- NATS: localhost:4222 (monitor: http://localhost:8222)
- MinIO: http://localhost:9000 (console: http://localhost:9001)

## 1) Start infrastructure (Postgres/Redis/NATS/MinIO)
From repo root:

```bash
cd BlockXOne-fullstack
docker compose up -d
```

## 2) Start backend API + worker
Open two terminals.

**Terminal A (API):**
```bash
cd backend
cp .env.example .env
make migrate
make seed
make api
```

**Terminal B (Worker):**
```bash
cd backend
cp .env.example .env
make worker
```

> Note: This project uses `AUTH_MODE=dev` by default. The frontend sends `X-Dev-User-Id`, `X-Dev-Email`, and `X-Dev-Roles` headers.

## 3) Start frontend
```bash
cd apps/web
# ensure the API points to the backend
# (already set in apps/web/.env.local)

npm install
npm run dev
```

## 4) MetaMask + testnet usage
- Use the chain selector (top navbar) to switch between supported chains.
- Click **Connect MetaMask**.
- Click **Link <address>** to sign a message and register the wallet with the backend.

Wallets are created as `PENDING` and require approval by a user with the `Compliance Officer` permissions (dev role headers).

## 5) Quick E2E checklist (dev)
1. Login into the app (demo auth)
2. Submit KYC (Investor)
3. Approve KYC (Compliance Officer)
4. Connect + Link MetaMask wallet
5. Approve wallet (Compliance Officer)
6. Create offering (Offering Manager)
7. Subscribe + Payment notify
8. Mint batch (Tokenisation Agent)
9. View portfolio / cap table
10. RFQ listing + match + settlement (Marketplace)
11. Redemption request + approve + burn + payout

## Notes
- On/off-ramp APIs are included as **stubs** for now:
  - `GET /v1/chains`
  - `POST /v1/onramp/quote`, `POST /v1/onramp/session`
  - `POST /v1/offramp/quote`, `POST /v1/offramp/payout`

Replace the stub handlers with a real provider (Transak / MoonPay / Ramp / Sardine / etc.) once you select one.

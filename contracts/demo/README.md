# Hosted synthetic fund demonstration

This slice demonstrates a fictional fund lifecycle, not a production investment product. Cash is synthetic ZAR_TEST. Fund units are whole, non-transferable units on Polygon Amoy 80002. One presenter drives fictional roles; no independent approval, KYC, legal offering or real-money settlement is implied.

## Hosted dependencies

- Existing isolated Supabase TEST `fegnnnlseuejkrusbbkv`, never production.
- Existing Vercel project, branch `codex/testnet-fund-demo-20260920`, Preview only.
- New `bx1_demo` schema from `20260920161000_testnet_fund_demo.sql`.
- A fresh test presenter with active native profile/organisation membership. Closed historical acceptance-test identities must stay closed.
- Restricted `bx1_demo_chain_verifier` credential saved only as Preview branch Secret `BLOCKXONE_DEMO_DATABASE_URL`. The migration creates it NOLOGIN; activate it only for the demo backend, with a strong unique secret. Never use postgres or Supabase service-role credentials in the web app. Certificate verification is mandatory.
- `BLOCKXONE_TESTNET_FUND_DEMO=enabled`, native Supabase paired mode, TEST URL/publishable key, exact Preview origin and Amoy RPC. The runtime independently rejects production and mainnet.
- Cloud-generated `artifact.generated.ts`, bound to the Solidity source hash, is included. The cloud workflow recompiles and verifies it. A null artifact cannot deploy a token.

No local service/build/database/test is required. GitHub's disposable PostgreSQL 17 service runs the synthetic SQL fixture; it is not the hosted app database.

## Rehearsal

1. Sign in to the isolated Preview; open `/workspace/testnet-fund`.
2. Connect the presenter MetaMask account on Amoy with test POL for gas. Keep signing keys in MetaMask.
3. Create a fictional fund, e.g. 10,000 synthetic cents per unit and 10,000 authorised whole units.
4. Deploy the demonstration token with MetaMask. Verify the transaction after twelve confirmations, then open/freeze the offering.
5. Subscribe for 100 units using the connected address as fictional investor. Record synthetic funding, approve demo issuance, sign the mint, verify its receipt.
6. Refresh. Verify 100 confirmed units, synthetic funding and balanced journals remain saved.
7. Record 10,000 cents of explicitly synthetic income. Allocate a distribution of 10,000 cents. Inspect immutable investor entitlements.
8. Request redemption of 100 units. Approve demo burn, sign in MetaMask, verify receipt, then record the synthetic payout.
9. Refresh and reconcile token supply/wallet balances, ownership register, unit-ledger supply, synthetic cash and balanced journals. The full-exit example ends with zero units and zero synthetic cash.

Never label a submitted/unknown transaction confirmed. If the response is ambiguous, use refresh and exact-request retry. Wallet transaction hashes survive refresh, scoped to the project, user, fund and operation. Use MetaMask Activity to recover an unknown hash; do not send a replacement blindly.

## Evidence and limits

The cloud suite separately proves source compilation/interface, web tests/typecheck/build, and serial PostgreSQL state-machine behavior using fabricated receipt hashes. Those hashes are fixture data, NOT Amoy evidence. Hosted browser execution, genuine Amoy deploy/mint/burn and final live reconciliation are separate required rehearsal evidence. Remaining administration/recovery, real-estate, production financial controls and assurance are deferred or incomplete, not waived.

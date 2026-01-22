#!/usr/bin/env bash
set -euo pipefail

API_URL="${API_URL:-http://localhost:8080}"

# Seeded users (cmd/seed)
INV1="11111111-1111-1111-1111-111111111111"
OFF_MGR="22222222-2222-2222-2222-222222222222"
COMPLIANCE="33333333-3333-3333-3333-333333333333"
ISSUER="44444444-4444-4444-4444-444444444444"
TRANSFER="55555555-5555-5555-5555-555555555555"
TOKEN_AGENT="66666666-6666-6666-6666-666666666666"
ADMIN="99999999-9999-9999-9999-999999999999"

# Second investor (not seeded; we use dev role override)
INV2="12121212-1212-1212-1212-121212121212"
INVESTOR_ORG="eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"

hdr() {
  local uid="$1"
  local email="$2"
  echo -H "X-Dev-User-Id: ${uid}" -H "X-Dev-Email: ${email}"
}

hdr_role() {
  local uid="$1"
  local email="$2"
  local roles="$3"
  echo -H "X-Dev-User-Id: ${uid}" -H "X-Dev-Email: ${email}" -H "X-Dev-Roles: ${roles}" -H "X-Dev-Org-Id: ${INVESTOR_ORG}"
}

echo "== BlockXOne E2E Journey =="

echo "1) Offering Manager creates + publishes offering"
resp=$(curl -sS -X POST "${API_URL}/v1/offerings" \
  $(hdr "${OFF_MGR}" "offering.manager@blockxone.local") \
  -H "Content-Type: application/json" \
  -d '{
    "asset_type":"FUND",
    "name":"BlockXOne Demo Fund",
    "description":"Demo offering for end-to-end flow",
    "chain_id":137,
    "price":"100.00",
    "currency":"USD",
    "transfer_agent_org_id":"cccccccc-cccc-cccc-cccc-cccccccccccc",
    "tokenisation_agent_org_id":"dddddddd-dddd-dddd-dddd-dddddddddddd"
  }')
OFFERING_ID=$(echo "$resp" | python -c 'import sys,json; print(json.load(sys.stdin)["id"])')
echo "  Offering ID: ${OFFERING_ID}"

curl -sS -X POST "${API_URL}/v1/offerings/${OFFERING_ID}/publish" \
  $(hdr "${OFF_MGR}" "offering.manager@blockxone.local") >/dev/null
echo "  Published"

echo "2) Investor1 KYC create + submit"
resp=$(curl -sS -X POST "${API_URL}/v1/kyc/cases" \
  $(hdr "${INV1}" "investor@blockxone.local") \
  -H "Content-Type: application/json" \
  -d '{"type":"KYC"}')
KYC1=$(echo "$resp" | python -c 'import sys,json; print(json.load(sys.stdin)["id"])')
curl -sS -X POST "${API_URL}/v1/kyc/cases/${KYC1}/submit" \
  $(hdr "${INV1}" "investor@blockxone.local") >/dev/null
echo "  KYC Case: ${KYC1} submitted"

echo "3) Compliance approves Investor1 KYC"
curl -sS -X POST "${API_URL}/v1/compliance/cases/${KYC1}/approve" \
  $(hdr "${COMPLIANCE}" "compliance@blockxone.local") >/dev/null
echo "  Approved"

echo "4) Investor1 wallet connect (devskip signature)"
resp=$(curl -sS -X POST "${API_URL}/v1/wallets/connect" \
  $(hdr "${INV1}" "investor@blockxone.local") \
  -H "Content-Type: application/json" \
  -d '{
    "address":"0x1111111111111111111111111111111111111111",
    "chain_id":137,
    "message":"BlockXOne wallet connect (dev)",
    "signature":"devskip"
  }')
WALLET1=$(echo "$resp" | python -c 'import sys,json; print(json.load(sys.stdin)["id"])')
echo "  Wallet1 ID: ${WALLET1}"

echo "5) Compliance approves Investor1 wallet"
curl -sS -X POST "${API_URL}/v1/wallets/${WALLET1}/approve" \
  $(hdr "${COMPLIANCE}" "compliance@blockxone.local") >/dev/null
echo "  Wallet approved"

echo "6) Investor1 subscribes"
resp=$(curl -sS -X POST "${API_URL}/v1/offerings/${OFFERING_ID}/subscribe" \
  $(hdr "${INV1}" "investor@blockxone.local") \
  -H "Content-Type: application/json" \
  -d '{"units":"10","amount":"1000"}')
SUB1=$(echo "$resp" | python -c 'import sys,json; print(json.load(sys.stdin)["id"])')
echo "  Subscription1: ${SUB1}"

echo "7) Transfer Agent approves subscription"
curl -sS -X POST "${API_URL}/v1/subscriptions/${SUB1}/approve" \
  $(hdr "${TRANSFER}" "transfer.agent@blockxone.local") >/dev/null
echo "  Approved"

echo "8) Admin records payment received"
curl -sS -X POST "${API_URL}/v1/payments/notify" \
  $(hdr "${ADMIN}" "admin@blockxone.local") \
  -H "Content-Type: application/json" \
  -d "{\"subscription_id\":\"${SUB1}\",\"method\":\"BANK\",\"amount\":\"1000\",\"reference\":\"WIRE-DEMO-1\"}" >/dev/null
echo "  Payment recorded"

echo "9) Tokenisation Agent executes whitelist request"
# Fetch latest whitelist request
resp=$(curl -sS "${API_URL}/v1/debug/whitelist-requests" \
  $(hdr "${TOKEN_AGENT}" "token.agent@blockxone.local"))
WR1=$(echo "$resp" | python -c 'import sys,json; data=json.load(sys.stdin); print(data[0]["id"] if data else "")')
if [[ -z "${WR1}" ]]; then
  echo "  ERROR: no whitelist request found"
  exit 1
fi
curl -sS -X POST "${API_URL}/v1/whitelist-requests/${WR1}/execute" \
  $(hdr "${TOKEN_AGENT}" "token.agent@blockxone.local") >/dev/null
echo "  Whitelisted (request ${WR1})"

echo "10) Tokenisation Agent mints tokens for subscription"
curl -sS -X POST "${API_URL}/v1/token-batches/mint" \
  $(hdr "${TOKEN_AGENT}" "token.agent@blockxone.local") \
  -H "Content-Type: application/json" \
  -d "{\"subscription_id\":\"${SUB1}\"}" >/dev/null
echo "  Mint executed"

echo "11) Investor1 portfolio"
curl -sS "${API_URL}/v1/portfolio" \
  $(hdr "${INV1}" "investor@blockxone.local") | python -m json.tool

echo "== Onboard Investor2 (for secondary trade) =="

echo "12) Investor2 KYC create + submit"
resp=$(curl -sS -X POST "${API_URL}/v1/kyc/cases" \
  $(hdr_role "${INV2}" "investor2@blockxone.local" "Investor") \
  -H "Content-Type: application/json" \
  -d '{"type":"KYC"}')
KYC2=$(echo "$resp" | python -c 'import sys,json; print(json.load(sys.stdin)["id"])')
curl -sS -X POST "${API_URL}/v1/kyc/cases/${KYC2}/submit" \
  $(hdr_role "${INV2}" "investor2@blockxone.local" "Investor") >/dev/null

curl -sS -X POST "${API_URL}/v1/compliance/cases/${KYC2}/approve" \
  $(hdr "${COMPLIANCE}" "compliance@blockxone.local") >/dev/null
echo "  Investor2 KYC approved"

echo "13) Investor2 wallet connect + approve"
resp=$(curl -sS -X POST "${API_URL}/v1/wallets/connect" \
  $(hdr_role "${INV2}" "investor2@blockxone.local" "Investor") \
  -H "Content-Type: application/json" \
  -d '{
    "address":"0x2222222222222222222222222222222222222222",
    "chain_id":137,
    "message":"BlockXOne wallet connect (dev)",
    "signature":"devskip"
  }')
WALLET2=$(echo "$resp" | python -c 'import sys,json; print(json.load(sys.stdin)["id"])')

curl -sS -X POST "${API_URL}/v1/wallets/${WALLET2}/approve" \
  $(hdr "${COMPLIANCE}" "compliance@blockxone.local") >/dev/null
echo "  Investor2 wallet approved"

echo "14) Investor2 subscribes small amount to trigger whitelist (no mint needed)"
resp=$(curl -sS -X POST "${API_URL}/v1/offerings/${OFFERING_ID}/subscribe" \
  $(hdr_role "${INV2}" "investor2@blockxone.local" "Investor") \
  -H "Content-Type: application/json" \
  -d '{"units":"1","amount":"100"}')
SUB2=$(echo "$resp" | python -c 'import sys,json; print(json.load(sys.stdin)["id"])')

curl -sS -X POST "${API_URL}/v1/subscriptions/${SUB2}/approve" \
  $(hdr "${TRANSFER}" "transfer.agent@blockxone.local") >/dev/null

# Execute whitelist for investor2
resp=$(curl -sS "${API_URL}/v1/debug/whitelist-requests" \
  $(hdr "${TOKEN_AGENT}" "token.agent@blockxone.local"))
WR2=$(echo "$resp" | python -c 'import sys,json; data=json.load(sys.stdin); print(data[0]["id"] if data else "")')
curl -sS -X POST "${API_URL}/v1/whitelist-requests/${WR2}/execute" \
  $(hdr "${TOKEN_AGENT}" "token.agent@blockxone.local") >/dev/null
echo "  Investor2 whitelisted"

echo "== Secondary Trade (RFQ v1) =="

echo "15) Investor1 creates listing (sell 5 units)"
resp=$(curl -sS -X POST "${API_URL}/v1/marketplace/listings" \
  $(hdr "${INV1}" "investor@blockxone.local") \
  -H "Content-Type: application/json" \
  -d "{\"offering_id\":\"${OFFERING_ID}\",\"wallet_id\":\"${WALLET1}\",\"units\":\"5\",\"price\":\"100\",\"currency\":\"USD\"}")
LISTING_ID=$(echo "$resp" | python -c 'import sys,json; print(json.load(sys.stdin)["id"])')
echo "  Listing: ${LISTING_ID}"

echo "16) Investor2 creates RFQ (buy 5 units)"
resp=$(curl -sS -X POST "${API_URL}/v1/marketplace/rfq" \
  $(hdr_role "${INV2}" "investor2@blockxone.local" "Investor") \
  -H "Content-Type: application/json" \
  -d "{\"offering_id\":\"${OFFERING_ID}\",\"wallet_id\":\"${WALLET2}\",\"units\":\"5\",\"max_price\":\"100\",\"currency\":\"USD\"}")
RFQ_ID=$(echo "$resp" | python -c 'import sys,json; print(json.load(sys.stdin)["id"])')
echo "  RFQ: ${RFQ_ID}"

echo "17) Admin matches and settles"
curl -sS -X POST "${API_URL}/v1/marketplace/match" \
  $(hdr "${ADMIN}" "admin@blockxone.local") \
  -H "Content-Type: application/json" \
  -d "{\"listing_id\":\"${LISTING_ID}\",\"rfq_id\":\"${RFQ_ID}\"}" | python -m json.tool

echo "18) Portfolios after trade"
echo "-- Investor1 --"
curl -sS "${API_URL}/v1/portfolio" $(hdr "${INV1}" "investor@blockxone.local") | python -m json.tool
echo "-- Investor2 --"
curl -sS "${API_URL}/v1/portfolio" $(hdr_role "${INV2}" "investor2@blockxone.local" "Investor") | python -m json.tool

echo "== Redemption =="

echo "19) Investor2 requests redemption of 2 tokens"
resp=$(curl -sS -X POST "${API_URL}/v1/redemptions/request" \
  $(hdr_role "${INV2}" "investor2@blockxone.local" "Investor") \
  -H "Content-Type: application/json" \
  -d "{\"offering_id\":\"${OFFERING_ID}\",\"amount_tokens\":\"2\",\"amount_cash\":\"200\"}")
RED_ID=$(echo "$resp" | python -c 'import sys,json; print(json.load(sys.stdin)["id"])')
echo "  Redemption: ${RED_ID}"

echo "20) Issuer approves redemption"
curl -sS -X POST "${API_URL}/v1/redemptions/${RED_ID}/approve" \
  $(hdr "${ISSUER}" "issuer@blockxone.local") >/dev/null
echo "  Approved"

echo "21) Tokenisation Agent burns tokens"
curl -sS -X POST "${API_URL}/v1/token-batches/burn" \
  $(hdr "${TOKEN_AGENT}" "token.agent@blockxone.local") \
  -H "Content-Type: application/json" \
  -d "{\"redemption_id\":\"${RED_ID}\"}" | python -m json.tool

echo "22) Issuer executes payouts"
curl -sS -X POST "${API_URL}/v1/payouts/execute" \
  $(hdr "${ISSUER}" "issuer@blockxone.local") | python -m json.tool

echo "23) Investor2 portfolio after redemption"
curl -sS "${API_URL}/v1/portfolio" $(hdr_role "${INV2}" "investor2@blockxone.local" "Investor") | python -m json.tool

echo "== DONE =="

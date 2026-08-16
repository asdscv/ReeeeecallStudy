#!/usr/bin/env bash
# ============================================================================
# payment-webhook edge function — end-to-end test (self-contained, no external
# payment provider). Validates the money-minting seam is fail-closed, HMAC-gated,
# idempotent, and grants ONLY from the server-side intent snapshot:
#   * no secret configured        → 503 (never grants)
#   * bad / missing signature     → 401
#   * SIGNED legacy direct-grant body (user_id+amount_won) → 400, grants nothing
#   * signed merchant_uid         → 200 + wallet credited from payment_intents
#   * webhook redelivery (same id)→ idempotent (granted once)
#   * unknown / absent merchant_uid → 400, wallet untouched
#
# The body can neither pick a price nor self-grant: create_payment_intent snapshots
# price+kind server-side (mig 120) and confirm_payment applies THAT snapshot, so every
# amount asserted here is read back from the intent rather than hardcoded.
#
# Requires `supabase start` + `supabase db reset`.
# CI: `Edge & webhook E2E (Supabase)` job. Locally: bash supabase/tests/payment_webhook_e2e.sh
# ============================================================================
set -uo pipefail
command -v node >/dev/null 2>&1 || export PATH="/opt/homebrew/opt/node/bin:$PATH"
cd "$(cd "$(dirname "$0")/../.." && pwd)"

PASS=0; FAIL=0
chk() { if [ "$2" = "$3" ]; then echo "  ✅ $1 ($2)"; PASS=$((PASS+1)); else echo "  ❌ $1 — expected '$3' got '$2'"; FAIL=$((FAIL+1)); fi; }
J() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s)$1)}catch(e){console.log('')}})"; }

ST=$(supabase status -o json)
API=$(echo "$ST" | J .API_URL)
ANON=$(echo "$ST" | J .ANON_KEY)
SVC=$(echo "$ST" | J .SERVICE_ROLE_KEY)
DBURL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
[ -z "$API" ] && { echo "FATAL: local stack not running"; exit 1; }
FN="$API/functions/v1/payment-webhook"
SECRET="test_webhook_secret_123"

# a real user to credit
EMAIL="pw_$(date +%s)@example.com"; PW="Passw0rd!e2e"
USERID=$(curl -s "$API/auth/v1/admin/users" -H "apikey: $SVC" -H "Authorization: Bearer $SVC" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\",\"email_confirm\":true}" | J .id)
TOK=$(curl -s "$API/auth/v1/token?grant_type=password" -H "apikey: $ANON" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}" | J .access_token)
[ -z "$USERID" ] && { echo "FATAL: no user"; exit 1; }
[ -z "$TOK" ] && { echo "FATAL: no access token"; exit 1; }
echo "user=$USERID"

sign() { node -e "console.log(require('crypto').createHmac('sha256',process.argv[1]).update(process.argv[2]).digest('hex'))" "$SECRET" "$1"; }
post() { curl -s -o /dev/null -w "%{http_code}" "$FN" -H "apikey: $ANON" -H 'Content-Type: application/json' -H "x-webhook-signature: $2" -d "$1"; }
# coalesce OUTSIDE the row lookup: before the first grant there is no balance row at all,
# and a bare `select ... where user_id=` would return the empty string, not 0.
wallet() { psql "$DBURL" -tAc "select coalesce((select balance from ai_credit_balance where user_id='$USERID'),0)"; }
# open a server-authoritative intent AS THE USER (auth.uid()), print its merchant_uid
intent() { curl -s "$API/rest/v1/rpc/create_payment_intent" -H "apikey: $ANON" -H "Authorization: Bearer $TOK" \
  -H 'Content-Type: application/json' -d "{\"p_product_id\":\"$1\"}" | J .merchant_uid; }
# what the SERVER snapshotted for that order — the only legitimate grant amount
snapshot() { psql "$DBURL" -tAc "select amount_micro_usd from payment_intents where merchant_uid='$1'"; }

# $1 = env file, $2 = expected no-signature probe code for THIS env (503 when no
# secret, 401 when the secret is set). Waiting for the exact code confirms the NEW
# serve took over (a stale prior serve returns the other code).
serve() { pkill -f "supabase functions serve" 2>/dev/null; pkill -9 -f "functions serve payment-webhook" 2>/dev/null
  # wait until the endpoint is FULLY down (000) so the port/worker is released,
  # else a new `functions serve` fails with InvalidWorkerCreation.
  for i in $(seq 1 25); do [ "$(curl -s -o /dev/null -w '%{http_code}' "$FN" -X POST -H 'Content-Type: application/json' -d '{}' 2>/dev/null)" = "000" ] && break; sleep 1; done
  sleep 2
  nohup supabase functions serve payment-webhook --env-file "$1" > /tmp/pw_serve.log 2>&1 &
  local c=000
  for i in $(seq 1 60); do
    c=$(curl -s -o /dev/null -w "%{http_code}" "$FN" -X POST -H 'Content-Type: application/json' -d '{}' 2>/dev/null)
    [ "$c" = "$2" ] && { echo "  serve ready (http $c) ${i}s"; sleep 2; return 0; }
    sleep 1
  done
  echo "  serve never ready (last $c, want $2)"; tail -8 /tmp/pw_serve.log; return 1; }

# ── PHASE 1: NO SECRET → fail-closed 503 ──
echo "── no secret configured (fail-closed) ──"
printf 'SUPABASE_SERVICE_ROLE_KEY=%s\n' "$SVC" > /tmp/pw_env_nosecret
serve /tmp/pw_env_nosecret 503 || exit 1
PROBE='{"merchant_uid":"pi_probe"}'
chk "no-secret → 503 (never grants)" "$(post "$PROBE" "$(sign "$PROBE")")" "503"

# ── PHASE 2: SECRET set → signature-gated, intent-reconciled grant ──
echo "── secret configured ──"
printf 'PAYMENT_WEBHOOK_SECRET=%s\nSUPABASE_SERVICE_ROLE_KEY=%s\n' "$SECRET" "$SVC" > /tmp/pw_env
serve /tmp/pw_env 401 || exit 1

chk "bad signature → 401" "$(post "$PROBE" "deadbeef")" "401"
chk "missing signature → 401" "$(curl -s -o /dev/null -w '%{http_code}' "$FN" -H "apikey: $ANON" -H 'Content-Type: application/json' -d "$PROBE")" "401"

# The legacy direct-grant body (user_id + amount_won + payment_id) was REMOVED: a body may
# only name WHICH order settled. A CORRECTLY SIGNED legacy body must still be refused —
# holding the secret must not be enough to pick your own price. This is the assertion that
# keeps the removed path removed.
echo "── legacy direct-grant body is refused even when signed ──"
LEGACY="{\"user_id\":\"$USERID\",\"amount_won\":5000,\"payment_id\":\"pay_legacy\"}"
chk "signed legacy body → 400" "$(post "$LEGACY" "$(sign "$LEGACY")")" "400"
chk "legacy body granted nothing" "$(wallet)" "0"

# ── HAPPY PATH: intent reconciliation ──
echo "── signed merchant_uid → grant from the server snapshot ──"
MU=$(intent credits_1000)
[ -z "$MU" ] && { echo "FATAL: create_payment_intent returned no merchant_uid"; exit 1; }
SNAP=$(snapshot "$MU")
echo "  intent=${MU:0:14}… snapshot=$SNAP"
B1="{\"merchant_uid\":\"$MU\",\"provider\":\"e2e\",\"provider_payment_id\":\"charge_1\"}"
chk "signed intent → 200 (grant)" "$(post "$B1" "$(sign "$B1")")" "200"
sleep 1
chk "wallet credited from the SNAPSHOT" "$(wallet)" "$SNAP"

# idempotent: same order redelivered → granted once
chk "redelivery same merchant_uid → 200" "$(post "$B1" "$(sign "$B1")")" "200"
sleep 1
chk "idempotent — wallet unchanged" "$(wallet)" "$SNAP"

# a SECOND order stacks on top
MU2=$(intent credits_5000)
SNAP2=$(snapshot "$MU2")
B2="{\"merchant_uid\":\"$MU2\",\"provider\":\"e2e\",\"provider_payment_id\":\"charge_2\"}"
chk "second intent → 200" "$(post "$B2" "$(sign "$B2")")" "200"
sleep 1
chk "wallet stacks (snap1+snap2)" "$(wallet)" "$((SNAP+SNAP2))"

# ── refusals never move money ──
echo "── unknown / absent references ──"
UNK='{"merchant_uid":"pi_does_not_exist"}'
chk "unknown merchant_uid → 400" "$(post "$UNK" "$(sign "$UNK")")" "400"
NOMU='{"provider":"e2e"}'
chk "body without merchant_uid → 400" "$(post "$NOMU" "$(sign "$NOMU")")" "400"
sleep 1
chk "wallet untouched by refusals" "$(wallet)" "$((SNAP+SNAP2))"

echo ""; echo "════════ RESULT: PASS=$PASS FAIL=$FAIL ════════"
pkill -f "functions serve payment-webhook" 2>/dev/null
# cleanup — the auth user cascades ai_credit_balance / payment_intents
curl -s -X DELETE "$API/auth/v1/admin/users/$USERID" -H "apikey: $SVC" -H "Authorization: Bearer $SVC" >/dev/null
[ "$FAIL" = "0" ] && { echo "ALL_PAYMENT_WEBHOOK_TESTS_PASSED"; exit 0; } || { echo "PAYMENT_WEBHOOK_FAILURES"; exit 1; }

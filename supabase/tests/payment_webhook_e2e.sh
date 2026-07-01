#!/usr/bin/env bash
# ============================================================================
# payment-webhook edge function — LOCAL end-to-end test (self-contained, no
# external payment provider). Validates the money-minting seam is fail-closed +
# HMAC-gated + idempotent:
#   * no secret configured        → 503 (never grants)
#   * bad / missing signature     → 401
#   * valid HMAC signature        → 200 + micro-WON granted to the wallet
#   * webhook redelivery (same id)→ idempotent (granted once)
# Requires `supabase start` + `supabase db reset` (migrations 108-115 applied).
# NOT CI-wired (needs the Docker stack); run: bash supabase/tests/payment_webhook_e2e.sh
# ============================================================================
set -uo pipefail
command -v node >/dev/null 2>&1 || export PATH="/opt/homebrew/opt/node/bin:$PATH"
cd "$(cd "$(dirname "$0")/../.." && pwd)"

PASS=0; FAIL=0
chk() { if [ "$2" = "$3" ]; then echo "  ✅ $1 ($2)"; PASS=$((PASS+1)); else echo "  ❌ $1 — expected '$3' got '$2'"; FAIL=$((FAIL+1)); fi; }

ST=$(supabase status -o json)
API=$(echo "$ST" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).API_URL))")
ANON=$(echo "$ST" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).ANON_KEY))")
SVC=$(echo "$ST" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).SERVICE_ROLE_KEY))")
DBURL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
[ -z "$API" ] && { echo "FATAL: local stack not running"; exit 1; }
FN="$API/functions/v1/payment-webhook"
SECRET="test_webhook_secret_123"

# a real user to credit
EMAIL="pw_$(date +%s)@example.com"; PW="Passw0rd!e2e"
USERID=$(curl -s "$API/auth/v1/admin/users" -H "apikey: $SVC" -H "Authorization: Bearer $SVC" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\",\"email_confirm\":true}" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id||''))")
TOK=$(curl -s "$API/auth/v1/token?grant_type=password" -H "apikey: $ANON" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).access_token||''))")
[ -z "$USERID" ] && { echo "FATAL: no user"; exit 1; }
echo "user=$USERID"

sign() { node -e "console.log(require('crypto').createHmac('sha256',process.argv[1]).update(process.argv[2]).digest('hex'))" "$SECRET" "$1"; }
post() { curl -s -o /dev/null -w "%{http_code}" "$FN" -H "apikey: $ANON" -H 'Content-Type: application/json' -H "x-webhook-signature: $2" -d "$1"; }
wallet() { psql() { command psql "$DBURL" -tAc "$1"; }; command psql "$DBURL" -tAc "select coalesce(balance,0) from ai_credit_balance where user_id='$USERID'"; }

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
BODY="{\"user_id\":\"$USERID\",\"amount_won\":5000,\"payment_id\":\"pay_x\"}"
chk "no-secret → 503 (never grants)" "$(post "$BODY" "$(sign "$BODY")")" "503"

# ── PHASE 2: SECRET set → signature-gated grant ──
echo "── secret configured ──"
printf 'PAYMENT_WEBHOOK_SECRET=%s\nSUPABASE_SERVICE_ROLE_KEY=%s\n' "$SECRET" "$SVC" > /tmp/pw_env
serve /tmp/pw_env 401 || exit 1

chk "bad signature → 401" "$(post "$BODY" "deadbeef")" "401"
chk "missing signature → 401" "$(curl -s -o /dev/null -w '%{http_code}' "$FN" -H "apikey: $ANON" -H 'Content-Type: application/json' -d "$BODY")" "401"

BODY1="{\"user_id\":\"$USERID\",\"amount_won\":5000,\"payment_id\":\"pay_1\"}"
chk "valid signature → 200 (grant)" "$(post "$BODY1" "$(sign "$BODY1")")" "200"
sleep 1
chk "wallet credited ₩5000 = 5e9 micro-WON" "$(wallet)" "5000000000"

# idempotent: same payment_id redelivered → granted once
chk "redelivery same id → 200" "$(post "$BODY1" "$(sign "$BODY1")")" "200"
sleep 1
chk "idempotent — wallet still 5e9" "$(wallet)" "5000000000"

# a NEW payment stacks
BODY2="{\"user_id\":\"$USERID\",\"amount_won\":3000,\"payment_id\":\"pay_2\"}"
chk "second payment → 200" "$(post "$BODY2" "$(sign "$BODY2")")" "200"
sleep 1
chk "wallet now 8e9 (5000+3000)" "$(wallet)" "8000000000"

# bad payloads → 400
BAD="{\"user_id\":\"not-a-uuid\",\"amount_won\":5000,\"payment_id\":\"p\"}"
chk "bad user_id → 400" "$(post "$BAD" "$(sign "$BAD")")" "400"
OVER="{\"user_id\":\"$USERID\",\"amount_won\":9999999,\"payment_id\":\"p3\"}"
chk "over-cap amount → 400" "$(post "$OVER" "$(sign "$OVER")")" "400"

echo ""; echo "════════ RESULT: PASS=$PASS FAIL=$FAIL ════════"
pkill -f "functions serve payment-webhook" 2>/dev/null
[ "$FAIL" = "0" ] && { echo "ALL_PAYMENT_WEBHOOK_TESTS_PASSED"; exit 0; } || { echo "PAYMENT_WEBHOOK_FAILURES"; exit 1; }

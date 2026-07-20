#!/usr/bin/env bash
# ============================================================================
# card_limit_webhook_e2e.sh — HTTP E2E of the PAYMENT WEBHOOKS → subscription grant
# → card-cap raise, against a live Supabase stack (edge fns via `supabase functions
# serve`). Validates the safety-critical properties + the real happy path:
#   * FAIL-CLOSED : no webhook secret set → 503 (NEVER grants unconfigured)
#   * SIG GATE    : wrong X-Signature → rejected (not 200, no grant)
#   * HAPPY PATH  : create_payment_intent → correctly-signed subscription_created →
#                   activate_subscription_from_intent → billing_subscriptions (cap 5000)
#   * RevenueCat  : fail-closed (no secret → 503)
# Requires `supabase start`+`db reset`. NOT CI-wired.
# ============================================================================
set -uo pipefail
command -v node >/dev/null 2>&1 || export PATH="/opt/homebrew/opt/node/bin:$PATH"
cd "$(cd "$(dirname "$0")/../.." && pwd)"
PASS=0; FAIL=0
chk(){ if [ "$2" = "$3" ]; then echo "  ✅ $1 ($2)"; PASS=$((PASS+1)); else echo "  ❌ $1 — want '$3' got '$2'"; FAIL=$((FAIL+1)); fi; }
J(){ node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s)$1)}catch(e){console.log('')}})"; }
ST=$(supabase status -o json); API=$(echo "$ST"|J .API_URL); ANON=$(echo "$ST"|J .ANON_KEY); SVC=$(echo "$ST"|J .SERVICE_ROLE_KEY)
DBURL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
[ -z "$API" ] && { echo "FATAL: stack down"; exit 1; }
TS=$(date +%s)

serve_fn(){ # $1=fn $2=envfile — start + wait until it answers
  pkill -f "functions serve" 2>/dev/null; sleep 2
  nohup supabase functions serve "$1" --env-file "$2" > /tmp/wh_serve.log 2>&1 &
  # wait until it answers, then require 3 consecutive stable answers + settle (cold-start
  # can transiently 503 before the function's env is loaded).
  local ok=0
  for i in $(seq 1 90); do c=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/functions/v1/$1" -H "apikey: $ANON" -H 'Content-Type: application/json' -d '{}' 2>/dev/null); if [ "$c" != "000" ]; then ok=$((ok+1)); [ $ok -ge 3 ] && { sleep 2; return 0; }; else ok=0; fi; sleep 1; done
  echo "  ⚠ $1 did not come up"; return 1
}
post(){ curl -s -o /dev/null -w '%{http_code}' -X POST "$API/functions/v1/$1" -H "apikey: $ANON" -H 'Content-Type: application/json' ${3:+-H "X-Signature: $3"} -d "$2"; }
sign(){ node -e "const c=require('crypto');console.log(c.createHmac('sha256',process.argv[1]).update(process.argv[2]).digest('hex'))" "$1" "$2"; }

SECRET="whsecret_$TS"
BASE_ENV="/tmp/wh_base_env"; printf 'SUPABASE_URL=%s\nSUPABASE_ANON_KEY=%s\nSUPABASE_SERVICE_ROLE_KEY=%s\n' "$API" "$ANON" "$SVC" > "$BASE_ENV"

echo "── LemonSqueezy: FAIL-CLOSED (no LEMONSQUEEZY_WEBHOOK_SECRET → 503) ──"
serve_fn lemonsqueezy-webhook "$BASE_ENV"
chk "no secret → 503" "$(post lemonsqueezy-webhook '{"meta":{"event_name":"subscription_created"}}')" "503"

echo "── LemonSqueezy: SIG GATE + HAPPY PATH (secret + variant map set) ──"
LS_ENV="/tmp/wh_ls_env"; cp "$BASE_ENV" "$LS_ENV"
printf 'LEMONSQUEEZY_WEBHOOK_SECRET=%s\nLEMONSQUEEZY_VARIANT_MAP={"999001":"sub_5k_monthly"}\n' "$SECRET" >> "$LS_ENV"
serve_fn lemonsqueezy-webhook "$LS_ENV"
# wrong signature → rejected (not 200)
BADBODY='{"meta":{"event_name":"subscription_created","custom_data":{"merchant_uid":"x"}},"data":{"id":"1","attributes":{"variant_id":999001,"status":"active"}}}'
chk "wrong X-Signature → 401" "$(post lemonsqueezy-webhook "$BADBODY" 'deadbeef')" "401"

# HAPPY: user + intent for sub_5k_monthly
EMAIL="clwh_$TS@example.com"
U=$(curl -s "$API/auth/v1/admin/users" -H "apikey: $SVC" -H "Authorization: Bearer $SVC" -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"Passw0rd!e2e\",\"email_confirm\":true}" | J .id)
JWT=$(curl -s "$API/auth/v1/token?grant_type=password" -H "apikey: $ANON" -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"Passw0rd!e2e\"}" | J .access_token)
MU=$(curl -s "$API/rest/v1/rpc/create_payment_intent" -H "apikey: $ANON" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d '{"p_product_id":"sub_5k_monthly"}' | J .merchant_uid)
echo "  intent merchant_uid=${MU:0:12}..."
BODY="{\"meta\":{\"event_name\":\"subscription_created\",\"custom_data\":{\"merchant_uid\":\"$MU\"}},\"data\":{\"id\":\"ls_sub_$TS\",\"type\":\"subscriptions\",\"attributes\":{\"variant_id\":999001,\"status\":\"active\",\"renews_at\":\"$(node -e 'console.log(new Date(Date.now()+30*864e5).toISOString())')\"}}}"
SIG=$(sign "$SECRET" "$BODY")
chk "signed subscription_created → 200" "$(post lemonsqueezy-webhook "$BODY" "$SIG")" "200"
# verify the grant + cap raise landed
SUBLIM=$(psql "$DBURL" -tAq -c "SELECT card_limit FROM billing_subscriptions WHERE user_id='$U' AND status='active'" | tr -d ' ')
chk "billing_subscriptions active card_limit=5000" "$SUBLIM" "5000"
MYSUB=$(curl -s "$API/rest/v1/rpc/get_card_usage_detail" -H "apikey: $ANON" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d '{}')
chk "get_card_usage_detail card_limit=5000 (cap raised)" "$(echo "$MYSUB"|J .card_limit)" "5000"

echo "── RevenueCat: FAIL-CLOSED (no secret → 503) ──"
serve_fn revenuecat-webhook "$BASE_ENV"
chk "revenuecat no secret → 503" "$(post revenuecat-webhook '{"event":{"type":"INITIAL_PURCHASE"}}')" "503"

pkill -f "functions serve" 2>/dev/null
# cleanup
psql "$DBURL" -q -c "SET session_replication_role=replica; DELETE FROM billing_subscriptions WHERE user_id='$U'; DELETE FROM payment_intents WHERE user_id='$U';" 2>/dev/null
[ -n "${U:-}" ] && curl -s -X DELETE "$API/auth/v1/admin/users/$U" -H "apikey: $SVC" -H "Authorization: Bearer $SVC" >/dev/null
echo ""; echo "════ RESULT: PASS=$PASS FAIL=$FAIL ════"
[ "$FAIL" = "0" ] && { echo "ALL_WEBHOOK_E2E_PASSED"; exit 0; } || { echo "WEBHOOK_E2E_FAILURES"; exit 1; }

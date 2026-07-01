#!/usr/bin/env bash
# ============================================================================
# ai-generate edge function — LOCAL end-to-end integration test.
#
# Validates the integration seams the unit/DB tests can't reach (the edge
# function ↔ metering RPCs ↔ auth ↔ refund), end-to-end through the local
# Supabase stack with a REAL provider for the happy path:
#   • JWT → getUser → userId (401 vs authorized)
#   • metering RPC invoked AS THE USER (free_cards_used attributed correctly)
#   • free-tier → over-free 402 → paid debit (service-role grant)
#   • refund via the SERVICE-ROLE client after a provider failure (the seam
#     that hid the rpc().catch() bug — refund-on-failure was dead before)
#   • error code → HTTP status mapping
#
# NOT part of CI: it needs a live provider key + the Docker Supabase stack, so
# it can't run on a hosted runner. The money LOGIC has CI coverage in
# ai_credit_metering_test.sql; this script is the manual edge-fn smoke test.
#
# Prereqs:
#   • `supabase start` + `supabase db reset --no-seed` (migrations applied)
#   • a provider key in .env.test (E2E_GROK_API_KEY) or .env.local (XAI_API_KEY)
#   • node, curl, psql on PATH
#
# Run from anywhere:  bash supabase/tests/ai_generate_edge_e2e.sh
# ============================================================================
set -uo pipefail
# Homebrew node path fallback (some local shells don't have it on PATH).
command -v node >/dev/null 2>&1 || export PATH="/opt/homebrew/opt/node/bin:$PATH"
cd "$(cd "$(dirname "$0")/../.." && pwd)"  # repo root

PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad()  { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
chk()  { if [ "$2" = "$3" ]; then ok "$1 ($2)"; else bad "$1 — expected '$3' got '$2'"; fi; }

# ── keys (from the running local stack) ──
ST=$(supabase status -o json)
API=$(echo "$ST" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).API_URL))")
ANON=$(echo "$ST" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).ANON_KEY))")
SVC=$(echo "$ST" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).SERVICE_ROLE_KEY))")
DBURL=$(echo "$ST" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).DB_URL)}catch(e){console.log('')}})")
[ -z "$DBURL" ] && DBURL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
[ -z "$API" ] && { echo "FATAL: local stack not running (supabase start)"; exit 1; }
echo "API=$API"
psql() { command psql "$DBURL" -tAc "$1"; }

# ── provider + key + a model the key can actually serve ──
# Dual-provider: default xai/grok; set E2E_AI_PROVIDER=gemini to run the same
# suite against Gemini (proves usage/cost capture is provider-agnostic). Keys are
# read from the gitignored .env.test / .env.local (never committed).
PROVIDER="${E2E_AI_PROVIDER:-xai}"
readkey() { grep -hoE "$1=.*" .env.test .env.local 2>/dev/null | head -1 | cut -d= -f2- | tr -d "\"' "; }
if [ "$PROVIDER" = "gemini" ]; then
  AIKEY="${E2E_GEMINI_API_KEY:-$(readkey GEMINI_API_KEY)}"
  MODEL="${E2E_AI_MODEL:-gemini-2.5-flash-lite}"
else
  AIKEY="${E2E_GROK_API_KEY:-$(readkey E2E_GROK_API_KEY)}"; [ -z "$AIKEY" ] && AIKEY="$(readkey XAI_API_KEY)"
  MODEL="${E2E_AI_MODEL:-grok-4.20-0309-non-reasoning}"
fi
[ -z "$AIKEY" ] && { echo "FATAL: no provider key for '$PROVIDER' (.env.test/.env.local)"; exit 1; }
echo "provider=$PROVIDER model=$MODEL"

# ── create a confirmed user + sign in for an access token ──
EMAIL="e2e_$(psql "select floor(extract(epoch from now()))::bigint")@example.com"
PW="Passw0rd!e2e"
ADMIN=$(curl -s "$API/auth/v1/admin/users" -H "apikey: $SVC" -H "Authorization: Bearer $SVC" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\",\"email_confirm\":true}")
USERID=$(echo "$ADMIN" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.id||j.user?.id||'')})")
TOK=$(curl -s "$API/auth/v1/token?grant_type=password" -H "apikey: $ANON" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).access_token||''))")
echo "user=$USERID  token=${TOK:0:12}..."
[ -z "$USERID" ] && { echo "FATAL: no user id ($ADMIN)"; exit 1; }
[ -z "$TOK" ] && { echo "FATAL: no access token"; exit 1; }

FN="$API/functions/v1/ai-generate"
FIELDS='[{"key":"front","name":"Word","order":0},{"key":"back","name":"Meaning","order":1}]'

call() { curl -s -o /tmp/e2e_body.json -w "%{http_code}" "$FN" \
  -H "apikey: $ANON" -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d "$1"; }
code_of() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).code||'')}catch(e){console.log('')}})" < /tmp/e2e_body.json; }

start_serve() { # $1 = env file
  # NOTE: serve locally with --env-file. SUPABASE_SERVICE_ROLE_KEY must be in the
  # file — `functions serve` injects URL/ANON but NOT the service key, which the
  # refund path needs (in deployed prod it IS auto-injected). Fully tear down the
  # previous serve before rebinding — a short gap races shutdown and the next
  # serve can pick up a stale compile (then the refund silently no-ops).
  pkill -f "functions serve ai-generate" 2>/dev/null; sleep 4
  nohup supabase functions serve ai-generate --env-file "$1" > /tmp/e2e_serve.log 2>&1 &
  # Wait until the Deno function is actually COMPILED + serving — a token'd
  # bad-kind request returns 400 (validation runs before any provider call). A
  # bare/no-JWT probe only proves the Kong gateway is up, not the function.
  local c=000
  for i in $(seq 1 60); do
    c=$(curl -s -o /dev/null -w "%{http_code}" "$FN" -X POST \
      -H "apikey: $ANON" -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
      -d '{"kind":"bogus","topic":"x"}' 2>/dev/null)
    [ "$c" = "400" ] && { echo "  serve ready (function warm) after ${i}s"; sleep 2; return 0; }
    sleep 1
  done
  echo "  serve NEVER became ready (last http $c)"; tail -8 /tmp/e2e_serve.log; return 1
}

# ════════════════ PHASE A — real provider ════════════════
echo "── PHASE A: real provider ($PROVIDER / $MODEL) ──"
cat > /tmp/e2e_envA <<EOF
AI_GENERATION_PROVIDER=$PROVIDER
AI_GENERATION_PROVIDER_KEY=$AIKEY
AI_GENERATION_MODEL=$MODEL
AI_VISION_MODEL=$MODEL
SUPABASE_SERVICE_ROLE_KEY=$SVC
EOF
start_serve /tmp/e2e_envA || exit 1

# A1: no auth → 401
c=$(curl -s -o /dev/null -w "%{http_code}" "$FN" -X POST -H "apikey: $ANON" -H 'Content-Type: application/json' -d '{"kind":"cards"}')
chk "A1 no-auth rejected" "$c" "401"

# A2: bad kind → 400 BAD_REQUEST
s=$(call '{"kind":"bogus","topic":"x"}'); chk "A2 bad-kind status" "$s" "400"; chk "A2 bad-kind code" "$(code_of)" "BAD_REQUEST"

# A3: happy path cards (free tier) → 200 + content + remainingFree.
# Retry once on a 502 — that's a TRANSIENT live-provider hiccup (the fn already
# retries internally), not a code defect; reset usage between tries.
s=$(call "{\"kind\":\"cards\",\"topic\":\"Spanish kitchen vocabulary\",\"contentLang\":\"es-ES\",\"fields\":$FIELDS,\"cardCount\":3}")
if [ "$s" = "502" ]; then
  echo "    (A3 got transient provider 502 — retrying once)"
  psql "delete from ai_generation_usage where user_id='$USERID'; delete from ai_generation_jobs where user_id='$USERID';" >/dev/null
  sleep 3
  s=$(call "{\"kind\":\"cards\",\"topic\":\"Common English kitchen words\",\"contentLang\":\"en-US\",\"fields\":$FIELDS,\"cardCount\":3}")
fi
chk "A3 happy status" "$s" "200"
NCARDS=$(node -e "
const j=require('/tmp/e2e_body.json'); const c=j.content;
let arr=null;
if(Array.isArray(c)) arr=c;
else if(c && typeof c==='object'){ for(const k of Object.keys(c)){ if(Array.isArray(c[k])){arr=c[k];break;} } }
console.log(arr?arr.length:0);
" 2>/dev/null)
RF=$(node -e "const j=require('/tmp/e2e_body.json');console.log(j.remainingFree)" 2>/dev/null)
echo "    -> content keys: $(node -e "const j=require('/tmp/e2e_body.json');console.log(j.content&&typeof j.content==='object'?Object.keys(j.content).join(','):typeof j.content)" 2>/dev/null)  cards=$NCARDS remainingFree=$RF"
[ "${NCARDS:-0}" -ge 1 ] 2>/dev/null && ok "A3 returned cards ($NCARDS)" || bad "A3 no cards in content"
# metered AS THE USER → free_cards_used attributed to this user
USED=$(psql "select free_cards_used from ai_generation_usage where user_id='$USERID'")
chk "A3 metered as user (free_cards_used)" "${USED:-X}" "3"
# COST CAPTURE + CHARGE (mig 114): the provider token usage is threaded into
# charge_ai_generation → a cost-ledger row lands with real tokens + computed cost.
# (These 3 free cards charge 0 — free tier — but still record cost.)
sleep 1  # chargeGeneration is awaited before the 200, but give PostgREST a beat
COST=$(psql "select provider||'|'||(tokens_in>0)::text||'|'||(cost_won_micros is not null)::text||'|'||estimated::text from ai_cost_ledger where user_id='$USERID' order by created_at desc limit 1")
echo "    -> cost row: ${COST:-<none>}"
chk "A3 cost captured (provider|tokens_in>0|cost_set|estimated)" "${COST:-X}" "$PROVIDER|true|true|false"

# A4: exhaust free, EMPTY wallet, request a paid card → 402 (pre-gen gate)
psql "update ai_generation_usage set free_cards_used=10 where user_id='$USERID'" >/dev/null
s=$(call "{\"kind\":\"cards\",\"topic\":\"x\",\"fields\":$FIELDS,\"cardCount\":1}")
chk "A4 over-free empty-wallet status" "$s" "402"; chk "A4 code" "$(code_of)" "AI_INSUFFICIENT_CREDITS"

# A5: top up the micro-WON wallet (service-role, ₩100 = 100,000,000 micro-WON) →
# a PAID gen succeeds and the wallet is DEBITED by the real token cost × markup.
curl -s "$API/rest/v1/rpc/add_ai_credits" -H "apikey: $SVC" -H "Authorization: Bearer $SVC" -H 'Content-Type: application/json' \
  -d "{\"p_user_id\":\"$USERID\",\"p_micro_won\":100000000,\"p_reason\":\"purchase\",\"p_ref\":\"e2e_pay_$USERID\"}" >/dev/null
BAL0=$(psql "select balance from ai_credit_balance where user_id='$USERID'")
s=$(call "{\"kind\":\"cards\",\"topic\":\"Spanish numbers\",\"contentLang\":\"es-ES\",\"fields\":$FIELDS,\"cardCount\":2}")
if [ "$s" = "502" ]; then   # transient live-provider hiccup — release ran, wallet intact; retry once
  echo "    (A5 got transient provider 502 — retrying once)"; sleep 3
  s=$(call "{\"kind\":\"cards\",\"topic\":\"Common English numbers\",\"contentLang\":\"en-US\",\"fields\":$FIELDS,\"cardCount\":2}")
fi
chk "A5 paid success status" "$s" "200"
sleep 1
BAL1=$(psql "select balance from ai_credit_balance where user_id='$USERID'")
SPENT=$(psql "select count(*) from ai_credit_ledger where user_id='$USERID' and reason='spend' and delta<0")
PRICE=$(psql "select coalesce(price_micro_won,0) from ai_generation_jobs where user_id='$USERID' and charged and price_micro_won>0 order by created_at desc limit 1")
echo "    -> wallet ${BAL0} → ${BAL1}, charged price ${PRICE} micro-WON, spend rows ${SPENT}"
[ "${BAL1:-0}" -lt "${BAL0:-0}" ] 2>/dev/null && ok "A5 wallet debited by real cost×markup (${BAL0}→${BAL1})" || bad "A5 wallet not debited"
chk "A5 spend ledger row written" "${SPENT:-0}" "1"
[ "${PRICE:-0}" -gt 0 ] 2>/dev/null && ok "A5 charged price > 0 (${PRICE} micro-WON)" || bad "A5 no charge price"

# ════════════════ PHASE B — bogus provider (refund seam) ════════════════
echo "── PHASE B: bogus provider → refund-on-failure ──"
psql "delete from ai_generation_usage where user_id='$USERID'; delete from ai_generation_jobs where user_id='$USERID';" >/dev/null
cat > /tmp/e2e_envB <<EOF
AI_GENERATION_PROVIDER=$PROVIDER
AI_GENERATION_PROVIDER_KEY=bogus-key
AI_GENERATION_BASE_URL=http://127.0.0.1:9
AI_GENERATION_MODEL=$MODEL
SUPABASE_SERVICE_ROLE_KEY=$SVC
EOF
start_serve /tmp/e2e_envB || exit 1

# B1: provider unreachable → reserve(3 free) then fail → 502 + refund job → net-zero
s=$(call "{\"kind\":\"cards\",\"topic\":\"anything\",\"fields\":$FIELDS,\"cardCount\":3}")
chk "B1 provider-failure status" "$s" "502"
USEDB=$(psql "select coalesce(free_cards_used,0) from ai_generation_usage where user_id='$USERID'")
chk "B1 usage refunded to 0 (service-role refund)" "${USEDB:-0}" "0"
REFUNDED=$(psql "select bool_and(refunded) from ai_generation_jobs where user_id='$USERID'")
chk "B1 job marked refunded" "${REFUNDED:-f}" "t"
# NET-ZERO on failure (mig 112/113): a failed generation records NO cost — finalizeCost
# runs only on success, so the failed job has no ai_cost_ledger row (prior rows were
# cascade-cleared with the phase-B job reset). Refunded credit + zero cost = net zero.
NZCOST=$(psql "select count(*) from ai_cost_ledger where user_id='$USERID'")
chk "B1 net-zero on failure (no cost row for the failed gen)" "${NZCOST:-X}" "0"

echo ""
echo "════════════ RESULT: PASS=$PASS FAIL=$FAIL ════════════"
pkill -f "functions serve ai-generate" 2>/dev/null
[ "$FAIL" = "0" ] && { echo "ALL_E2E_PASSED"; exit 0; } || { echo "E2E_FAILURES"; exit 1; }

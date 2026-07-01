#!/usr/bin/env bash
# ============================================================================
# card_limit_e2e.sh — actual HTTP end-to-end of the owned-card limit against the
# local Supabase stack. Exercises the SAME server enforcement that web / iOS /
# Android all rely on:
#   * PostgREST /rpc/reserve_card_positions  → HTTP 402 + CARD_LIMIT_REACHED at cap
#   * PostgREST /rpc/get_owned_card_usage    → {owned, card_limit, available}
#   * ai-generate edge fn pre-check          → 402 CARD_LIMIT_REACHED at cap (before Gemini)
#   * under the cap → reserve succeeds (200)
# Requires `supabase start` + `supabase db reset` (mig 116). NOT CI-wired (needs the stack):
#   bash supabase/tests/card_limit_e2e.sh
# ============================================================================
set -uo pipefail
command -v node >/dev/null 2>&1 || export PATH="/opt/homebrew/opt/node/bin:$PATH"
cd "$(cd "$(dirname "$0")/../.." && pwd)"
PASS=0; FAIL=0
chk(){ if [ "$2" = "$3" ]; then echo "  ✅ $1 ($2)"; PASS=$((PASS+1)); else echo "  ❌ $1 — want '$3' got '$2'"; FAIL=$((FAIL+1)); fi; }
J(){ node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s)$1)}catch(e){console.log('')}})"; }

ST=$(supabase status -o json)
API=$(echo "$ST" | J .API_URL); ANON=$(echo "$ST" | J .ANON_KEY); SVC=$(echo "$ST" | J .SERVICE_ROLE_KEY)
DBURL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
[ -z "$API" ] && { echo "FATAL: stack down"; exit 1; }

EMAIL="cl_$(date +%s)@example.com"; PW="Passw0rd!e2e"
USERID=$(curl -s "$API/auth/v1/admin/users" -H "apikey: $SVC" -H "Authorization: Bearer $SVC" -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\",\"email_confirm\":true}" | J .id)
JWT=$(curl -s "$API/auth/v1/token?grant_type=password" -H "apikey: $ANON" -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}" | J .access_token)
[ -z "$USERID" ] && { echo "FATAL: no user"; exit 1; }
echo "user=${USERID:0:8}..."

DECK='c1ea0000-0000-0000-0000-0000000000d1'; TMPL='c1ea0000-0000-0000-0000-0000000000e1'
# fixtures + cap=3 + 3 owned cards (at cap), as service_role bypassing triggers
psql "$DBURL" -q <<SQL
SET session_replication_role = replica;
INSERT INTO card_templates (id,user_id,name) VALUES ('$TMPL','$USERID','T') ON CONFLICT (id) DO NOTHING;
INSERT INTO decks (id,user_id,name,next_position) VALUES ('$DECK','$USERID','D',3) ON CONFLICT (id) DO NOTHING;
UPDATE card_limit_settings SET max_owned_cards=3, count_official_cards=false WHERE id=1;
INSERT INTO cards (deck_id,user_id,template_id,sort_position)
  SELECT '$DECK','$USERID','$TMPL',g FROM generate_series(0,2) g;
SQL

rpc(){ curl -s -o /dev/null -w '%{http_code}' "$API/rest/v1/rpc/$1" -H "apikey: $ANON" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d "$2"; }
rpcbody(){ curl -s "$API/rest/v1/rpc/$1" -H "apikey: $ANON" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d "$2"; }

echo "── at cap (3/3) ──"
chk "reserve_card_positions → HTTP 402" "$(rpc reserve_card_positions "{\"p_deck_id\":\"$DECK\",\"p_count\":1}")" "402"
BODY=$(rpcbody reserve_card_positions "{\"p_deck_id\":\"$DECK\",\"p_count\":1}")
chk "error hint CARD_LIMIT_REACHED" "$(echo "$BODY" | grep -c CARD_LIMIT_REACHED)" "1"
USAGE=$(rpcbody get_owned_card_usage '{}')
chk "usage owned=3" "$(echo "$USAGE" | J '[0].owned')" "3"
chk "usage available=0" "$(echo "$USAGE" | J '[0].available')" "0"

echo "── AI-generate edge pre-check at cap ──"
pkill -f "functions serve" 2>/dev/null; sleep 3
printf 'AI_GENERATION_PROVIDER_KEY=dummy-not-used-precheck-fails-first\nSUPABASE_SERVICE_ROLE_KEY=%s\n' "$SVC" > /tmp/clai_env
nohup supabase functions serve ai-generate --env-file /tmp/clai_env > /tmp/clai_serve.log 2>&1 &
for i in $(seq 1 60); do c=$(curl -s -o /dev/null -w '%{http_code}' "$API/functions/v1/ai-generate" -X POST -H "apikey: $ANON" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d '{"kind":"cards","topic":"x","cardCount":2,"uiLang":"en","fields":[{"key":"front","name":"Front"},{"key":"back","name":"Back"}]}' 2>/dev/null); [ "$c" != "000" ] && break; sleep 1; done
AIRESP=$(curl -s "$API/functions/v1/ai-generate" -H "apikey: $ANON" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d '{"kind":"cards","topic":"x","cardCount":2,"uiLang":"en","fields":[{"key":"front","name":"Front"},{"key":"back","name":"Back"}]}')
chk "ai-generate at cap → CARD_LIMIT_REACHED" "$(echo "$AIRESP" | grep -c CARD_LIMIT_REACHED)" "1"
pkill -f "functions serve" 2>/dev/null

echo "── under cap (delete 1 → 2/3) ──"
psql "$DBURL" -q -c "SET session_replication_role=replica; DELETE FROM cards WHERE deck_id='$DECK' AND sort_position=2;"
chk "reserve_card_positions → HTTP 200" "$(rpc reserve_card_positions "{\"p_deck_id\":\"$DECK\",\"p_count\":1}")" "200"

# cleanup
psql "$DBURL" -q -c "SET session_replication_role=replica; DELETE FROM cards WHERE deck_id='$DECK'; DELETE FROM decks WHERE id='$DECK'; DELETE FROM card_templates WHERE id='$TMPL'; UPDATE card_limit_settings SET max_owned_cards=1000 WHERE id=1;" 2>/dev/null
curl -s -X DELETE "$API/auth/v1/admin/users/$USERID" -H "apikey: $SVC" -H "Authorization: Bearer $SVC" >/dev/null

echo ""; echo "════ RESULT: PASS=$PASS FAIL=$FAIL ════"
[ "$FAIL" = "0" ] && { echo "ALL_CARD_LIMIT_E2E_PASSED"; exit 0; } || { echo "CARD_LIMIT_E2E_FAILURES"; exit 1; }

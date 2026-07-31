#!/usr/bin/env bash
# ============================================================================
# card_limit_subscription_e2e.sh — HTTP E2E of the SUBSCRIPTION ↔ CARD-CAP
# integration against a live Supabase stack:
#   grant_subscription (5k / unlimited) → _owned_card_limit raises → get_card_usage_detail
#   reflects it → over-cap ARCHIVE restores (get_active_card_threshold NULL) → downgrade
#   (expire) → cap falls back → archive re-applies. Also get_my_subscription.
# Requires `supabase start` + `db reset`. NOT CI-wired.
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
TS=$(date +%s); EMAIL="clsub_$TS@example.com"
U=$(curl -s "$API/auth/v1/admin/users" -H "apikey: $SVC" -H "Authorization: Bearer $SVC" -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"Passw0rd!e2e\",\"email_confirm\":true}" | J .id)
JWT=$(curl -s "$API/auth/v1/token?grant_type=password" -H "apikey: $ANON" -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"Passw0rd!e2e\"}" | J .access_token)
[ -z "$U" ] && { echo "FATAL: no user"; exit 1; }; echo "user=${U:0:8}"

D='c1b00000-0000-0000-0000-0000000000d1'; T='c1b00000-0000-0000-0000-0000000000e1'
# 1000 old cards + 500 newer → over the default cap 1000 by 500 (deterministic archive)
psql "$DBURL" -q <<SQL
SET session_replication_role = replica;
INSERT INTO card_templates (id,user_id,name) VALUES ('$T','$U','T') ON CONFLICT DO NOTHING;
INSERT INTO decks (id,user_id,name,next_position) VALUES ('$D','$U','D',1500) ON CONFLICT DO NOTHING;
UPDATE card_limit_settings SET max_owned_cards=1000, count_official_cards=false WHERE id=1;
INSERT INTO cards (deck_id,user_id,template_id,sort_position,created_at) SELECT '$D','$U','$T',g, now()-interval '2 day' FROM generate_series(1,1000) g;
INSERT INTO cards (deck_id,user_id,template_id,sort_position,created_at) SELECT '$D','$U','$T',1000+g, now() FROM generate_series(1,500) g;
SQL
det(){ curl -s "$API/rest/v1/rpc/get_card_usage_detail" -H "apikey: $ANON" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d '{}'; }
thr(){ curl -s "$API/rest/v1/rpc/get_active_card_threshold" -H "apikey: $ANON" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d '{}'; }
grant(){ curl -s -o /dev/null -w '%{http_code}' "$API/rest/v1/rpc/grant_subscription" -H "apikey: $SVC" -H "Authorization: Bearer $SVC" -H 'Content-Type: application/json' -d "$1"; }

echo "── FREE (cap 1000, owns 1500) → over cap, 500 archived ──"
D0=$(det)
chk "card_limit=1000"      "$(echo "$D0"|J .card_limit)" "1000"
chk "used_total=1500"      "$(echo "$D0"|J .used_total)" "1500"
chk "available=0"          "$(echo "$D0"|J .available)" "0"
chk "archived_total=500"   "$(echo "$D0"|J .archived_total)" "500"
chk "threshold NOT null (over cap)" "$([ "$(thr)" != "null" ] && echo yes || echo no)" "yes"

echo "── GRANT sub_5k_monthly (service_role) → cap 5000, archive restored ──"
chk "grant_subscription 5k → 204" "$(grant "{\"p_user\":\"$U\",\"p_product_id\":\"sub_5k_monthly\",\"p_provider\":\"test\",\"p_provider_ref\":\"e2e-5k-$TS\",\"p_period_end\":\"$(node -e 'console.log(new Date(Date.now()+30*864e5).toISOString())')\"}")" "204"
D1=$(det)
chk "card_limit=5000"      "$(echo "$D1"|J .card_limit)" "5000"
chk "available=3500"       "$(echo "$D1"|J .available)" "3500"
chk "archived_total=0 (RESTORED)" "$(echo "$D1"|J .archived_total)" "0"
chk "threshold null (under 5000)" "$(thr)" "null"
MYSUB=$(curl -s "$API/rest/v1/rpc/get_my_subscription" -H "apikey: $ANON" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d '{}')
chk "get_my_subscription card_limit=5000" "$(echo "$MYSUB"|J .card_limit)" "5000"

echo "── UPGRADE sub_unlimited_monthly → unlimited ──"
chk "grant unlimited → 204" "$(grant "{\"p_user\":\"$U\",\"p_product_id\":\"sub_unlimited_monthly\",\"p_provider\":\"test\",\"p_provider_ref\":\"e2e-unl-$TS\",\"p_period_end\":\"$(node -e 'console.log(new Date(Date.now()+30*864e5).toISOString())')\"}")" "204"
D2=$(det)
chk "is_unlimited=true"    "$(echo "$D2"|J .is_unlimited)" "true"
chk "archived_total=0"     "$(echo "$D2"|J .archived_total)" "0"

echo "── DOWNGRADE (expire the sub) → cap back to 1000, re-archived ──"
psql "$DBURL" -q -c "SET session_replication_role=replica; UPDATE billing_subscriptions SET status='expired', current_period_end=now()-interval '1 day', updated_at=now() WHERE user_id='$U';" >/dev/null
D3=$(det)
chk "card_limit back to 1000" "$(echo "$D3"|J .card_limit)" "1000"
chk "archived_total=500 (re-archived)" "$(echo "$D3"|J .archived_total)" "500"

# cleanup
psql "$DBURL" -q -c "SET session_replication_role=replica; DELETE FROM billing_subscriptions WHERE user_id='$U'; DELETE FROM cards WHERE deck_id='$D'; DELETE FROM decks WHERE id='$D'; DELETE FROM card_templates WHERE id='$T'; UPDATE card_limit_settings SET max_owned_cards=1000 WHERE id=1;" 2>/dev/null
curl -s -X DELETE "$API/auth/v1/admin/users/$U" -H "apikey: $SVC" -H "Authorization: Bearer $SVC" >/dev/null
echo ""; echo "════ RESULT: PASS=$PASS FAIL=$FAIL ════"
[ "$FAIL" = "0" ] && { echo "ALL_SUBSCRIPTION_E2E_PASSED"; exit 0; } || { echo "SUBSCRIPTION_E2E_FAILURES"; exit 1; }

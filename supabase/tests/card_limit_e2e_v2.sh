#!/usr/bin/env bash
# ============================================================================
# card_limit_e2e_v2.sh — HTTP end-to-end of the NEW card-limit enforcement
# (migrations 136-141) against the local Supabase stack, hitting the SAME
# PostgREST / RLS / RPC surface that web + iOS + Android use:
#   * mig 136 insert trigger  → direct POST /rest/v1/cards over cap → 402
#   * mig 141 L5 WITH CHECK    → POST card into ANOTHER user's deck → 403
#   * mig 141 L2 reactivation  → PATCH deck_shares status=active over cap → 402 (stays revoked)
#   * mig 137 usage detail      → get_card_usage_detail breakdown
#   * mig 140 study-lock        → is_subscribed_deck_active false for over-cap sub deck
#   * mig 138 accept_invite     → over-cap subscribe accept → 402
# Requires `supabase start` + `supabase db reset`. NOT CI-wired (needs the stack):
#   bash supabase/tests/card_limit_e2e_v2.sh
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
[ -z "$API" ] && { echo "FATAL: stack down (run: supabase start)"; exit 1; }

mkuser(){ # $1=email → prints "USERID JWT"
  local em="$1" uid jwt
  uid=$(curl -s "$API/auth/v1/admin/users" -H "apikey: $SVC" -H "Authorization: Bearer $SVC" -H 'Content-Type: application/json' -d "{\"email\":\"$em\",\"password\":\"Passw0rd!e2e\",\"email_confirm\":true}" | J .id)
  jwt=$(curl -s "$API/auth/v1/token?grant_type=password" -H "apikey: $ANON" -H 'Content-Type: application/json' -d "{\"email\":\"$em\",\"password\":\"Passw0rd!e2e\"}" | J .access_token)
  echo "$uid $jwt"
}
TS=$(date +%s)
read -r U1 J1 <<< "$(mkuser "clv2a_$TS@example.com")"
read -r U2 J2 <<< "$(mkuser "clv2b_$TS@example.com")"
read -r UP JP <<< "$(mkuser "clv2p_$TS@example.com")"   # publisher
[ -z "$U1" ] || [ -z "$U2" ] || [ -z "$UP" ] && { echo "FATAL: user create failed"; exit 1; }
echo "u1=${U1:0:8} u2=${U2:0:8} pub=${UP:0:8}"

D1='c1e20000-0000-0000-0000-0000000000d1'  # u1 owned deck
D2='c1e20000-0000-0000-0000-0000000000d2'  # u2 owned deck
DP='c1e20000-0000-0000-0000-0000000000da'  # publisher deck (subscribed)
T1='c1e20000-0000-0000-0000-0000000000e1'
# fixtures (service_role, bypass triggers): u1 at cap 3/3; u2 deck; publisher deck w/ 5 cards;
# a REVOKED subscribe share u1→publisher deck.
psql "$DBURL" -q <<SQL
SET session_replication_role = replica;
INSERT INTO card_templates (id,user_id,name) VALUES ('$T1','$U1','T') ON CONFLICT (id) DO NOTHING;
INSERT INTO decks (id,user_id,name,next_position) VALUES
  ('$D1','$U1','u1',3),('$D2','$U2','u2',0),('$DP','$UP','pub',5) ON CONFLICT (id) DO NOTHING;
UPDATE card_limit_settings SET max_owned_cards=3, count_official_cards=false WHERE id=1;
INSERT INTO cards (deck_id,user_id,template_id,sort_position) SELECT '$D1','$U1','$T1',g FROM generate_series(0,2) g;
INSERT INTO cards (deck_id,user_id,template_id,sort_position) SELECT '$DP','$UP','$T1',g FROM generate_series(0,4) g;
INSERT INTO deck_shares (deck_id,owner_id,recipient_id,share_mode,status,accepted_at)
  VALUES ('$DP','$UP','$U1','subscribe','revoked', now());
SQL

# helpers (u1's JWT unless overridden)
code(){ curl -s -o /dev/null -w '%{http_code}' "$@"; }
CARD_D1='{"deck_id":"'$D1'","user_id":"'$U1'","template_id":"'$T1'","field_values":{},"sort_position":9}'
CARD_D2='{"deck_id":"'$D2'","user_id":"'$U1'","template_id":"'$T1'","field_values":{},"sort_position":9}'

echo "── mig 136: direct POST /cards into OWN deck at cap → 402 (insert trigger) ──"
chk "POST cards (own deck, at cap)" \
  "$(code -X POST "$API/rest/v1/cards" -H "apikey: $ANON" -H "Authorization: Bearer $J1" -H 'Content-Type: application/json' -H 'Prefer: return=minimal' -d "$CARD_D1")" "402"

echo "── mig 141 L5: direct POST /cards into ANOTHER user's deck → 403 (WITH CHECK) ──"
chk "POST cards (u2's deck)" \
  "$(code -X POST "$API/rest/v1/cards" -H "apikey: $ANON" -H "Authorization: Bearer $J1" -H 'Content-Type: application/json' -H 'Prefer: return=minimal' -d "$CARD_D2")" "403"

echo "── mig 141 L2: PATCH deck_shares status=active over cap → 402 (stays revoked) ──"
SHARE_ID=$(psql "$DBURL" -tAq -c "SELECT id FROM deck_shares WHERE deck_id='$DP' AND recipient_id='$U1'")
chk "PATCH deck_shares → active (5 cards > cap 3)" \
  "$(code -X PATCH "$API/rest/v1/deck_shares?id=eq.$SHARE_ID" -H "apikey: $ANON" -H "Authorization: Bearer $J1" -H 'Content-Type: application/json' -H 'Prefer: return=minimal' -d '{"status":"active"}')" "402"
chk "share still revoked (net-zero)" "$(psql "$DBURL" -tAq -c "SELECT status FROM deck_shares WHERE id='$SHARE_ID'" | tr -d ' ')" "revoked"

echo "── mig 137: get_card_usage_detail breakdown (u1 owns 3, cap 3) ──"
DET=$(curl -s "$API/rest/v1/rpc/get_card_usage_detail" -H "apikey: $ANON" -H "Authorization: Bearer $J1" -H 'Content-Type: application/json' -d '{}')
chk "usage_detail owned_own=3" "$(echo "$DET" | J .owned_own)" "3"
chk "usage_detail available=0"  "$(echo "$DET" | J .available)" "0"
chk "usage_detail is_unlimited=false" "$(echo "$DET" | J .is_unlimited)" "false"

echo "── mig 140: is_subscribed_deck_active false for over-cap sub deck ──"
# activate the share as service_role (bypass the L2 trigger) so the study-lock RPC has an active over-cap sub
psql "$DBURL" -q -c "SET session_replication_role=replica; UPDATE deck_shares SET status='active' WHERE id='$SHARE_ID'; INSERT INTO user_card_progress (user_id,card_id,deck_id,srs_status) SELECT '$U1',c.id,c.deck_id,'new' FROM cards c WHERE c.deck_id='$DP' ON CONFLICT DO NOTHING;" >/dev/null
ACT=$(curl -s "$API/rest/v1/rpc/is_subscribed_deck_active" -H "apikey: $ANON" -H "Authorization: Bearer $J1" -H 'Content-Type: application/json' -d "{\"p_deck_id\":\"$DP\"}")
chk "is_subscribed_deck_active (over cap) = false" "$ACT" "false"
DET2=$(curl -s "$API/rest/v1/rpc/get_card_usage_detail" -H "apikey: $ANON" -H "Authorization: Bearer $J1" -H 'Content-Type: application/json' -d '{}')
chk "usage_detail archived_total = 5 (locked sub deck)" "$(echo "$DET2" | J .archived_total)" "5"

echo "── mig 138: accept_invite subscribe over cap → 402 ──"
# create a pending subscribe invite (owner=pub) with a code, u1 accepts over cap
INV="clv2-invite-$TS"
psql "$DBURL" -q -c "SET session_replication_role=replica; INSERT INTO deck_shares (deck_id,owner_id,recipient_id,share_mode,status,invite_code) VALUES ('$DP','$UP',NULL,'subscribe','pending','$INV');" >/dev/null
chk "accept_invite (5 cards, cap 3) → 402" \
  "$(code -X POST "$API/rest/v1/rpc/accept_invite" -H "apikey: $ANON" -H "Authorization: Bearer $J1" -H 'Content-Type: application/json' -d "{\"p_code\":\"$INV\"}")" "402"

echo "── mig 142: OFFICIAL subscribed deck NEVER study-locked (over cap) ──"
DO_='c1e20000-0000-0000-0000-0000000000d0'
psql "$DBURL" -q -c "SET session_replication_role=replica;
  INSERT INTO decks (id,user_id,name,next_position) VALUES ('$DO_','$UP','ofc',5) ON CONFLICT (id) DO NOTHING;
  INSERT INTO cards (deck_id,user_id,template_id,sort_position) SELECT '$DO_','$UP','$T1',g FROM generate_series(0,4) g;
  INSERT INTO official_deck_manifest (manifest_key,deck_id,source_file,source_language,target_language,category,last_status) VALUES ('e2e-ofc-$TS','$DO_','f.csv','en','ko','test','applied');
  INSERT INTO deck_shares (deck_id,owner_id,recipient_id,share_mode,status,accepted_at) VALUES ('$DO_','$UP','$U1','subscribe','active', now());
  INSERT INTO user_card_progress (user_id,card_id,deck_id,srs_status) SELECT '$U1',c.id,c.deck_id,'new' FROM cards c WHERE c.deck_id='$DO_' ON CONFLICT DO NOTHING;" >/dev/null
OACT=$(curl -s "$API/rest/v1/rpc/is_subscribed_deck_active" -H "apikey: $ANON" -H "Authorization: Bearer $J1" -H 'Content-Type: application/json' -d "{\"p_deck_id\":\"$DO_\"}")
chk "official sub deck active (over cap) = true" "$OACT" "true"

# cleanup
psql "$DBURL" -q -c "SET session_replication_role=replica; DELETE FROM official_deck_manifest WHERE deck_id='$DO_'; DELETE FROM deck_shares WHERE deck_id='$DO_'; DELETE FROM cards WHERE deck_id='$DO_'; DELETE FROM decks WHERE id='$DO_'; DELETE FROM user_card_progress WHERE user_id IN ('$U1','$U2','$UP'); DELETE FROM deck_shares WHERE deck_id='$DP'; DELETE FROM cards WHERE deck_id IN ('$D1','$D2','$DP'); DELETE FROM decks WHERE id IN ('$D1','$D2','$DP'); DELETE FROM card_templates WHERE id='$T1'; UPDATE card_limit_settings SET max_owned_cards=1000 WHERE id=1;" 2>/dev/null
for u in "$U1" "$U2" "$UP"; do curl -s -X DELETE "$API/auth/v1/admin/users/$u" -H "apikey: $SVC" -H "Authorization: Bearer $SVC" >/dev/null; done

echo ""; echo "════ RESULT: PASS=$PASS FAIL=$FAIL ════"
[ "$FAIL" = "0" ] && { echo "ALL_CARD_LIMIT_E2E_V2_PASSED"; exit 0; } || { echo "CARD_LIMIT_E2E_V2_FAILURES"; exit 1; }

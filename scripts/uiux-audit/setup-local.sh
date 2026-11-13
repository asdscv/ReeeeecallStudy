#!/usr/bin/env bash
# Local-only UI/UX audit setup: local Supabase stack, a throwaway test account, sample data, axe.
# Everything here talks to 127.0.0.1 — never to the hosted project.
#
#   bash scripts/uiux-audit/setup-local.sh        # writes scripts/uiux-audit/local.env (gitignored)
#   bash scripts/local-supabase.sh down           # when finished
set -euo pipefail
cd "$(dirname "$0")/../.."
export PATH="/opt/homebrew/opt/node/bin:/opt/homebrew/bin:$PATH"
HERE=scripts/uiux-audit

docker ps --format '{{.Names}}' | grep -q '^supabase_db_reeeeecall-study$' || bash scripts/local-supabase.sh up
ST="$(supabase status -o json 2>/dev/null)"
SR="$(echo "$ST" | jq -r .SERVICE_ROLE_KEY)"
AN="$(echo "$ST" | jq -r .ANON_KEY)"
EMAIL="uiux.audit@example.test"
PW="Audit-$(openssl rand -hex 6)"

# Create (or reset the password of) the test account.
ID="$(curl -s "http://127.0.0.1:54321/auth/v1/admin/users?per_page=200" -H "apikey: $SR" -H "Authorization: Bearer $SR" | jq -r --arg e "$EMAIL" '.users[] | select(.email==$e) | .id' | head -1)"
if [ -z "$ID" ]; then
  curl -s -X POST http://127.0.0.1:54321/auth/v1/admin/users -H "apikey: $SR" -H "Authorization: Bearer $SR" -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\",\"email_confirm\":true}" >/dev/null
else
  curl -s -X PUT "http://127.0.0.1:54321/auth/v1/admin/users/$ID" -H "apikey: $SR" -H "Authorization: Bearer $SR" -H "Content-Type: application/json" \
    -d "{\"password\":\"$PW\"}" >/dev/null
fi
TOK="$(curl -s -X POST "http://127.0.0.1:54321/auth/v1/token?grant_type=password" -H "apikey: $AN" -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}" | jq -r .access_token)"
curl -s -X POST http://127.0.0.1:54321/rest/v1/rpc/ensure_default_templates -H "apikey: $AN" -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" -d '{}' >/dev/null

DB=supabase_db_reeeeecall-study
if [ "$(docker exec "$DB" psql -U postgres -Atc "select count(*) from decks d join auth.users u on u.id=d.user_id where u.email='$EMAIL'")" = "0" ]; then
  docker exec -i "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < "$HERE/seed.sql" >/dev/null
fi
DECK="$(docker exec "$DB" psql -U postgres -Atc "select d.id from decks d join auth.users u on u.id=d.user_id where u.email='$EMAIL' order by d.created_at limit 1")"

mkdir -p "$HERE/vendor"
if [ ! -f "$HERE/vendor/axe.min.js" ]; then
  (cd "$HERE/vendor" && npm pack axe-core@4.10.3 --silent >/dev/null 2>&1 && tar xzf axe-core-4.10.3.tgz && mv package/axe.min.js . && rm -rf package axe-core-4.10.3.tgz)
fi

umask 077
printf "LOCAL_TEST_EMAIL=%s\nLOCAL_TEST_PASSWORD=%s\nLOCAL_ANON_KEY=%s\nDECK=%s\n" "$EMAIL" "$PW" "$AN" "$DECK" > "$HERE/local.env"
echo "ready: $HERE/local.env (deck $DECK)"
echo "web:    VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=\$LOCAL_ANON_KEY pnpm --filter @reeeeecall/web exec vite --port 5192"

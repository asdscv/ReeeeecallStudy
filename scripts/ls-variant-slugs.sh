#!/usr/bin/env bash
# ── LemonSqueezy variant slug puller ─────────────────────────────────────────
# Lists every variant in your store with its NUMERIC id, SLUG (UUID), price and
# billing interval, then emits a best-effort VITE_LEMONSQUEEZY_VARIANTS JSON
# mapped to our catalog ids.
#
#   NUMERIC id  → LEMONSQUEEZY_VARIANT_MAP  (Supabase edge secret, webhook side)
#   SLUG (UUID) → VITE_LEMONSQUEEZY_VARIANTS (Cloudflare build var, checkout side)
#
# ⚠️ Test-mode and live products have DIFFERENT ids AND slugs. Run this with the
#    key for whichever mode you're wiring, and re-run after going live.
#
# Usage:
#   export LS_API_KEY='eyJ...'          # LemonSqueezy → Settings → API
#   bash scripts/ls-variant-slugs.sh
#
# Requires: curl, jq
set -euo pipefail

: "${LS_API_KEY:?set LS_API_KEY to your LemonSqueezy API key (Settings → API)}"
command -v jq >/dev/null || { echo "jq not found — brew install jq" >&2; exit 1; }

API="https://api.lemonsqueezy.com/v1"
auth=(-H "Authorization: Bearer ${LS_API_KEY}" -H "Accept: application/vnd.api+json")

# ── fetch ALL variants (paginated), with their parent product included ────────
tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
: > "$tmp"
url="${API}/variants?include=product&page%5Bsize%5D=100&page%5Bnumber%5D=1"
page=1
while [ -n "$url" ]; do
  resp="$(curl -sS "${auth[@]}" "$url")"
  if echo "$resp" | jq -e '.errors' >/dev/null 2>&1; then
    echo "LemonSqueezy API error:" >&2
    echo "$resp" | jq '.errors' >&2
    exit 1
  fi
  echo "$resp" >> "$tmp"
  # product-name lookup + one row per variant
  echo "$resp" | jq -c '
    (reduce (.included[]? | select(.type=="products")) as $p ({}; .[$p.id] = $p.attributes.name)) as $pn
    | .data[]
    | {
        product: ($pn[.relationships.product.data.id] // "?"),
        variant: .attributes.name,
        id:      .id,
        slug:    .attributes.slug,
        price:   (.attributes.price // 0),
        interval:(.attributes.interval // "one-time"),
        test:    (.attributes.test_mode // false)
      }' >> "${tmp}.rows" 2>/dev/null || true
  url="$(echo "$resp" | jq -r '.links.next // empty')"
  page=$((page+1))
  [ "$page" -gt 50 ] && break   # safety
done

rows="${tmp}.rows"; trap 'rm -f "$tmp" "$rows"' EXIT
[ -s "$rows" ] || { echo "No variants found. Wrong key / empty store / wrong mode?" >&2; exit 1; }

# ── human-readable table ──────────────────────────────────────────────────────
echo
printf '%-22s %-14s %-10s %-9s %-6s %s\n' "PRODUCT" "VARIANT" "ID" "PRICE" "MODE" "SLUG"
printf '%-22s %-14s %-10s %-9s %-6s %s\n' "----------------------" "--------------" "----------" "---------" "------" "------------------------------------"
jq -rs '.[] |
  [ (.product[0:22]), (.variant[0:14]), .id,
    ((if .interval=="one-time" then "" else "/" + .interval end) as $iv | (.price|tostring) + $iv),
    (if .test then "TEST" else "live" end),
    .slug ] | @tsv' "$rows" \
| awk -F'\t' '{ printf "%-22s %-14s %-10s %-9s %-6s %s\n", $1,$2,$3,$4,$5,$6 }'

# ── best-effort auto-map to our catalog by (price, one-time vs subscription) ──
# Catalog target prices (USD cents). Prices need NOT match — this is a GUESS.
#   credits_1000 $0.99 · credits_5000 $4.99 · credits_10000 $9.99 (one-time)
#   sub_5k_monthly $1.99 · sub_unlimited_monthly $9.99 (subscription)
echo
echo "── best-effort VITE_LEMONSQUEEZY_VARIANTS (VERIFY against the table above) ──"
jq -rs '
  # sub? = interval != "one-time"
  def catalog:
    if   .interval=="one-time" and .price==99  then "credits_1000"
    elif .interval=="one-time" and .price==499 then "credits_5000"
    elif .interval=="one-time" and .price==999 then "credits_10000"
    elif .interval!="one-time" and .price==199 then "sub_5k_monthly"
    elif .interval!="one-time" and .price==999 then "sub_unlimited_monthly"
    else empty end;
  reduce .[] as $v ({}; ($v | catalog) as $k | if $k then .[$k]=$v.slug else . end)
  | to_entries | sort_by(.key) | from_entries
' "$rows" | jq -c .

echo
echo "── and the inverse LEMONSQUEEZY_VARIANT_MAP (numeric id → catalog id, webhook secret) ──"
jq -rs '
  def catalog:
    if   .interval=="one-time" and .price==99  then "credits_1000"
    elif .interval=="one-time" and .price==499 then "credits_5000"
    elif .interval=="one-time" and .price==999 then "credits_10000"
    elif .interval!="one-time" and .price==199 then "sub_5k_monthly"
    elif .interval!="one-time" and .price==999 then "sub_unlimited_monthly"
    else empty end;
  reduce .[] as $v ({}; ($v | catalog) as $k | if $k then .[$v.id]=$k else . end)
' "$rows" | jq -c .

echo
echo "NOTE: auto-map keys off price+interval. If you set different prices, ignore the"
echo "      JSON and hand-build it from the SLUG column above (match product → catalog id)."

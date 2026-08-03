#!/usr/bin/env bash
# Refuse a develop→main promotion that ships migrations nobody has said were applied.
#
# ── The failure this exists for ──────────────────────────────────────────────
#
# Merging to main auto-deploys web via Cloudflare. The web code calls the RPCs the
# migrations create. If the schema lags the code, the app 404s on `append_daily_plan_items`
# and renders `undefined` where `get_goal_knowledge`'s new keys should be — for every user,
# immediately, with nothing in CI having gone red.
#
# The ordering rule (migrations first, merge second) lived only in a runbook, which means it
# lived in whoever remembered to open it.
#
# ── Why this is an attestation and not a verification ────────────────────────
#
# Production's schema version is not in git. Checking it for real needs a credential in CI,
# and this repo is PUBLIC — a commit-message injection that could run arbitrary code on the
# deploy runner was found and fixed on 2026-08-03. Handing that same environment a
# production database credential raises the worst case from "a bad OTA" to "a dropped
# database", which is a poor trade for a check that runs a few times a month.
#
# So this asks a person to state what they applied, and then holds them to it: the number
# has to match the highest migration the PR actually ships. It cannot catch someone who
# writes the number without running anything. It does catch the thing that actually happens
# — forgetting the step exists, or applying an older range and promoting a newer one.
#
# ── Usage ────────────────────────────────────────────────────────────────────
#
#   PR_BODY="$(gh pr view N --json body -q .body)" \
#     .github/scripts/check-migration-promotion.sh <base-ref> <head-ref>
#
# Exits 0 to allow the promotion, 1 to block it.
set -uo pipefail

BASE_REF="${1:?usage: $0 <base-ref> <head-ref>}"
HEAD_REF="${2:?usage: $0 <base-ref> <head-ref>}"
BODY="${PR_BODY:-}"

# Highest NNN among `supabase/migrations/NNN_*.sql` at a ref. 0 when there are none.
max_migration() {
  git ls-tree --name-only "$1" supabase/migrations/ 2>/dev/null \
    | sed -n 's|.*/\([0-9][0-9]*\)_.*\.sql$|\1|p' \
    | sort -n | tail -1 | sed 's/^0*//' | grep . || echo 0
}

BASE_MAX=$(max_migration "$BASE_REF")
HEAD_MAX=$(max_migration "$HEAD_REF")

echo "  ${BASE_REF}: migrations up to ${BASE_MAX}"
echo "  ${HEAD_REF}: migrations up to ${HEAD_MAX}"

if [ "$HEAD_MAX" -eq "$BASE_MAX" ]; then
  echo "✅ No new migrations in this promotion."
  exit 0
fi

if [ "$HEAD_MAX" -lt "$BASE_MAX" ]; then
  echo "::error::${HEAD_REF} is BEHIND ${BASE_REF} on migrations (${HEAD_MAX} < ${BASE_MAX})."
  echo "         A promotion should never remove migrations. Check that the branch is up to date."
  exit 1
fi

NEW_RANGE_START=$((BASE_MAX + 1))
echo "  new in this promotion: ${NEW_RANGE_START}..${HEAD_MAX}"

# The attestation. Matched case-insensitively with flexible spacing, because it is typed by
# a human into a PR description and a rejected promotion over a stray space helps nobody.
DECLARED=$(printf '%s' "$BODY" \
  | grep -ioE 'prod-migrations-applied[[:space:]]*:[[:space:]]*[0-9]+' \
  | grep -oE '[0-9]+$' | tail -1)

if [ -z "$DECLARED" ]; then
  echo "::error::This promotion ships migrations ${NEW_RANGE_START}..${HEAD_MAX}, and nothing says they were applied to production."
  echo ""
  echo "  Merging to main auto-deploys web. If the schema lags the code, the app 404s on the"
  echo "  new RPCs for every user, and no CI job goes red."
  echo ""
  echo "  Apply them first:"
  echo "    ./scripts/apply-prod-migrations.sh --from ${NEW_RANGE_START} --to ${HEAD_MAX} --dry-run"
  echo "    ./scripts/apply-prod-migrations.sh --from ${NEW_RANGE_START} --to ${HEAD_MAX}"
  echo "  (or the Management API path in DOCS/DEPLOYMENT/PROD-MIGRATION-RUNBOOK.md, which"
  echo "   needs no database password)"
  echo ""
  echo "  Then add this line to the PR description:"
  echo "    prod-migrations-applied: ${HEAD_MAX}"
  exit 1
fi

if [ "$DECLARED" -ne "$HEAD_MAX" ]; then
  echo "::error::The PR declares production is at ${DECLARED}, but this promotion ships migrations up to ${HEAD_MAX}."
  echo ""
  echo "  Migrations ${DECLARED}..${HEAD_MAX} would reach users before their schema does."
  echo "  Apply the rest, then update the line to: prod-migrations-applied: ${HEAD_MAX}"
  exit 1
fi

echo "✅ Declared applied through ${DECLARED}, matching the highest migration in this promotion."
echo "   (A declaration, not a measurement — see the header for why.)"

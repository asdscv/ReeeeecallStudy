#!/usr/bin/env bash
# Apply a contiguous range of migrations to a Supabase database, in order, and record
# them in `supabase_migrations.schema_migrations`.
#
# ── Why this is not `supabase db push` ───────────────────────────────────────
#
# This repo numbers migrations `NNN_name.sql` (181, 182, …). The CLI expects
# `<14-digit-timestamp>_name.sql` and cannot map the two, so `db push` reports every
# applied remote version as "not found in local migrations directory" and offers to
# repair the history — which, run without reading it, would mark applied migrations as
# reverted. The numbering is the repo's convention and is what CI's psql loop uses, so
# the deploy path follows the same convention instead of fighting it.
#
# ── What it guarantees ───────────────────────────────────────────────────────
#
#   * It refuses to start unless the database is at EXACTLY the version before the
#     range. No gaps, no re-application, no "it was probably fine".
#   * ON_ERROR_STOP: the first failure ends the run, and the migrations that already
#     committed stay recorded — so a re-run resumes rather than replays.
#   * The version is recorded only AFTER its file applies, in the same psql session.
#   * `--dry-run` does everything except apply, so the preflight can be read first.
#
# It does NOT wrap the whole range in one transaction. Each migration file carries its
# own BEGIN/COMMIT, and Postgres cannot roll back across them once committed. Rolling
# back a range means running the matching files in supabase/rollbacks/, newest first.
#
# ── Usage ────────────────────────────────────────────────────────────────────
#
#   export PROD_DB_URL='postgresql://postgres.<ref>:<password>@<host>:5432/postgres'
#   ./scripts/apply-prod-migrations.sh --from 181 --to 185 --dry-run   # read it first
#   ./scripts/apply-prod-migrations.sh --from 181 --to 185
#
# The password is the database password from the Supabase dashboard
# (Project Settings → Database), NOT the service-role key and NOT the CLI access token.
set -uo pipefail

FROM=""; TO=""; DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --from) FROM="$2"; shift 2 ;;
    --to)   TO="$2";   shift 2 ;;
    --dry-run) DRY=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$FROM" ] || [ -z "$TO" ]; then
  echo "usage: $0 --from <N> --to <M> [--dry-run]" >&2; exit 2
fi
if [ -z "${PROD_DB_URL:-}" ]; then
  echo "::error::PROD_DB_URL is not set. Export the database connection string first." >&2; exit 2
fi
if ! command -v psql >/dev/null 2>&1; then
  echo "::error::psql not found on PATH." >&2; exit 2
fi

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

# Resolve each number to exactly one file, so a typo or a duplicate number stops the run
# rather than silently applying the wrong thing. Duplicate numbering has bitten this repo
# before: it passes the CI psql loop and fails `supabase db reset`.
files=()
for n in $(seq "$FROM" "$TO"); do
  matches=(supabase/migrations/"${n}"_*.sql)
  if [ ! -e "${matches[0]}" ]; then
    echo "::error::no migration file for $n" >&2; exit 1
  fi
  if [ "${#matches[@]}" -ne 1 ]; then
    echo "::error::$n matches ${#matches[@]} files: ${matches[*]}" >&2; exit 1
  fi
  files+=("${matches[0]}")
done

echo "── preflight ─────────────────────────────────────────────"
current="$(psql "$PROD_DB_URL" -tAc \
  "SELECT COALESCE(max(version::bigint), 0) FROM supabase_migrations.schema_migrations WHERE version ~ '^[0-9]+$';" 2>&1)"
if ! [[ "$current" =~ ^[0-9]+$ ]]; then
  echo "::error::could not read migration history: $current" >&2; exit 1
fi
echo "  database is at: $current"
echo "  range to apply: $FROM .. $TO"

expected=$((FROM - 1))
if [ "$current" -ne "$expected" ]; then
  echo "::error::refusing to run. The database is at $current but --from $FROM expects $expected." >&2
  echo "         Applying anyway would either skip a migration or replay one." >&2
  exit 1
fi

for f in "${files[@]}"; do echo "  → $f"; done

if [ "$DRY" -eq 1 ]; then
  echo "── dry run: nothing was applied ──────────────────────────"
  exit 0
fi

echo "── applying ──────────────────────────────────────────────"
for i in "${!files[@]}"; do
  f="${files[$i]}"
  n=$((FROM + i))
  echo "  applying $n ($f)"
  if ! psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 -q -f "$f"; then
    echo "::error::$f FAILED. Database is at $((n - 1)); nothing after it ran." >&2
    echo "         Fix the migration, then re-run with --from $n." >&2
    exit 1
  fi
  # Recorded only after the file committed, so a crash mid-range leaves an accurate
  # history and the re-run picks up exactly where it stopped.
  if ! psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 -q -c \
    "INSERT INTO supabase_migrations.schema_migrations (version) VALUES ('$n') ON CONFLICT DO NOTHING;"; then
    echo "::error::$n applied but could not be recorded. Record it by hand before re-running." >&2
    exit 1
  fi
done

final="$(psql "$PROD_DB_URL" -tAc \
  "SELECT COALESCE(max(version::bigint), 0) FROM supabase_migrations.schema_migrations WHERE version ~ '^[0-9]+$';")"
echo "── done ──────────────────────────────────────────────────"
echo "  database is now at: $final"
if [ "$final" -ne "$TO" ]; then
  echo "::error::expected $TO. The history and the schema may disagree — check before deploying." >&2
  exit 1
fi

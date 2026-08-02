#!/usr/bin/env bash
# ============================================================================
# Dry run for the learning-engine migrations.
#
#   before → apply 165,167,168,169,178 → after_apply → rollback → after_rollback
#
# Proves two things about the shipped artifacts (not copies of them):
#   1. the migrations apply cleanly in order on top of develop's contract;
#   2. the rollbacks remove everything they introduced, leaving zero residue
#      and leaving pre-existing tables and develop's rating contract intact.
#
# Ends by re-applying the migrations, so the database is left in the same state
# the rest of the test suite expects.
#
# Usage: ./scripts/dry-run-learning-migrations.sh
# Env:   DB_URL (default: local Supabase)
# ============================================================================
set -euo pipefail

DB_URL="${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

MIGRATIONS=(
  165_learning_engine_schema
  167_learning_engine_rpcs
  168_ai_remediation_metering
  169_remove_customer_external_api_contract
  178_enrichment_attempt_provenance
  181_goal_knowledge_summary
  182_goal_workload_and_learner_schedule
)
# Rollbacks run in reverse dependency order.
#
# 178 MUST be reverted before 168. It replaced 168's 12-argument
# `persist_ai_remediation` with a 13-argument one, and 168's rollback drops that function
# by its exact 12-argument signature — so reverting 168 first would leave the 13-arg
# function behind, and the zero-residue assertion would (correctly) fail.
ROLLBACKS=(
  182_goal_workload_and_learner_schedule.down
  181_goal_knowledge_summary.down
  178_enrichment_attempt_provenance.down
  169_remove_customer_external_api_contract.down
  168_ai_remediation_metering.down
  167_learning_engine_rpcs.down
  165_learning_engine_schema.down
)

psql_run() { psql "$DB_URL" -v ON_ERROR_STOP=1 -q "$@"; }

check_phase() {
  local phase="$1"
  psql_run -v phase="$phase" -f supabase/tests/learning_dry_run_check.sql
}

apply_all() {
  for m in "${MIGRATIONS[@]}"; do
    echo "  apply  $m"
    psql_run -f "supabase/migrations/${m}.sql" >/dev/null
  done
}

rollback_all() {
  for r in "${ROLLBACKS[@]}"; do
    echo "  revert $r"
    psql_run -f "supabase/rollbacks/${r}.sql" >/dev/null
  done
}

# ── 0) Start from a clean slate ─────────────────────────────────────────────
# The local instance is shared between worktrees, so a previous run may have
# left the migrations applied. Reverting first is idempotent (every rollback
# uses IF EXISTS) and makes the 'before' assertion meaningful.
echo "== normalizing to a clean slate =="
rollback_all >/dev/null 2>&1 || true

echo "== phase: before =="
check_phase before

echo "== applying migrations =="
apply_all
echo "== phase: after_apply =="
check_phase after_apply

echo "== reverting migrations =="
rollback_all
echo "== phase: after_rollback =="
check_phase after_rollback

# ── Partial-failure safety ─────────────────────────────────────────────────
# Roll back again on an already-clean database. Every rollback must be
# idempotent so that backing out a half-applied rollout cannot itself fail.
echo "== phase: rollback is idempotent on a clean database =="
rollback_all
check_phase after_rollback

# ── Restore ────────────────────────────────────────────────────────────────
echo "== restoring migrations for the rest of the suite =="
apply_all
check_phase after_apply

echo ""
echo "LEARNING_DRY_RUN_PASSED"

-- ============================================================================
-- Dry-run test: migrations 165/167/168/169/176 apply → rollback → zero residue.
--
-- Purpose: prove the rollback artifacts actually undo the migrations, so a
-- failed rollout can be backed out without leaving orphaned tables, functions,
-- constraints, indexes, policies, or grants behind.
--
-- This file is DRIVEN BY scripts/dry-run-learning-migrations.sh, which runs the
-- real migration and rollback files against the database. It cannot run alone,
-- because a dry run must exercise the shipped artifacts, not a copy of them.
--
-- Usage:
--   ./scripts/dry-run-learning-migrations.sh
--
-- The script calls this file three times with :phase set to
-- 'before' | 'after_apply' | 'after_rollback'.
-- ============================================================================
\set ON_ERROR_STOP on

-- The object inventory this migration set is responsible for.
CREATE OR REPLACE VIEW pg_temp.learning_object_inventory AS
WITH expected_tables(name) AS (
  VALUES ('learning_goals'), ('content_sources'), ('learning_concepts'),
         ('learning_activities'), ('learning_goal_decks'), ('learning_goal_concepts'),
         ('answer_attempts'), ('daily_plans'), ('daily_plan_items'),
         ('study_recommendations'), ('user_enrichments'), ('learning_usage_daily')
),
expected_functions(name) AS (
  VALUES ('create_learning_goal'), ('update_learning_goal'), ('archive_learning_goal'),
         ('create_private_source'), ('create_private_concept'), ('create_private_activity'),
         ('save_daily_plan'), ('record_answer_attempt'), ('set_user_enrichment_status'),
         ('_check_card_access'), ('_check_activity_access'),
         ('reserve_ai_remediation'), ('persist_ai_remediation')
)
SELECT
  (SELECT count(*) FROM expected_tables e
     JOIN pg_class c ON c.relname = e.name
     JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    WHERE c.relkind = 'r')::int AS tables_present,
  (SELECT count(*) FROM expected_functions e
     JOIN pg_proc p ON p.proname = e.name
     JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public')::int AS functions_present,
  -- Indexes owned by the learning tables (drop with the table, so they must reach 0).
  (SELECT count(*) FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename IN (SELECT name FROM expected_tables))::int AS indexes_present,
  -- RLS policies on the learning tables.
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (SELECT name FROM expected_tables))::int AS policies_present,
  -- Any grant to a client role on a learning table.
  (SELECT count(*) FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name IN (SELECT name FROM expected_tables)
      AND grantee IN ('anon','authenticated'))::int AS client_grants_present,
  -- Triggers the migrations attach to the learning tables.
  (SELECT count(*) FROM pg_trigger t
     JOIN pg_class c ON c.oid = t.tgrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    WHERE NOT t.tgisinternal
      AND c.relname IN (SELECT name FROM expected_tables))::int AS triggers_present,
  -- Columns migration 168 adds to the pre-existing AI job ledger. These must be
  -- removed by rollback without dropping the ledger itself.
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_generation_jobs'
      AND column_name IN ('job_kind','billable_fraction'))::int AS ledger_columns_present,
  -- Guard: the pre-existing tables these migrations must NEVER drop.
  (SELECT count(*) FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    WHERE c.relkind = 'r'
      AND c.relname IN ('cards','decks','study_logs','user_card_progress',
                        'deck_shares','ai_generation_jobs','study_rating_events'))::int AS preexisting_present,
  -- Guard: develop's rating contract must survive untouched.
  (SELECT count(*) FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
    WHERE p.proname IN ('apply_study_rating','undo_study_rating',
                        'finalize_study_session','reset_card_srs'))::int AS rating_contract_present;

\echo ''
\echo '--- inventory:' :phase
SELECT * FROM pg_temp.learning_object_inventory \gx

-- psql does not interpolate variables inside dollar-quoted bodies, so hand the
-- phase to the assertion block through a session setting.
SELECT set_config('dryrun.phase', :'phase', false);

DO $$
DECLARE
  inv record;
  phase text := current_setting('dryrun.phase');
BEGIN
  SELECT * INTO inv FROM pg_temp.learning_object_inventory;

  -- The pre-existing world must be intact in EVERY phase. If a migration or a
  -- rollback ever drops one of these, that is a data-loss defect.
  ASSERT inv.preexisting_present = 7,
    format('[%s] pre-existing tables damaged: %s of 7 present', phase, inv.preexisting_present);
  ASSERT inv.rating_contract_present = 4,
    format('[%s] develop rating contract damaged: %s of 4 functions present', phase, inv.rating_contract_present);

  IF phase = 'before' THEN
    ASSERT inv.tables_present = 0,
      format('[before] expected a clean slate, found %s learning tables', inv.tables_present);
    ASSERT inv.functions_present = 0,
      format('[before] expected a clean slate, found %s learning functions', inv.functions_present);
    ASSERT inv.ledger_columns_present = 0,
      format('[before] expected a clean slate, found %s ledger columns', inv.ledger_columns_present);

  ELSIF phase = 'after_apply' THEN
    ASSERT inv.tables_present = 12,
      format('[after_apply] expected 12 tables, got %s', inv.tables_present);
    ASSERT inv.functions_present = 13,
      format('[after_apply] expected 13 functions, got %s', inv.functions_present);
    ASSERT inv.ledger_columns_present = 2,
      format('[after_apply] expected 2 ledger columns, got %s', inv.ledger_columns_present);
    ASSERT inv.policies_present > 0,
      '[after_apply] learning tables have no RLS policies';
    ASSERT inv.indexes_present > 0,
      '[after_apply] learning tables have no indexes';

  ELSIF phase = 'after_rollback' THEN
    -- The whole point: rollback must leave nothing behind.
    ASSERT inv.tables_present = 0,
      format('[after_rollback] %s learning tables survived rollback', inv.tables_present);
    ASSERT inv.functions_present = 0,
      format('[after_rollback] %s learning functions survived rollback', inv.functions_present);
    ASSERT inv.indexes_present = 0,
      format('[after_rollback] %s learning indexes survived rollback', inv.indexes_present);
    ASSERT inv.policies_present = 0,
      format('[after_rollback] %s learning policies survived rollback', inv.policies_present);
    ASSERT inv.client_grants_present = 0,
      format('[after_rollback] %s client grants survived rollback', inv.client_grants_present);
    ASSERT inv.triggers_present = 0,
      format('[after_rollback] %s learning triggers survived rollback', inv.triggers_present);
    ASSERT inv.ledger_columns_present = 0,
      format('[after_rollback] %s ledger columns survived rollback', inv.ledger_columns_present);

  ELSE
    RAISE EXCEPTION 'unknown phase: %', phase;
  END IF;

  RAISE NOTICE 'DRY_RUN_PHASE_OK %', phase;
END $$;

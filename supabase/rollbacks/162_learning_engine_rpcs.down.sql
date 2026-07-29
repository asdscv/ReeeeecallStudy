-- ============================================================================
-- Rollback: 162_learning_engine_rpcs
-- Drops all functions and the learning_usage_daily table created by mig 162.
-- Does NOT touch any other existing table, column, function, or policy.
-- For local/dev rollback. Run manually if needed.
-- ============================================================================

BEGIN;

-- ── Drop internal helpers ───────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public._check_activity_access(uuid, uuid);
DROP FUNCTION IF EXISTS public._check_card_access(uuid, uuid);

-- ── Drop user-facing RPCs ───────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.set_user_enrichment_status(uuid, text);

DROP FUNCTION IF EXISTS public.record_answer_attempt(
  uuid, text, text, text, jsonb, uuid, uuid, uuid, uuid, numeric, jsonb, jsonb, integer, integer, text
);

DROP FUNCTION IF EXISTS public.save_daily_plan(uuid, date, text, text, text, integer, jsonb);

DROP FUNCTION IF EXISTS public.create_private_activity(
  text, text, text, text, text, uuid, uuid, uuid, text, jsonb, jsonb, jsonb, jsonb, numeric
);

DROP FUNCTION IF EXISTS public.create_private_concept(text, text, text, text, uuid, jsonb);

DROP FUNCTION IF EXISTS public.create_private_source(text, text, text, text, text, jsonb);

DROP FUNCTION IF EXISTS public.archive_learning_goal(uuid);

DROP FUNCTION IF EXISTS public.update_learning_goal(uuid, text, integer, date, text, jsonb, jsonb);

DROP FUNCTION IF EXISTS public.create_learning_goal(text, text, integer, date, jsonb, jsonb);

-- ── Drop rate-limit table ───────────────────────────────────────────────────
DROP TABLE IF EXISTS learning_usage_daily;

COMMIT;

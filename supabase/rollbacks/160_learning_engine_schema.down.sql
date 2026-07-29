-- ============================================================================
-- Rollback: 160_learning_engine_schema
-- Drops all objects created by mig 160 in dependency-reverse order.
-- Does NOT touch any existing table, column, function, or policy.
-- For local/dev rollback. Not auto-applied; run manually if needed.
-- ============================================================================

BEGIN;

-- ── Remove deferred FK from answer_attempts to daily_plan_items ─────────────
ALTER TABLE IF EXISTS answer_attempts DROP CONSTRAINT IF EXISTS fk_answer_attempts_plan_item;

-- ── Drop tables in reverse dependency order ─────────────────────────────────
-- 11) user_enrichments (no dependents)
DROP TABLE IF EXISTS user_enrichments CASCADE;

-- 10) study_recommendations (no dependents)
DROP TABLE IF EXISTS study_recommendations CASCADE;

-- 9) daily_plan_items (referenced by answer_attempts.plan_item_id — FK dropped above)
DROP TABLE IF EXISTS daily_plan_items CASCADE;

-- 8) daily_plans (referenced by daily_plan_items — dropped above)
DROP TABLE IF EXISTS daily_plans CASCADE;

-- 7) answer_attempts (referenced by daily_plan_items.completion_attempt_id — dropped above)
DROP TABLE IF EXISTS answer_attempts CASCADE;

-- 6) learning_goal_concepts (no dependents beyond learning_goals)
DROP TABLE IF EXISTS learning_goal_concepts CASCADE;

-- 5) learning_goal_decks (no dependents beyond learning_goals)
DROP TABLE IF EXISTS learning_goal_decks CASCADE;

-- 4) learning_activities (referenced by answer_attempts, daily_plan_items,
--    study_recommendations, user_enrichments — all dropped above)
DROP TABLE IF EXISTS learning_activities CASCADE;

-- 3) learning_concepts (referenced by learning_activities, learning_goal_concepts,
--    daily_plan_items, study_recommendations, user_enrichments — all dropped above)
DROP TABLE IF EXISTS learning_concepts CASCADE;

-- 2) content_sources (referenced by learning_concepts, learning_activities — dropped above)
DROP TABLE IF EXISTS content_sources CASCADE;

-- 1) learning_goals (referenced by learning_goal_decks, learning_goal_concepts,
--    answer_attempts, daily_plans, study_recommendations, user_enrichments — all dropped)
DROP TABLE IF EXISTS learning_goals CASCADE;

COMMIT;

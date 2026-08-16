-- ============================================================================
-- Smoke test: the learning-engine happy path, end to end, as a real caller.
--
-- Walks the whole loop a client would drive:
--   goal → source → concept → activity → daily plan → attempt → plan rollup
--   → AI remediation reservation → enrichment persistence → accept
--
-- Everything runs as `authenticated` through the RPCs only. No direct DML on
-- the learning tables, so the test also proves the RPC surface is sufficient
-- to operate the engine without client write grants.
--
-- Rolls back at the end; leaves no rows behind.
-- Usage: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/learning_smoke_test.sql
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- session_replication_role=replica lets us seed auth.users without firing the
-- profile/template triggers, matching the existing learning_engine_test.
SET LOCAL session_replication_role = replica;

INSERT INTO auth.users (id) VALUES
  ('50000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (id, display_name) VALUES
  ('50000000-0000-4000-8000-000000000001', 'Smoke user')
ON CONFLICT (id) DO NOTHING;

INSERT INTO card_templates (id, user_id, name) VALUES
  ('50100000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'Smoke template');

INSERT INTO decks (id, user_id, name) VALUES
  ('50200000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'Smoke deck');

INSERT INTO cards (
  id, deck_id, user_id, template_id, sort_position, created_at,
  srs_status, interval_days, ease_factor, repetitions
) VALUES (
  '50300000-0000-4000-8000-000000000001',
  '50200000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  '50100000-0000-4000-8000-000000000001',
  1, '2020-01-01T00:00:00Z', 'new', 0, 2.5, 0
);

-- reserve_ai_remediation requires a wallet that can cover the LIST PRICE, which mig 230 took to
-- 500,000 micro for an explanation. 100,000 was enough when it was 50,000 and is not now — the
-- reservation gate is `balance >= price`, so the fixture has to be a float, not a token.
INSERT INTO ai_credit_balance (user_id, balance)
VALUES ('50000000-0000-4000-8000-000000000001', 5000000)
ON CONFLICT (user_id) DO UPDATE SET balance = 5000000;

SET LOCAL session_replication_role = origin;

-- Become the authenticated caller. Every RPC below derives the user from
-- auth.uid(); none of them accept a caller-supplied user id.
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-000000000001', true);

-- Carry ids between steps without direct table writes.
CREATE TEMP TABLE smoke_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;

-- ── 1) Goal, source, concept, activity ─────────────────────────────────────
DO $$
DECLARE
  r jsonb;
  x_goal uuid;
  x_source uuid;
  x_concept uuid;
  x_activity uuid;
BEGIN
  r := create_learning_goal('labor-law', 'Pass the written exam', 90, '2026-12-01');
  ASSERT (r->>'ok')::boolean, r::text;
  x_goal := (r->>'goal_id')::uuid;
  ASSERT x_goal IS NOT NULL, r::text;
  ASSERT EXISTS (
    SELECT 1 FROM learning_goals
     WHERE id = x_goal
       AND user_id = '50000000-0000-4000-8000-000000000001'
       AND status = 'active' AND daily_minutes = 90
  ), 'goal row not written as the authenticated owner';

  r := create_private_source('labor-law', 'statute', 'Labor Standards Act',
                             'https://law.example/lsa', 'LSA art. 23');
  ASSERT (r->>'ok')::boolean, r::text;
  x_source := (r->>'source_id')::uuid;
  ASSERT EXISTS (
    SELECT 1 FROM content_sources
     WHERE id = x_source AND owner_user_id = '50000000-0000-4000-8000-000000000001'
  ), 'source not owned by caller';

  r := create_private_concept('labor-law', 'unfair-dismissal-elements',
                              'Unfair dismissal elements', 'Statutory elements', x_source);
  ASSERT (r->>'ok')::boolean, r::text;
  x_concept := (r->>'concept_id')::uuid;

  -- Activity bridged to an owned card, with a rubric — the produce case.
  r := create_private_activity(
    'produce', 'text', 'text', 'rubric', 'Draft an IRAC paragraph',
    x_concept,
    '50300000-0000-4000-8000-000000000001',
    x_source,
    'Write one IRAC paragraph.',
    jsonb_build_object('prompt', 'Was the dismissal lawful?'),
    NULL,
    jsonb_build_object('criteria', jsonb_build_array(
      jsonb_build_object('id', 'issue', 'weight', 0.5, 'max', 1),
      jsonb_build_object('id', 'rule',  'weight', 0.5, 'max', 1)
    )),
    '{}'::jsonb,
    0.7
  );
  ASSERT (r->>'ok')::boolean, r::text;
  x_activity := (r->>'activity_id')::uuid;
  ASSERT EXISTS (
    SELECT 1 FROM learning_activities
     WHERE id = x_activity
       AND owner_user_id = '50000000-0000-4000-8000-000000000001'
       AND activity_type = 'produce' AND evaluator_type = 'rubric'
       AND difficulty = 0.7
  ), 'activity row not written as expected';

  INSERT INTO smoke_ids VALUES
    ('goal', x_goal), ('source', x_source),
    ('concept', x_concept), ('activity', x_activity);

  RAISE NOTICE 'SMOKE_STEP_OK goal/source/concept/activity';
END $$;

-- ── 2) Goal update and lifecycle ───────────────────────────────────────────
DO $$
DECLARE
  r jsonb;
  x_goal uuid := (SELECT v FROM smoke_ids WHERE k = 'goal');
BEGIN
  r := update_learning_goal(x_goal, 'Pass the written exam (revised)', 120, NULL, 'paused');
  ASSERT (r->>'ok')::boolean, r::text;
  ASSERT EXISTS (
    SELECT 1 FROM learning_goals
     WHERE id = x_goal AND daily_minutes = 120 AND status = 'paused'
       AND title = 'Pass the written exam (revised)'
  ), 'goal update did not apply';

  -- Back to active so the plan step can use it.
  r := update_learning_goal(x_goal, NULL, NULL, NULL, 'active');
  ASSERT (r->>'ok')::boolean, r::text;
  ASSERT (SELECT status FROM learning_goals WHERE id = x_goal) = 'active',
    'goal did not return to active';

  RAISE NOTICE 'SMOKE_STEP_OK goal update/lifecycle';
END $$;

-- ── 3) Daily plan with normalized items ────────────────────────────────────
DO $$
DECLARE
  r jsonb;
  x_goal uuid := (SELECT v FROM smoke_ids WHERE k = 'goal');
  x_activity uuid := (SELECT v FROM smoke_ids WHERE k = 'activity');
  x_concept uuid := (SELECT v FROM smoke_ids WHERE k = 'concept');
  x_plan uuid;
  item_count integer;
BEGIN
  r := save_daily_plan(
    x_goal, '2026-07-30', 'Asia/Seoul', 'daily-plan-v1', 'fp-smoke-001', 60,
    jsonb_build_array(
      -- item 0: the persisted produce activity
      jsonb_build_object(
        'activity_id', x_activity,
        'concept_id', x_concept,
        'activity_type', 'produce',
        'stimulus_type', 'text',
        'response_type', 'text',
        'evaluator_type', 'rubric',
        'reason_code', 'goal_relevance',
        'priority', 0.91,
        'estimated_minutes', 10
      ),
      -- item 1: legacy-card recall fallback, no activity row
      jsonb_build_object(
        'card_id', '50300000-0000-4000-8000-000000000001',
        'activity_type', 'recall',
        'stimulus_type', 'text',
        'response_type', 'self_rate',
        'evaluator_type', 'self_rate',
        'reason_code', 'due_urgency',
        'priority', 0.55,
        'estimated_minutes', 2
      )
    )
  );
  ASSERT (r->>'ok')::boolean, r::text;
  x_plan := (r->>'plan_id')::uuid;
  ASSERT (r->>'total_items')::int = 2, r::text;

  -- Plan header belongs to the caller and to exactly one goal (design §21.5).
  ASSERT EXISTS (
    SELECT 1 FROM daily_plans
     WHERE id = x_plan
       AND user_id = '50000000-0000-4000-8000-000000000001'
       AND daily_plans.goal_id = x_goal
       AND plan_date = '2026-07-30'
       AND algorithm_version = 'daily-plan-v1'
       AND input_fingerprint = 'fp-smoke-001'
       AND budget_minutes = 60
       AND total_items = 2
       AND completed_items = 0
  ), 'plan header not written as expected';

  -- Items are normalized rows with dense positions, not a JSON blob.
  SELECT count(*) INTO item_count FROM daily_plan_items WHERE daily_plan_items.plan_id = x_plan;
  ASSERT item_count = 2, format('expected 2 plan items, got %s', item_count);
  ASSERT EXISTS (
    SELECT 1 FROM daily_plan_items
     WHERE daily_plan_items.plan_id = x_plan AND position = 0
       AND activity_id = x_activity AND concept_id = x_concept
       AND activity_type = 'produce' AND reason_code = 'goal_relevance'
       AND priority = 0.91 AND estimated_minutes = 10 AND status = 'pending'
  ), 'plan item 0 wrong';
  ASSERT EXISTS (
    SELECT 1 FROM daily_plan_items
     WHERE daily_plan_items.plan_id = x_plan AND position = 1
       AND card_id = '50300000-0000-4000-8000-000000000001'
       AND activity_id IS NULL
       AND activity_type = 'recall' AND status = 'pending'
  ), 'plan item 1 wrong';

  INSERT INTO smoke_ids VALUES ('plan', x_plan);
  INSERT INTO smoke_ids
    SELECT 'item0', id FROM daily_plan_items WHERE daily_plan_items.plan_id = x_plan AND position = 0;
  INSERT INTO smoke_ids
    SELECT 'item1', id FROM daily_plan_items WHERE daily_plan_items.plan_id = x_plan AND position = 1;

  RAISE NOTICE 'SMOKE_STEP_OK save_daily_plan';
END $$;

-- ── 4) Regenerate the same plan (idempotent replace, not duplicate) ────────
DO $$
DECLARE
  r jsonb;
  x_goal uuid := (SELECT v FROM smoke_ids WHERE k = 'goal');
  x_activity uuid := (SELECT v FROM smoke_ids WHERE k = 'activity');
  x_plan uuid := (SELECT v FROM smoke_ids WHERE k = 'plan');
  plan_rows integer;
  item_count integer;
BEGIN
  r := save_daily_plan(
    x_goal, '2026-07-30', 'Asia/Seoul', 'daily-plan-v1', 'fp-smoke-002', 45,
    jsonb_build_array(jsonb_build_object(
      'activity_id', x_activity,
      'activity_type', 'produce',
      'stimulus_type', 'text',
      'response_type', 'text',
      'evaluator_type', 'rubric',
      'reason_code', 'recent_failure',
      'priority', 0.99,
      'estimated_minutes', 15
    ))
  );
  ASSERT (r->>'ok')::boolean, r::text;

  -- Same (user, goal, date) → the same plan row is reused, not a second one.
  SELECT count(*) INTO plan_rows FROM daily_plans
   WHERE user_id = '50000000-0000-4000-8000-000000000001'
     AND daily_plans.goal_id = x_goal AND plan_date = '2026-07-30';
  ASSERT plan_rows = 1, format('expected 1 plan row for the date, got %s', plan_rows);
  ASSERT (r->>'plan_id')::uuid = x_plan, 'regeneration created a different plan id';

  -- Old items are replaced, and the header reflects the new input.
  SELECT count(*) INTO item_count FROM daily_plan_items WHERE daily_plan_items.plan_id = x_plan;
  ASSERT item_count = 1, format('expected 1 item after replace, got %s', item_count);
  ASSERT EXISTS (
    SELECT 1 FROM daily_plans
     WHERE id = x_plan AND budget_minutes = 45
       AND input_fingerprint = 'fp-smoke-002' AND total_items = 1
  ), 'plan header not refreshed on regeneration';

  DELETE FROM smoke_ids WHERE k IN ('item0','item1');
  INSERT INTO smoke_ids
    SELECT 'item0', id FROM daily_plan_items WHERE daily_plan_items.plan_id = x_plan AND position = 0;

  RAISE NOTICE 'SMOKE_STEP_OK plan regeneration replaces items';
END $$;

-- ── 5) Attempt + atomic plan-item completion + plan rollup ─────────────────
DO $$
DECLARE
  r jsonb;
  x_goal uuid := (SELECT v FROM smoke_ids WHERE k = 'goal');
  x_activity uuid := (SELECT v FROM smoke_ids WHERE k = 'activity');
  x_plan uuid := (SELECT v FROM smoke_ids WHERE k = 'plan');
  x_item0 uuid := (SELECT v FROM smoke_ids WHERE k = 'item0');
  x_attempt uuid;
  replay jsonb;
  attempt_rows integer;
  plan_row daily_plans%ROWTYPE;
BEGIN
  r := record_answer_attempt(
    p_client_attempt_id := '50900000-0000-4000-8000-000000000001',
    p_activity_type := 'produce',
    p_response_type := 'text',
    p_evaluator_type := 'rubric',
    p_response := jsonb_build_object('text', 'Issue: whether the dismissal was lawful...'),
    p_goal_id := x_goal,
    p_activity_id := x_activity,
    p_plan_item_id := x_item0,
    p_normalized_score := 0.75,
    p_evaluator_result := jsonb_build_object('outcome', 'partial'),
    p_feedback := jsonb_build_object('summary', 'Rule statement is thin.'),
    p_hints_used := 1,
    p_duration_ms := 900000,          -- 15 minutes
    p_evaluator_version := 'rubric-v1'
  );
  ASSERT (r->>'ok')::boolean, r::text;
  ASSERT (r->>'idempotent')::boolean IS FALSE, r::text;
  x_attempt := (r->>'attempt_id')::uuid;

  -- Attempt stored with its snapshot, owned by the caller.
  ASSERT EXISTS (
    SELECT 1 FROM answer_attempts
     WHERE id = x_attempt
       AND user_id = '50000000-0000-4000-8000-000000000001'
       AND answer_attempts.goal_id = x_goal AND answer_attempts.activity_id = x_activity
       AND activity_type = 'produce' AND evaluator_type = 'rubric'
       AND normalized_score = 0.75 AND hints_used = 1
       AND duration_ms = 900000 AND evaluator_version = 'rubric-v1'
  ), 'attempt row not written as expected';

  -- The plan item completed and links back to the attempt, in the same call.
  ASSERT EXISTS (
    SELECT 1 FROM daily_plan_items
     WHERE id = x_item0 AND status = 'completed' AND completion_attempt_id = x_attempt
  ), 'plan item did not complete atomically with the attempt';

  -- Plan aggregates rolled up; the only item is done, so the plan is complete.
  SELECT * INTO plan_row FROM daily_plans WHERE id = x_plan;
  ASSERT plan_row.completed_items = 1,
    format('expected completed_items=1, got %s', plan_row.completed_items);
  ASSERT plan_row.completed_minutes = 15,
    format('expected completed_minutes=15, got %s', plan_row.completed_minutes);
  ASSERT plan_row.status = 'completed',
    format('expected plan status completed, got %s', plan_row.status);

  -- Replaying the same client id with the SAME payload returns the stored
  -- attempt and does not double-count the plan or write a second row.
  -- (A reuse with a *different* payload is rejected instead; that is asserted
  -- in learning_net_zero_test.sql.)
  replay := record_answer_attempt(
    p_client_attempt_id := '50900000-0000-4000-8000-000000000001',
    p_activity_type := 'produce',
    p_response_type := 'text',
    p_evaluator_type := 'rubric',
    p_response := jsonb_build_object('text', 'Issue: whether the dismissal was lawful...'),
    p_goal_id := x_goal,
    p_activity_id := x_activity,
    p_plan_item_id := x_item0,
    p_normalized_score := 0.75,
    p_evaluator_result := jsonb_build_object('outcome', 'partial'),
    p_feedback := jsonb_build_object('summary', 'Rule statement is thin.'),
    p_hints_used := 1,
    p_duration_ms := 900000,
    p_evaluator_version := 'rubric-v1'
  );
  ASSERT (replay->>'ok')::boolean, replay::text;
  ASSERT (replay->>'idempotent')::boolean, replay::text;
  ASSERT (replay->>'attempt_id')::uuid = x_attempt, replay::text;

  SELECT count(*) INTO attempt_rows FROM answer_attempts
   WHERE user_id = '50000000-0000-4000-8000-000000000001';
  ASSERT attempt_rows = 1, format('replay wrote a second attempt: %s rows', attempt_rows);

  SELECT * INTO plan_row FROM daily_plans WHERE id = x_plan;
  ASSERT plan_row.completed_items = 1, 'replay double-counted the plan rollup';

  INSERT INTO smoke_ids VALUES ('attempt', x_attempt);
  RAISE NOTICE 'SMOKE_STEP_OK attempt + completion + rollup + replay';
END $$;

-- ── 6) AI remediation reservation (paid path, wallet-gated) ────────────────
DO $$
DECLARE
  r jsonb;
  x_goal uuid := (SELECT v FROM smoke_ids WHERE k = 'goal');
  x_attempt uuid := (SELECT v FROM smoke_ids WHERE k = 'attempt');
  x_job_ref text;
  job ai_generation_jobs%ROWTYPE;
BEGIN
  r := reserve_ai_remediation('explain', x_goal, NULL, x_attempt);
  ASSERT r ? 'job_ref', r::text;
  x_job_ref := r->>'job_ref';
  ASSERT r->>'job_kind' = 'remediation', r::text;
  ASSERT (r->>'billable_fraction')::numeric = 1, r::text;

  -- job_ref is the ledger row id.
  SELECT * INTO job FROM ai_generation_jobs WHERE id = x_job_ref;
  ASSERT FOUND, format('no job row for ref %s', x_job_ref);
  -- §21.3: remediation is classified explicitly and billed in full, so an
  -- explanation is never accounted for as a free generated card.
  ASSERT job.job_kind = 'remediation',
    format('expected job_kind=remediation, got %s', job.job_kind);
  ASSERT job.billable_fraction = 1,
    format('expected billable_fraction=1, got %s', job.billable_fraction);
  ASSERT job.free_cards = 0 AND job.paid_cards = 1,
    format('expected free=0/paid=1, got free=%s paid=%s', job.free_cards, job.paid_cards);
  ASSERT job.user_id = '50000000-0000-4000-8000-000000000001',
    'job not owned by the caller';

  INSERT INTO smoke_ids VALUES ('job', job.id::uuid);
  RAISE NOTICE 'SMOKE_STEP_OK reserve_ai_remediation';
END $$;

-- ── 7) Service-only enrichment persistence, then user acceptance ───────────
-- The edge function persists as service_role; the learner only changes status.
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  x_goal uuid := (SELECT v FROM smoke_ids WHERE k = 'goal');
  x_concept uuid := (SELECT v FROM smoke_ids WHERE k = 'concept');
  x_source uuid := (SELECT v FROM smoke_ids WHERE k = 'source');
  x_enrichment uuid;
BEGIN
  -- persist_ai_remediation returns the new enrichment id directly.
  x_enrichment := persist_ai_remediation(
    p_user_id := '50000000-0000-4000-8000-000000000001',
    p_action := 'explain',
    p_content := jsonb_build_object(
      'action', 'explain',
      'summary', 'Dismissal requires just cause and due process.',
      'blocks', jsonb_build_array(jsonb_build_object('type','text','content','...')),
      'citations', jsonb_build_array(jsonb_build_object('sourceId', x_source::text))
    ),
    p_source_refs := ARRAY[x_source]::uuid[],
    p_goal_id := x_goal,
    p_concept_id := x_concept,
    p_request_fingerprint := 'fp-remediation-smoke-001',
    p_model_version := 'model-x',
    p_provider := 'provider-y',
    p_prompt_version := 'prompt-v1'
  );
  ASSERT x_enrichment IS NOT NULL, 'persist_ai_remediation returned NULL';

  -- Persisted as preview with full provenance; acceptance is a separate act.
  ASSERT EXISTS (
    SELECT 1 FROM user_enrichments
     WHERE id = x_enrichment
       AND user_id = '50000000-0000-4000-8000-000000000001'
       AND action = 'explain' AND status = 'preview'
       AND model_version = 'model-x' AND provider = 'provider-y'
       AND prompt_version = 'prompt-v1'
       AND accepted_at IS NULL
  ), 'enrichment not persisted as preview with provenance';

  INSERT INTO smoke_ids VALUES ('enrichment', x_enrichment);
  RAISE NOTICE 'SMOKE_STEP_OK persist_ai_remediation (service_role)';
END $$;

SELECT set_config('request.jwt.claim.role', 'authenticated', true);

DO $$
DECLARE
  r jsonb;
  x_enrichment uuid := (SELECT v FROM smoke_ids WHERE k = 'enrichment');
  card_updated_before timestamptz;
  card_updated_after timestamptz;
BEGIN
  SELECT updated_at INTO card_updated_before
    FROM cards WHERE id = '50300000-0000-4000-8000-000000000001';

  r := set_user_enrichment_status(x_enrichment, 'accepted');
  ASSERT (r->>'ok')::boolean, r::text;
  ASSERT r->>'status' = 'accepted', r::text;

  ASSERT EXISTS (
    SELECT 1 FROM user_enrichments
     WHERE id = x_enrichment AND status = 'accepted' AND accepted_at IS NOT NULL
  ), 'acceptance did not record status/accepted_at';

  -- Invariant §4.3(3): accepting AI output must not mutate canonical content.
  SELECT updated_at INTO card_updated_after
    FROM cards WHERE id = '50300000-0000-4000-8000-000000000001';
  ASSERT card_updated_before = card_updated_after,
    'accepting an enrichment mutated the underlying card';

  RAISE NOTICE 'SMOKE_STEP_OK set_user_enrichment_status';
END $$;

-- ── 8) Archive closes the loop ─────────────────────────────────────────────
DO $$
DECLARE
  r jsonb;
  x_goal uuid := (SELECT v FROM smoke_ids WHERE k = 'goal');
BEGIN
  r := archive_learning_goal(x_goal);
  ASSERT (r->>'ok')::boolean, r::text;
  ASSERT (SELECT status FROM learning_goals WHERE id = x_goal) = 'archived',
    'goal was not archived';

  -- Archived goals stop being usable for new work.
  BEGIN
    PERFORM save_daily_plan(x_goal, '2026-07-31', 'Asia/Seoul', 'daily-plan-v1',
                            'fp-after-archive', 30,
                            jsonb_build_array(jsonb_build_object(
                              'card_id', '50300000-0000-4000-8000-000000000001',
                              'activity_type', 'recall', 'stimulus_type', 'text',
                              'response_type', 'self_rate', 'evaluator_type', 'self_rate',
                              'estimated_minutes', 2)));
    RAISE EXCEPTION 'expected archived goal to reject a new plan';
  EXCEPTION WHEN sqlstate 'P0003' THEN
    NULL; -- goal not found / archived, as designed
  END;

  RAISE NOTICE 'SMOKE_STEP_OK archive_learning_goal';
END $$;

SELECT 'ALL_LEARNING_SMOKE_TESTS_PASSED' AS result;

ROLLBACK;

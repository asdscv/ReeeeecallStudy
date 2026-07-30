-- Learning engine atomicity/idempotency/lifecycle regression tests (migrations 165, 167).
-- The rating assertions target apply_study_rating from migration 160, which owns the
-- single atomic rating write path; this file guards that the learning-engine schema
-- and RPCs coexist with that contract.
\set ON_ERROR_STOP on
BEGIN;

-- Stable fixtures; all changes roll back at the end.
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id) VALUES
  ('a1000000-0000-4000-8000-000000000001'),
  ('a2000000-0000-4000-8000-000000000002')
ON CONFLICT (id) DO NOTHING;

INSERT INTO card_templates (id, user_id, name) VALUES
  ('a1100000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Learning test template');
INSERT INTO decks (id, user_id, name) VALUES
  ('a1200000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Learning test deck');
INSERT INTO cards (
  id, deck_id, user_id, template_id, sort_position, created_at,
  srs_status, interval_days, ease_factor, repetitions
) VALUES (
  'a1300000-0000-4000-8000-000000000001',
  'a1200000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'a1100000-0000-4000-8000-000000000001',
  1, '2020-01-01T00:00:00Z', 'new', 0, 2.5, 0
);

INSERT INTO learning_activities (
  id, owner_user_id, card_id, activity_type, stimulus_type,
  response_type, evaluator_type, title
) VALUES (
  'a1400000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'a1300000-0000-4000-8000-000000000001',
  'produce', 'card', 'text', 'exact', 'Produce the answer'
);
SET LOCAL session_replication_role = origin;

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);

-- Atomic owned-card update + log, stale-revision rejection, and event idempotency.
-- The rating path itself is owned by migration 160 (apply_study_rating); these
-- assertions guard that the learning-engine schema coexists with it and that the
-- single atomic write contract still holds once learning tables are installed.
DO $$
DECLARE
  first_result jsonb;
  duplicate_result jsonb;
  log_count integer;
  card_row cards%ROWTYPE;
  v_session uuid := 'a1600000-0000-4000-8000-000000000001';
  v_new_srs jsonb := jsonb_build_object(
    'srs_status', 'review', 'ease_factor', 2.6, 'interval_days', 1,
    'repetitions', 1, 'next_review_at', '2026-07-31T00:00:00Z',
    'last_reviewed_at', '2026-07-30T00:00:00Z'
  );
BEGIN
  first_result := apply_study_rating(
    'a1500000-0000-4000-8000-000000000001', v_session,
    'a1300000-0000-4000-8000-000000000001',
    'a1200000-0000-4000-8000-000000000001',
    'srs', 'good', 'embedded', 0, v_new_srs, 1000
  );
  ASSERT first_result->>'status' = 'applied', first_result::text;
  ASSERT (first_result->>'applied_revision')::bigint = 1, first_result::text;

  SELECT * INTO card_row FROM cards WHERE id = 'a1300000-0000-4000-8000-000000000001';
  SELECT count(*) INTO log_count FROM study_logs
   WHERE user_id = 'a1000000-0000-4000-8000-000000000001';
  ASSERT card_row.srs_status = 'review'
    AND card_row.interval_days = 1
    AND card_row.repetitions = 1
    AND abs(card_row.ease_factor - 2.6) < 0.0001,
    'owned card SRS state was not updated atomically';
  ASSERT log_count = 1, format('expected one atomic log, found %s', log_count);

  -- Stale revision: another writer already advanced the card, so this must not write.
  BEGIN
    PERFORM apply_study_rating(
      'a1500000-0000-4000-8000-000000000002', v_session,
      'a1300000-0000-4000-8000-000000000001',
      'a1200000-0000-4000-8000-000000000001',
      'srs', 'again', 'embedded', 0,
      jsonb_build_object(
        'srs_status', 'learning', 'ease_factor', 2.5, 'interval_days', 0,
        'repetitions', 0, 'next_review_at', '2026-07-30T00:10:00Z',
        'last_reviewed_at', '2026-07-30T00:00:00Z'
      ), 800
    );
    RAISE EXCEPTION 'expected stale revision rejection';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;
  SELECT count(*) INTO log_count FROM study_logs
   WHERE user_id = 'a1000000-0000-4000-8000-000000000001';
  SELECT * INTO card_row FROM cards WHERE id = 'a1300000-0000-4000-8000-000000000001';
  ASSERT log_count = 1, 'stale rating inserted a log';
  ASSERT card_row.srs_status = 'review' AND card_row.interval_days = 1,
    'stale rating changed card state';

  -- Same event id + identical payload replays without a second write.
  duplicate_result := apply_study_rating(
    'a1500000-0000-4000-8000-000000000001', v_session,
    'a1300000-0000-4000-8000-000000000001',
    'a1200000-0000-4000-8000-000000000001',
    'srs', 'good', 'embedded', 0, v_new_srs, 1000
  );
  ASSERT duplicate_result->>'status' = 'applied', duplicate_result::text;
  SELECT count(*) INTO log_count FROM study_logs
   WHERE user_id = 'a1000000-0000-4000-8000-000000000001';
  ASSERT log_count = 1, 'duplicate rating inserted another log';

  -- Same event id + changed payload is a client bug and must be rejected.
  BEGIN
    PERFORM apply_study_rating(
      'a1500000-0000-4000-8000-000000000001', v_session,
      'a1300000-0000-4000-8000-000000000001',
      'a1200000-0000-4000-8000-000000000001',
      'srs', 'good', 'embedded', 0, v_new_srs, 1001
    );
    RAISE EXCEPTION 'expected changed rating payload rejection';
  EXCEPTION WHEN SQLSTATE '23505' THEN NULL;
  END;
END $$;

-- Non-SRS records a log without changing progress and replays idempotently.
DO $$
DECLARE
  before_row cards%ROWTYPE;
  after_row cards%ROWTYPE;
  result jsonb;
  duplicate_result jsonb;
  log_count integer;
  v_session uuid := 'a1600000-0000-4000-8000-000000000001';
BEGIN
  SELECT * INTO before_row FROM cards WHERE id = 'a1300000-0000-4000-8000-000000000001';
  result := apply_study_rating(
    'a1500000-0000-4000-8000-000000000003', v_session,
    'a1300000-0000-4000-8000-000000000001',
    'a1200000-0000-4000-8000-000000000001',
    'sequential_review', 'known', 'none', NULL, NULL, 500
  );
  duplicate_result := apply_study_rating(
    'a1500000-0000-4000-8000-000000000003', v_session,
    'a1300000-0000-4000-8000-000000000001',
    'a1200000-0000-4000-8000-000000000001',
    'sequential_review', 'known', 'none', NULL, NULL, 500
  );
  SELECT * INTO after_row FROM cards WHERE id = 'a1300000-0000-4000-8000-000000000001';
  SELECT count(*) INTO log_count FROM study_logs
   WHERE user_id = 'a1000000-0000-4000-8000-000000000001';
  ASSERT result->>'status' = 'applied' AND duplicate_result->>'status' = 'applied',
    format('%s / %s', result::text, duplicate_result::text);
  ASSERT before_row.srs_status = after_row.srs_status
    AND before_row.interval_days = after_row.interval_days
    AND before_row.repetitions = after_row.repetitions
    AND before_row.ease_factor = after_row.ease_factor,
    'non-SRS rating changed SRS state';
  ASSERT log_count = 2, format('non-SRS replay log count should be 2 total, found %s', log_count);
END $$;

-- RPC privilege lockdown.
DO $$ BEGIN
  ASSERT NOT has_function_privilege(
    'anon',
    'public.apply_study_rating(uuid,uuid,uuid,uuid,text,text,text,bigint,jsonb,integer)',
    'EXECUTE'
  ), 'anon can execute apply_study_rating';
  ASSERT NOT has_function_privilege(
    'anon',
    'public.create_learning_goal(text,text,integer,date,jsonb,jsonb)',
    'EXECUTE'
  ), 'anon can execute create_learning_goal';
  ASSERT NOT has_function_privilege(
    'anon',
    'public.save_daily_plan(uuid,date,text,text,text,integer,jsonb)',
    'EXECUTE'
  ), 'anon can execute save_daily_plan';
  ASSERT NOT has_function_privilege(
    'anon',
    'public.record_answer_attempt(uuid,text,text,text,jsonb,uuid,uuid,uuid,uuid,numeric,jsonb,jsonb,integer,integer,text)',
    'EXECUTE'
  ), 'anon can execute record_answer_attempt';
END $$;

-- Goal ownership, lifecycle, create cap, and unarchive cap.
DO $$
DECLARE
  goal_result jsonb;
  goal_id uuid;
  cap_count integer;
BEGIN
  goal_result := create_learning_goal('language', 'Primary goal', 20, NULL, '{}'::jsonb, '{}'::jsonb);
  goal_id := (goal_result->>'goal_id')::uuid;
  PERFORM set_config('learning_test.goal_id', goal_id::text, true);

  PERFORM set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000002', true);
  BEGIN
    PERFORM update_learning_goal(goal_id, 'Stolen title');
    RAISE EXCEPTION 'expected cross-user goal rejection';
  EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);

  PERFORM update_learning_goal(goal_id, p_status => 'paused');
  PERFORM update_learning_goal(goal_id, p_status => 'active');
  PERFORM update_learning_goal(goal_id, p_status => 'completed');
  BEGIN
    PERFORM update_learning_goal(goal_id, p_status => 'active');
    RAISE EXCEPTION 'expected completed-to-active rejection';
  EXCEPTION WHEN SQLSTATE 'P0007' THEN NULL;
  END;
  PERFORM update_learning_goal(goal_id, p_status => 'archived');
  BEGIN
    PERFORM update_learning_goal(goal_id, p_title => 'Archived mutation');
    RAISE EXCEPTION 'expected archived goal immutability';
  EXCEPTION WHEN SQLSTATE 'P0007' THEN NULL;
  END;

  INSERT INTO learning_goals (user_id, domain_id, title, daily_minutes)
  SELECT 'a1000000-0000-4000-8000-000000000001', 'language', 'Cap ' || g, 10
    FROM generate_series(1, 100) g;
  SELECT count(*) INTO cap_count FROM learning_goals
   WHERE user_id = 'a1000000-0000-4000-8000-000000000001' AND status <> 'archived';
  ASSERT cap_count = 100;

  BEGIN
    PERFORM create_learning_goal('language', 'Over cap', 10, NULL, '{}'::jsonb, '{}'::jsonb);
    RAISE EXCEPTION 'expected create cap rejection';
  EXCEPTION WHEN SQLSTATE 'P0006' THEN NULL;
  END;
  BEGIN
    PERFORM update_learning_goal(goal_id, p_status => 'active');
    RAISE EXCEPTION 'expected unarchive cap rejection';
  EXCEPTION WHEN SQLSTATE 'P0006' THEN NULL;
  END;

  DELETE FROM learning_goals
   WHERE user_id = 'a1000000-0000-4000-8000-000000000001' AND title LIKE 'Cap %';
  PERFORM update_learning_goal(goal_id, p_status => 'active');
  ASSERT (SELECT status FROM learning_goals WHERE id = goal_id) = 'active';
END $$;

-- Plan item validation and explicit JSON-null payload normalization.
DO $$
DECLARE
  goal_id uuid := current_setting('learning_test.goal_id')::uuid;
  plan_result jsonb;
  v_plan_id uuid;
  plan_item_id uuid;
BEGIN
  BEGIN
    PERFORM save_daily_plan(
      goal_id, '2026-07-29', 'Asia/Seoul', 'daily-plan-v1', 'missing-reason', 20,
      jsonb_build_array(jsonb_build_object(
        'activity_id', 'a1400000-0000-4000-8000-000000000001',
        'card_id', 'a1300000-0000-4000-8000-000000000001',
        'activity_type', 'produce', 'stimulus_type', 'card',
        'response_type', 'text', 'evaluator_type', 'exact',
        'priority', 0.8, 'estimated_minutes', 2
      ))
    );
    RAISE EXCEPTION 'expected missing reason_code rejection';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;
  END;

  BEGIN
    PERFORM save_daily_plan(
      goal_id, '2026-07-29', 'Asia/Seoul', 'daily-plan-v1', 'bad-priority', 20,
      jsonb_build_array(jsonb_build_object(
        'activity_id', 'a1400000-0000-4000-8000-000000000001',
        'card_id', 'a1300000-0000-4000-8000-000000000001',
        'activity_type', 'produce', 'stimulus_type', 'card',
        'response_type', 'text', 'evaluator_type', 'exact', 'reason_code', 'due',
        'priority', 1.1, 'estimated_minutes', 2
      ))
    );
    RAISE EXCEPTION 'expected priority bound rejection';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;
  END;

  plan_result := save_daily_plan(
    goal_id, '2026-07-29', 'Asia/Seoul', 'daily-plan-v1', 'valid-plan', 20,
    jsonb_build_array(jsonb_build_object(
      'activity_id', 'a1400000-0000-4000-8000-000000000001',
      'card_id', 'a1300000-0000-4000-8000-000000000001',
      'activity_type', 'produce', 'stimulus_type', 'card',
      'response_type', 'text', 'evaluator_type', 'exact', 'reason_code', 'due',
      'priority', 0.8, 'estimated_minutes', 2, 'payload', NULL
    ))
  );
  v_plan_id := (plan_result->>'plan_id')::uuid;
  SELECT dpi.id INTO plan_item_id FROM daily_plan_items dpi WHERE dpi.plan_id = v_plan_id;
  PERFORM set_config('learning_test.plan_id', v_plan_id::text, true);
  PERFORM set_config('learning_test.plan_item_id', plan_item_id::text, true);
  ASSERT (SELECT payload FROM daily_plan_items WHERE id = plan_item_id) = '{}'::jsonb,
    'explicit null payload was not normalized';
END $$;

-- Plan snapshot mismatch, complete-payload attempt idempotency, and aggregate completion.
DO $$
DECLARE
  goal_id uuid := current_setting('learning_test.goal_id')::uuid;
  plan_id uuid := current_setting('learning_test.plan_id')::uuid;
  plan_item_id uuid := current_setting('learning_test.plan_item_id')::uuid;
  attempt_id uuid := 'a1600000-0000-4000-8000-000000000001';
  first_result jsonb;
  duplicate_result jsonb;
BEGIN
  BEGIN
    PERFORM record_answer_attempt(
      'a1600000-0000-4000-8000-000000000002',
      'produce', 'text', 'choice', '{"answer":"A"}'::jsonb,
      goal_id, 'a1400000-0000-4000-8000-000000000001',
      'a1300000-0000-4000-8000-000000000001', plan_item_id,
      0.9, '{"correct":true}'::jsonb, '{"message":"ok"}'::jsonb,
      0, 120000, 'exact-v1'
    );
    RAISE EXCEPTION 'expected plan snapshot mismatch';
  EXCEPTION WHEN SQLSTATE 'P0007' THEN NULL;
  END;

  first_result := record_answer_attempt(
    attempt_id,
    'produce', 'text', 'exact', '{"answer":"A"}'::jsonb,
    goal_id, 'a1400000-0000-4000-8000-000000000001',
    'a1300000-0000-4000-8000-000000000001', plan_item_id,
    0.9, '{"correct":true}'::jsonb, '{"message":"ok"}'::jsonb,
    0, 120000, 'exact-v1'
  );
  duplicate_result := record_answer_attempt(
    attempt_id,
    'produce', 'text', 'exact', '{"answer":"A"}'::jsonb,
    goal_id, 'a1400000-0000-4000-8000-000000000001',
    'a1300000-0000-4000-8000-000000000001', plan_item_id,
    0.9, '{"correct":true}'::jsonb, '{"message":"ok"}'::jsonb,
    0, 120000, 'exact-v1'
  );
  ASSERT (first_result->>'ok')::boolean;
  ASSERT (duplicate_result->>'idempotent')::boolean;
  ASSERT (SELECT count(*) FROM answer_attempts WHERE client_attempt_id = attempt_id) = 1,
    'duplicate attempt inserted another row';

  BEGIN
    PERFORM record_answer_attempt(
      attempt_id,
      'produce', 'text', 'exact', '{"answer":"A"}'::jsonb,
      goal_id, 'a1400000-0000-4000-8000-000000000001',
      'a1300000-0000-4000-8000-000000000001', plan_item_id,
      0.9, '{"correct":true}'::jsonb, '{"message":"changed"}'::jsonb,
      0, 120000, 'exact-v1'
    );
    RAISE EXCEPTION 'expected changed attempt payload rejection';
  EXCEPTION WHEN SQLSTATE 'P0007' THEN NULL;
  END;

  ASSERT (SELECT status FROM daily_plan_items WHERE id = plan_item_id) = 'completed';
  ASSERT (SELECT completion_attempt_id FROM daily_plan_items WHERE id = plan_item_id)
    = (first_result->>'attempt_id')::uuid;
  ASSERT (SELECT status FROM daily_plans WHERE id = plan_id) = 'completed';
  ASSERT (SELECT completed_items FROM daily_plans WHERE id = plan_id) = 1;
  ASSERT (SELECT completed_minutes FROM daily_plans WHERE id = plan_id) = 2;
END $$;

SELECT 'ALL_LEARNING_ENGINE_TESTS_PASSED' AS result;
ROLLBACK;

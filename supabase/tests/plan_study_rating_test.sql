-- apply_plan_study_rating (mig 187) and delete_learning_goal (mig 188).
--
-- The whole point of 187 is that ONE call moves both universes: the card's SRS state
-- (apply_study_rating's tables) and the plan item (record_answer_attempt's). Every
-- assertion below is about that pair holding together — including the failure case,
-- where a rejected schedule must leave the plan untouched rather than half-done.
\set ON_ERROR_STOP on
BEGIN;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id) VALUES
  ('b1000000-0000-4000-8000-000000000001'),
  ('b2000000-0000-4000-8000-000000000002')
ON CONFLICT (id) DO NOTHING;

INSERT INTO card_templates (id, user_id, name) VALUES
  ('b1100000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Plan study template');
INSERT INTO decks (id, user_id, name) VALUES
  ('b1200000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Plan study deck');
INSERT INTO cards (
  id, deck_id, user_id, template_id, sort_position, created_at,
  srs_status, interval_days, ease_factor, repetitions
) VALUES (
  'b1300000-0000-4000-8000-000000000001',
  'b1200000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  'b1100000-0000-4000-8000-000000000001',
  1, '2020-01-01T00:00:00Z', 'new', 0, 2.5, 0
);
SET LOCAL session_replication_role = origin;

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true);

-- ── the pair moves together ─────────────────────────────────────────────────
DO $$
DECLARE
  v_goal      uuid;
  v_plan      jsonb;
  v_plan_id   uuid;
  v_item_id   uuid;
  v_result    jsonb;
  v_card      cards%ROWTYPE;
  v_item      daily_plan_items%ROWTYPE;
  v_plan_row  daily_plans%ROWTYPE;
  v_attempts  integer;
  v_new_srs   jsonb := jsonb_build_object(
    'srs_status', 'review', 'ease_factor', 2.6, 'interval_days', 1,
    'repetitions', 1, 'next_review_at', '2026-08-07T00:00:00Z',
    'last_reviewed_at', '2026-08-06T00:00:00Z'
  );
BEGIN
  v_goal := (create_learning_goal('language', 'Plan study goal', 20)->>'goal_id')::uuid;
  PERFORM set_learning_goal_decks(v_goal, jsonb_build_array(
    jsonb_build_object('deck_id', 'b1200000-0000-4000-8000-000000000001', 'importance', 0.5)));

  v_plan := save_daily_plan(
    v_goal, '2026-08-06'::date, 'Asia/Seoul', 'daily-plan-v2', 'fnv1a32:test', 20,
    jsonb_build_array(jsonb_build_object(
      'card_id', 'b1300000-0000-4000-8000-000000000001',
      'activity_type', 'recall', 'stimulus_type', 'text',
      'response_type', 'self_rate', 'evaluator_type', 'self_rate',
      'reason_code', 'due', 'priority', 0.7, 'estimated_minutes', 0.5
    )));
  v_plan_id := (v_plan->>'plan_id')::uuid;
  SELECT id INTO v_item_id FROM daily_plan_items WHERE plan_id = v_plan_id;

  v_result := apply_plan_study_rating(
    p_event_id           => 'b1500000-0000-4000-8000-000000000001',
    p_client_session_id  => 'b1600000-0000-4000-8000-000000000001',
    p_card_id            => 'b1300000-0000-4000-8000-000000000001',
    p_deck_id            => 'b1200000-0000-4000-8000-000000000001',
    p_rating             => 'good',
    p_srs_source         => 'embedded',
    p_client_attempt_id  => 'b1700000-0000-4000-8000-000000000001',
    p_goal_id            => v_goal,
    p_plan_item_id       => v_item_id,
    p_activity_type      => 'recall',
    p_response_type      => 'self_rate',
    p_evaluator_type     => 'self_rate',
    p_expected_revision  => 0,
    p_new_srs            => v_new_srs,
    p_review_duration_ms => 90000
  );

  ASSERT v_result->>'ok' = 'true', v_result::text;
  ASSERT (v_result->>'normalized_score')::numeric = 1.0, v_result::text;

  -- half one: the card really moved
  SELECT * INTO v_card FROM cards WHERE id = 'b1300000-0000-4000-8000-000000000001';
  ASSERT v_card.srs_status = 'review', 'card was not rescheduled: ' || v_card.srs_status;
  ASSERT v_card.srs_revision = 1, 'revision did not advance';
  ASSERT EXISTS (SELECT 1 FROM study_logs WHERE card_id = v_card.id), 'no study log';

  -- half two: the plan item really completed
  SELECT * INTO v_item FROM daily_plan_items WHERE id = v_item_id;
  ASSERT v_item.status = 'completed', 'plan item still ' || v_item.status;
  ASSERT v_item.completion_attempt_id IS NOT NULL, 'no completion attempt recorded';

  SELECT * INTO v_plan_row FROM daily_plans WHERE id = v_plan_id;
  ASSERT v_plan_row.completed_items = 1, 'plan aggregate not moved';
  -- 90s of study. Both plan screens used to send 0, so this column had never been
  -- incremented in production at all.
  ASSERT v_plan_row.completed_minutes = 1,
    'completed_minutes was ' || v_plan_row.completed_minutes;

  SELECT count(*) INTO v_attempts FROM answer_attempts WHERE plan_item_id = v_item_id;
  ASSERT v_attempts = 1, 'expected exactly one attempt, got ' || v_attempts;

  -- ── a rejected schedule must not half-complete the plan ────────────────────
  -- Stale revision → apply_study_rating raises PT409. Because both halves run in one
  -- transaction, the plan item must be untouched by the attempt that never happened.
  BEGIN
    PERFORM apply_plan_study_rating(
      p_event_id           => 'b1500000-0000-4000-8000-000000000002',
      p_client_session_id  => 'b1600000-0000-4000-8000-000000000001',
      p_card_id            => 'b1300000-0000-4000-8000-000000000001',
      p_deck_id            => 'b1200000-0000-4000-8000-000000000001',
      p_rating             => 'again',
      p_srs_source         => 'embedded',
      p_client_attempt_id  => 'b1700000-0000-4000-8000-000000000002',
      p_goal_id            => v_goal,
      p_plan_item_id       => v_item_id,
      p_activity_type      => 'recall',
      p_response_type      => 'self_rate',
      p_evaluator_type     => 'self_rate',
      p_expected_revision  => 0,      -- stale: the row is at 1 now
      p_new_srs            => v_new_srs
    );
    RAISE EXCEPTION 'stale revision was accepted';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLSTATE = 'PT409', 'expected PT409, got ' || SQLSTATE || ' ' || SQLERRM;
  END;

  SELECT count(*) INTO v_attempts
    FROM answer_attempts WHERE client_attempt_id = 'b1700000-0000-4000-8000-000000000002';
  ASSERT v_attempts = 0, 'a rejected rating still wrote an attempt';

  -- ── only the four SRS ratings ──────────────────────────────────────────────
  -- A `next`/`viewed` action carries no judgement, and the other five study modes move
  -- no schedule at all — completing a plan item from one would mark the day done while
  -- leaving every planner input untouched.
  BEGIN
    PERFORM apply_plan_study_rating(
      p_event_id           => 'b1500000-0000-4000-8000-000000000003',
      p_client_session_id  => 'b1600000-0000-4000-8000-000000000001',
      p_card_id            => 'b1300000-0000-4000-8000-000000000001',
      p_deck_id            => 'b1200000-0000-4000-8000-000000000001',
      p_rating             => 'next',
      p_srs_source         => 'embedded',
      p_client_attempt_id  => 'b1700000-0000-4000-8000-000000000003',
      p_goal_id            => v_goal,
      p_plan_item_id       => v_item_id,
      p_activity_type      => 'recall',
      p_response_type      => 'self_rate',
      p_evaluator_type     => 'self_rate'
    );
    RAISE EXCEPTION 'a non-SRS rating was accepted';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLSTATE = '22023', 'expected 22023, got ' || SQLSTATE || ' ' || SQLERRM;
  END;

  RAISE NOTICE 'apply_plan_study_rating: all assertions passed';
END $$;

-- ── undoing a plan rating unwinds BOTH halves (mig 189) ─────────────────────
--
-- The hole 187 left open, found by pressing 되돌리기 on a real database: the card went
-- back to its old schedule while the plan kept saying the item was done, and the item
-- could never be completed again.
DO $$
DECLARE
  v_goal     uuid;
  v_plan_id  uuid;
  v_item_id  uuid;
  v_card     cards%ROWTYPE;
  v_before   cards%ROWTYPE;
  v_item     daily_plan_items%ROWTYPE;
  v_plan_row daily_plans%ROWTYPE;
  v_left     integer;
  v_new_srs  jsonb := jsonb_build_object(
    'srs_status', 'review', 'ease_factor', 2.6, 'interval_days', 1,
    'repetitions', 1, 'next_review_at', '2026-08-09T00:00:00Z',
    'last_reviewed_at', '2026-08-08T00:00:00Z'
  );
BEGIN
  v_goal := (create_learning_goal('language', 'Undo goal', 20)->>'goal_id')::uuid;
  PERFORM set_learning_goal_decks(v_goal, jsonb_build_array(
    jsonb_build_object('deck_id', 'b1200000-0000-4000-8000-000000000001', 'importance', 0.5)));
  v_plan_id := (save_daily_plan(
    v_goal, '2026-08-08'::date, 'Asia/Seoul', 'daily-plan-v2', 'fnv1a32:undo', 20,
    jsonb_build_array(jsonb_build_object(
      'card_id', 'b1300000-0000-4000-8000-000000000001',
      'activity_type', 'recall', 'stimulus_type', 'text',
      'response_type', 'self_rate', 'evaluator_type', 'self_rate',
      'reason_code', 'due'
    )))->>'plan_id')::uuid;
  SELECT id INTO v_item_id FROM daily_plan_items WHERE plan_id = v_plan_id;

  -- Snapshot the exact state to restore to. The card has already been rated by the block
  -- above, so "not review" is not the test — "identical to what it was" is.
  SELECT * INTO v_before FROM cards WHERE id = 'b1300000-0000-4000-8000-000000000001';
  v_left := v_before.srs_revision;
  PERFORM apply_plan_study_rating(
    p_event_id           => 'b1500000-0000-4000-8000-000000000011',
    p_client_session_id  => 'b1600000-0000-4000-8000-000000000011',
    p_card_id            => 'b1300000-0000-4000-8000-000000000001',
    p_deck_id            => 'b1200000-0000-4000-8000-000000000001',
    p_rating             => 'good',
    p_srs_source         => 'embedded',
    p_client_attempt_id  => 'b1700000-0000-4000-8000-000000000011',
    p_goal_id            => v_goal,
    p_plan_item_id       => v_item_id,
    p_activity_type      => 'recall',
    p_response_type      => 'self_rate',
    p_evaluator_type     => 'self_rate',
    p_expected_revision  => v_left,
    p_new_srs            => v_new_srs,
    p_review_duration_ms => 120000
  );

  SELECT * INTO v_plan_row FROM daily_plans WHERE id = v_plan_id;
  ASSERT v_plan_row.completed_items = 1, 'setup: item did not complete';
  ASSERT v_plan_row.completed_minutes = 2, 'setup: minutes did not move';

  PERFORM undo_plan_study_rating(
    'b1500000-0000-4000-8000-000000000011', 'b1700000-0000-4000-8000-000000000011');

  -- half one: the card is back where it was
  SELECT * INTO v_card FROM cards WHERE id = 'b1300000-0000-4000-8000-000000000001';
  ASSERT v_card.srs_status = v_before.srs_status
     AND v_card.interval_days = v_before.interval_days
     AND v_card.repetitions = v_before.repetitions
     AND v_card.next_review_at IS NOT DISTINCT FROM v_before.next_review_at,
    'card was not rolled back: ' || v_card.srs_status || '/' || v_card.repetitions
      || ' (was ' || v_before.srs_status || '/' || v_before.repetitions || ')';

  -- half two: so is the plan. THIS is what was broken.
  SELECT * INTO v_item FROM daily_plan_items WHERE id = v_item_id;
  ASSERT v_item.status = 'pending', 'plan item stayed ' || v_item.status || ' after undo';
  ASSERT v_item.completion_attempt_id IS NULL, 'completion_attempt_id survived the undo';

  SELECT * INTO v_plan_row FROM daily_plans WHERE id = v_plan_id;
  ASSERT v_plan_row.completed_items = 0,
    'completed_items stayed ' || v_plan_row.completed_items;
  ASSERT v_plan_row.completed_minutes = 0,
    'completed_minutes stayed ' || v_plan_row.completed_minutes;
  ASSERT v_plan_row.status = 'pending', 'plan status stayed ' || v_plan_row.status;

  -- the retracted answer leaves no record to quote back at the learner
  SELECT count(*) INTO v_left FROM answer_attempts
   WHERE client_attempt_id = 'b1700000-0000-4000-8000-000000000011';
  ASSERT v_left = 0, 'the retracted attempt survived';

  -- and the item is completable again, which it was not before this fix
  SELECT srs_revision INTO v_left FROM cards WHERE id = 'b1300000-0000-4000-8000-000000000001';
  PERFORM apply_plan_study_rating(
    p_event_id           => 'b1500000-0000-4000-8000-000000000012',
    p_client_session_id  => 'b1600000-0000-4000-8000-000000000011',
    p_card_id            => 'b1300000-0000-4000-8000-000000000001',
    p_deck_id            => 'b1200000-0000-4000-8000-000000000001',
    p_rating             => 'again',
    p_srs_source         => 'embedded',
    p_client_attempt_id  => 'b1700000-0000-4000-8000-000000000012',
    p_goal_id            => v_goal,
    p_plan_item_id       => v_item_id,
    p_activity_type      => 'recall',
    p_response_type      => 'self_rate',
    p_evaluator_type     => 'self_rate',
    p_expected_revision  => v_left,
    p_new_srs            => v_new_srs
  );
  SELECT * INTO v_plan_row FROM daily_plans WHERE id = v_plan_id;
  ASSERT v_plan_row.completed_items = 1, 're-rating after an undo did not complete the item';

  RAISE NOTICE 'undo_plan_study_rating: all assertions passed';
END $$;

-- ── delete_learning_goal ────────────────────────────────────────────────────
DO $$
DECLARE
  v_goal     uuid;
  v_plan_id  uuid;
  v_attempt  uuid;
  v_left     integer;
BEGIN
  v_goal := (create_learning_goal('language', 'Doomed goal', 20)->>'goal_id')::uuid;
  PERFORM set_learning_goal_decks(v_goal, jsonb_build_array(
    jsonb_build_object('deck_id', 'b1200000-0000-4000-8000-000000000001', 'importance', 0.5)));
  v_plan_id := (save_daily_plan(
    v_goal, '2026-08-07'::date, 'Asia/Seoul', 'daily-plan-v2', 'fnv1a32:doomed', 20,
    jsonb_build_array(jsonb_build_object(
      'card_id', 'b1300000-0000-4000-8000-000000000001',
      'activity_type', 'recall', 'stimulus_type', 'text',
      'response_type', 'self_rate', 'evaluator_type', 'self_rate',
      'reason_code', 'due'
    )))->>'plan_id')::uuid;

  v_attempt := (record_answer_attempt(
    p_client_attempt_id => 'b1700000-0000-4000-8000-000000000009',
    p_activity_type     => 'recall',
    p_response_type     => 'self_rate',
    p_evaluator_type    => 'self_rate',
    p_goal_id           => v_goal,
    p_card_id           => 'b1300000-0000-4000-8000-000000000001',
    p_normalized_score  => 1
  )->>'attempt_id')::uuid;

  PERFORM delete_learning_goal(v_goal);

  SELECT count(*) INTO v_left FROM learning_goals WHERE id = v_goal;
  ASSERT v_left = 0, 'goal survived the delete';
  SELECT count(*) INTO v_left FROM daily_plans WHERE id = v_plan_id;
  ASSERT v_left = 0, 'daily plan did not cascade';
  SELECT count(*) INTO v_left FROM daily_plan_items WHERE plan_id = v_plan_id;
  ASSERT v_left = 0, 'plan items did not cascade';
  SELECT count(*) INTO v_left FROM learning_goal_decks WHERE goal_id = v_goal;
  ASSERT v_left = 0, 'deck links did not cascade';

  -- The study record SURVIVES, detached. The card really was reviewed, and its SRS
  -- state rests on this row; deleting a plan is not a claim that the study did not happen.
  SELECT count(*) INTO v_left
    FROM answer_attempts WHERE id = v_attempt AND goal_id IS NULL;
  ASSERT v_left = 1, 'the attempt was destroyed instead of detached';

  -- Not found and not owned answer the same, so the RPC is not an existence oracle.
  BEGIN
    PERFORM delete_learning_goal(v_goal);
    RAISE EXCEPTION 'deleting a missing goal succeeded';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLSTATE = 'P0003', 'expected P0003, got ' || SQLSTATE;
  END;

  RAISE NOTICE 'delete_learning_goal: all assertions passed';
END $$;

-- Another user's goal is not deletable, and reports as not-found.
DO $$
DECLARE
  v_goal uuid;
BEGIN
  v_goal := (create_learning_goal('language', 'Mine', 20)->>'goal_id')::uuid;
  PERFORM set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000002', true);
  BEGIN
    PERFORM delete_learning_goal(v_goal);
    RAISE EXCEPTION 'another user deleted a goal that was not theirs';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLSTATE = 'P0003', 'expected P0003, got ' || SQLSTATE;
  END;
  PERFORM set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true);
  ASSERT EXISTS (SELECT 1 FROM learning_goals WHERE id = v_goal), 'the goal was removed anyway';
  RAISE NOTICE 'delete_learning_goal ownership: passed';
END $$;

ROLLBACK;

-- Migration 204: studying a card finishes its plan item even when the caller never
-- mentions the plan.
--
-- This is the half that 187 could not reach. 187 requires the client to NAME the plan
-- item, which only happens when the study screen was opened from the plan; a learner who
-- opens the same card from their deck list took the plain `apply_study_rating` path and
-- left the day pending forever. The consequences were not cosmetic — adherence read ~0%
-- and the projected finish date moved further away the more the learner studied — so the
-- assertions below are about the plan and the schedule agreeing no matter which door the
-- learner came through.
--
-- The four refusals matter as much as the completion. An SRS rating is the learner's own
-- word; it may finish a self-rated item and nothing else.
\set ON_ERROR_STOP on
BEGIN;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id) VALUES
  ('c1000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

INSERT INTO card_templates (id, user_id, name) VALUES
  ('c1100000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'Any-study template');
INSERT INTO decks (id, user_id, name) VALUES
  ('c1200000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'Any-study deck');
INSERT INTO cards (
  id, deck_id, user_id, template_id, sort_position, created_at,
  srs_status, interval_days, ease_factor, repetitions
) VALUES
  ('c1300000-0000-4000-8000-000000000001', 'c1200000-0000-4000-8000-000000000001',
   'c1000000-0000-4000-8000-000000000001', 'c1100000-0000-4000-8000-000000000001',
   1, '2020-01-01T00:00:00Z', 'new', 0, 2.5, 0),
  ('c1300000-0000-4000-8000-000000000002', 'c1200000-0000-4000-8000-000000000001',
   'c1000000-0000-4000-8000-000000000001', 'c1100000-0000-4000-8000-000000000001',
   2, '2020-01-01T00:00:00Z', 'new', 0, 2.5, 0),
  ('c1300000-0000-4000-8000-000000000003', 'c1200000-0000-4000-8000-000000000001',
   'c1000000-0000-4000-8000-000000000001', 'c1100000-0000-4000-8000-000000000001',
   3, '2020-01-01T00:00:00Z', 'new', 0, 2.5, 0);
SET LOCAL session_replication_role = origin;

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000001', true);

DO $$
DECLARE
  v_goal     uuid;
  v_plan     jsonb;
  v_plan_id  uuid;
  v_item1    uuid;   -- self_rate  → completable
  v_item2    uuid;   -- ai grader  → must NOT be completed by a self-rating
  v_item3    uuid;   -- self_rate  → used for the non-SRS-mode refusal
  v_res      jsonb;
  v_item     daily_plan_items%ROWTYPE;
  v_plan_row daily_plans%ROWTYPE;
  v_attempts integer;
  -- The learner's own day. The resolver compares `plan_date` against now() in the plan's
  -- timezone, so a hardcoded date would pass or fail depending on when the suite runs.
  v_today    date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_new_srs  jsonb := jsonb_build_object(
    'srs_status', 'review', 'ease_factor', 2.6, 'interval_days', 1,
    'repetitions', 1,
    'next_review_at', (now() + interval '1 day')::text,
    'last_reviewed_at', now()::text);
BEGIN
  v_goal := (create_learning_goal('language', 'Any-study goal', 20)->>'goal_id')::uuid;
  PERFORM set_learning_goal_decks(v_goal, jsonb_build_array(
    jsonb_build_object('deck_id', 'c1200000-0000-4000-8000-000000000001', 'importance', 0.5)));

  v_plan := save_daily_plan(
    v_goal, v_today, 'Asia/Seoul', 'daily-plan-v2', 'fnv1a32:any', 20,
    jsonb_build_array(
      jsonb_build_object(
        'card_id', 'c1300000-0000-4000-8000-000000000001',
        'activity_type', 'recall', 'stimulus_type', 'text',
        'response_type', 'self_rate', 'evaluator_type', 'self_rate',
        'reason_code', 'due', 'priority', 0.7, 'estimated_minutes', 0.5),
      jsonb_build_object(
        'card_id', 'c1300000-0000-4000-8000-000000000002',
        'activity_type', 'recall', 'stimulus_type', 'text',
        -- A typed answer judged by a grader. Nothing a self-rating says can settle it.
        'response_type', 'text', 'evaluator_type', 'ai',
        'reason_code', 'due', 'priority', 0.6, 'estimated_minutes', 0.5),
      jsonb_build_object(
        'card_id', 'c1300000-0000-4000-8000-000000000003',
        'activity_type', 'recall', 'stimulus_type', 'text',
        'response_type', 'self_rate', 'evaluator_type', 'self_rate',
        'reason_code', 'due', 'priority', 0.5, 'estimated_minutes', 0.5)));
  v_plan_id := (v_plan->>'plan_id')::uuid;

  SELECT id INTO v_item1 FROM daily_plan_items
   WHERE plan_id = v_plan_id AND card_id = 'c1300000-0000-4000-8000-000000000001';
  SELECT id INTO v_item2 FROM daily_plan_items
   WHERE plan_id = v_plan_id AND card_id = 'c1300000-0000-4000-8000-000000000002';
  SELECT id INTO v_item3 FROM daily_plan_items
   WHERE plan_id = v_plan_id AND card_id = 'c1300000-0000-4000-8000-000000000003';

  -- ── 1) THE CHECK THIS FILE EXISTS FOR ────────────────────────────────────
  -- A plain deck-study rating. No goal id, no plan item id, no plan date — exactly what
  -- `study-store` sends when `config.planSelection` is absent.
  v_res := apply_study_rating(
    p_event_id           => 'c1500000-0000-4000-8000-000000000001',
    p_client_session_id  => 'c1600000-0000-4000-8000-000000000001',
    p_card_id            => 'c1300000-0000-4000-8000-000000000001',
    p_deck_id            => 'c1200000-0000-4000-8000-000000000001',
    p_study_mode         => 'srs',
    p_rating             => 'good',
    p_srs_source         => 'embedded',
    p_expected_revision  => 0,
    p_new_srs            => v_new_srs,
    p_review_duration_ms => 90000);   -- 1.5 min: completed_minutes is integer ms/60000

  SELECT * INTO v_item FROM daily_plan_items WHERE id = v_item1;
  IF v_item.status <> 'completed' THEN
    RAISE EXCEPTION 'FAIL: deck-study left the plan item %', v_item.status;
  END IF;
  IF (v_res->>'completed_plan_item_id')::uuid IS DISTINCT FROM v_item1 THEN
    RAISE EXCEPTION 'FAIL: the caller was not told which item was completed: %', v_res;
  END IF;

  -- The aggregates move too, or the plan screen still shows a full day.
  SELECT * INTO v_plan_row FROM daily_plans WHERE id = v_plan_id;
  IF v_plan_row.completed_items <> 1 THEN
    RAISE EXCEPTION 'FAIL: completed_items is %', v_plan_row.completed_items;
  END IF;
  -- 187's other complaint: both plan screens sent 0, so completed_minutes had never been
  -- incremented in production. Note the aggregate is integer `ms / 60000`, so a card under
  -- a minute still contributes nothing — that truncation is pre-existing and shared with the
  -- plan path, which is why this uses a 1.5-minute card rather than papering over it.
  IF v_plan_row.completed_minutes <= 0 THEN
    RAISE EXCEPTION 'FAIL: completed_minutes did not move (%)', v_plan_row.completed_minutes;
  END IF;

  -- And an attempt exists carrying the learner's own rating, not an invented score.
  SELECT count(*) INTO v_attempts FROM answer_attempts WHERE plan_item_id = v_item1;
  IF v_attempts <> 1 THEN RAISE EXCEPTION 'FAIL: % attempts for the item', v_attempts; END IF;
  IF NOT EXISTS (SELECT 1 FROM answer_attempts
                  WHERE plan_item_id = v_item1
                    AND normalized_score = 1.0
                    AND response->>'srs_rating' = 'good') THEN
    RAISE EXCEPTION 'FAIL: the attempt does not carry the rating that produced it';
  END IF;

  -- ── 2) Re-rating the same card does not complete it twice ────────────────
  BEGIN
    PERFORM apply_study_rating(
      p_event_id           => 'c1500000-0000-4000-8000-000000000009',
      p_client_session_id  => 'c1600000-0000-4000-8000-000000000001',
      p_card_id            => 'c1300000-0000-4000-8000-000000000001',
      p_deck_id            => 'c1200000-0000-4000-8000-000000000001',
      p_study_mode         => 'srs',
      p_rating             => 'easy',
      p_srs_source         => 'embedded',
      p_expected_revision  => 0,
      p_new_srs            => v_new_srs,
      p_review_duration_ms => 1000);
  EXCEPTION WHEN others THEN NULL;  -- a stale revision is fine; the count below is the point
  END;
  SELECT count(*) INTO v_attempts FROM answer_attempts WHERE plan_item_id = v_item1;
  IF v_attempts <> 1 THEN
    RAISE EXCEPTION 'FAIL: a second rating recorded another attempt (%)', v_attempts;
  END IF;

  -- ── 3) A self-rating may not settle an AI-graded item ────────────────────
  PERFORM apply_study_rating(
    p_event_id           => 'c1500000-0000-4000-8000-000000000002',
    p_client_session_id  => 'c1600000-0000-4000-8000-000000000001',
    p_card_id            => 'c1300000-0000-4000-8000-000000000002',
    p_deck_id            => 'c1200000-0000-4000-8000-000000000001',
    p_study_mode         => 'srs',
    p_rating             => 'good',
    p_srs_source         => 'embedded',
    p_expected_revision  => 0,
    p_new_srs            => v_new_srs,
    p_review_duration_ms => 3000);

  SELECT * INTO v_item FROM daily_plan_items WHERE id = v_item2;
  IF v_item.status <> 'pending' THEN
    RAISE EXCEPTION 'FAIL: "I knew it" closed an AI-graded item (%)', v_item.status;
  END IF;

  -- ── 4) A mode that moves no schedule completes no day ────────────────────
  PERFORM apply_study_rating(
    p_event_id           => 'c1500000-0000-4000-8000-000000000003',
    p_client_session_id  => 'c1600000-0000-4000-8000-000000000002',
    p_card_id            => 'c1300000-0000-4000-8000-000000000003',
    p_deck_id            => 'c1200000-0000-4000-8000-000000000001',
    p_study_mode         => 'random',
    p_rating             => 'next',
    p_srs_source         => 'none',
    p_new_srs            => NULL,
    p_review_duration_ms => 900);

  SELECT * INTO v_item FROM daily_plan_items WHERE id = v_item3;
  IF v_item.status <> 'pending' THEN
    RAISE EXCEPTION 'FAIL: a browse-mode rating completed a plan item (%)', v_item.status;
  END IF;

  -- ── 5) The plan path still completes exactly once ────────────────────────
  -- `apply_plan_study_rating` names the item AND calls record_answer_attempt itself, so
  -- it tells the rating to stand down. If that flag were lost the item would be completed
  -- twice and two attempts would exist for one rating.
  PERFORM apply_plan_study_rating(
    p_event_id           => 'c1500000-0000-4000-8000-000000000004',
    p_client_session_id  => 'c1600000-0000-4000-8000-000000000003',
    p_card_id            => 'c1300000-0000-4000-8000-000000000003',
    p_deck_id            => 'c1200000-0000-4000-8000-000000000001',
    p_rating             => 'good',
    p_srs_source         => 'embedded',
    p_expected_revision  => 0,
    p_client_attempt_id  => 'c1700000-0000-4000-8000-000000000004',
    p_goal_id            => v_goal,
    p_plan_item_id       => v_item3,
    p_activity_type      => 'recall',
    p_response_type      => 'self_rate',
    p_evaluator_type     => 'self_rate',
    p_new_srs            => v_new_srs,
    p_review_duration_ms => 2000);

  SELECT count(*) INTO v_attempts FROM answer_attempts WHERE plan_item_id = v_item3;
  IF v_attempts <> 1 THEN
    RAISE EXCEPTION 'FAIL: the plan path recorded % attempts for one rating', v_attempts;
  END IF;
  SELECT * INTO v_item FROM daily_plan_items WHERE id = v_item3;
  IF v_item.status <> 'completed' THEN
    RAISE EXCEPTION 'FAIL: the plan path stopped completing its own item (%)', v_item.status;
  END IF;

  RAISE NOTICE 'plan_completes_from_any_study_test: all assertions passed';
END;
$$;

ROLLBACK;

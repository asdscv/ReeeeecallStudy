-- Migration 206: the plan coach's server half.
--
-- Two things are being protected here.
--
-- The first is the digest. It is the ONLY input the chooser sees, and a future model will be
-- handed the same numbers — so if it counts a day wrong, both producers are wrong in the same
-- invisible way, and the learner is told to change something on evidence that never happened.
--
-- The second is the relaxation. `set_study_recommendations` required every row to name a
-- card, a concept or an activity; a plan-level suggestion names none of them. That rule is now
-- relaxed for lever ids ONLY, and the test that matters is the one proving it is still a
-- closed door for anything else — otherwise 206 quietly turned a validated writer into an
-- open one.
\set ON_ERROR_STOP on
BEGIN;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id) VALUES
  ('e1000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;
INSERT INTO card_templates (id, user_id, name) VALUES
  ('e1100000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'Coach template');
INSERT INTO decks (id, user_id, name) VALUES
  ('e1200000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'Coach deck');
INSERT INTO cards (id, deck_id, user_id, template_id, sort_position, created_at) VALUES
  ('e1300000-0000-4000-8000-000000000001', 'e1200000-0000-4000-8000-000000000001',
   'e1000000-0000-4000-8000-000000000001', 'e1100000-0000-4000-8000-000000000001', 1, now());
SET LOCAL session_replication_role = origin;

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);

DO $$
DECLARE
  v_goal  uuid;
  v_dig   jsonb;
  v_tz    text := 'Asia/Seoul';
  v_today date;
  d       integer;
BEGIN
  v_goal := (create_learning_goal('language', 'Coach goal', 20)->>'goal_id')::uuid;
  PERFORM set_learning_goal_decks(v_goal, jsonb_build_array(
    jsonb_build_object('deck_id', 'e1200000-0000-4000-8000-000000000001', 'importance', 0.5)));
  v_today := public._local_date(now(), v_tz);

  -- Six days of plans: three finished, two started-and-stopped, one never opened. Written
  -- straight to the aggregates, because the digest reads THOSE — going through the study
  -- path would test the study path instead.
  FOR d IN 1..6 LOOP
    PERFORM save_daily_plan(
      v_goal, v_today - d, v_tz, 'daily-plan-v2', 'fnv1a32:coach' || d, 20,
      jsonb_build_array(jsonb_build_object(
        'card_id', 'e1300000-0000-4000-8000-000000000001',
        'activity_type', 'recall', 'stimulus_type', 'text',
        'response_type', 'self_rate', 'evaluator_type', 'self_rate',
        'reason_code', 'due', 'priority', 0.5, 'estimated_minutes', 1)));
  END LOOP;

  UPDATE daily_plans SET total_items = 10, completed_items = 10
   WHERE goal_id = v_goal AND plan_date >= v_today - 3;             -- 3 finished
  UPDATE daily_plans SET total_items = 10, completed_items = 4
   WHERE goal_id = v_goal AND plan_date IN (v_today - 4, v_today - 5);  -- 2 partial
  UPDATE daily_plans SET total_items = 10, completed_items = 0
   WHERE goal_id = v_goal AND plan_date = v_today - 6;              -- 1 untouched

  -- ── 1) The digest counts the week the way a learner would ────────────────
  v_dig := get_plan_digest(v_goal, v_tz, 7);
  IF (v_dig->>'plans')::int <> 6 THEN
    RAISE EXCEPTION 'FAIL: digest saw % plans', v_dig->>'plans';
  END IF;
  IF (v_dig->>'days_finished')::int <> 3 THEN
    RAISE EXCEPTION 'FAIL: days_finished is %', v_dig->>'days_finished';
  END IF;
  IF (v_dig->>'days_partial')::int <> 2 THEN
    RAISE EXCEPTION 'FAIL: days_partial is %', v_dig->>'days_partial';
  END IF;
  IF (v_dig->>'days_untouched')::int <> 1 THEN
    RAISE EXCEPTION 'FAIL: days_untouched is %', v_dig->>'days_untouched';
  END IF;
  IF (v_dig->>'items_planned')::int <> 60 OR (v_dig->>'items_done')::int <> 38 THEN
    RAISE EXCEPTION 'FAIL: totals are %/%', v_dig->>'items_done', v_dig->>'items_planned';
  END IF;
  -- The learner's current settings travel with it, so the chooser can refuse a lever that is
  -- already at its floor instead of proposing a change that does nothing.
  IF (v_dig->>'daily_minutes')::int <> 20 THEN
    RAISE EXCEPTION 'FAIL: daily_minutes missing from the digest (%)', v_dig;
  END IF;

  -- A plan outside the window must not be counted; the coach speaks about THIS week.
  PERFORM save_daily_plan(
    v_goal, v_today - 20, v_tz, 'daily-plan-v2', 'fnv1a32:old', 20,
    jsonb_build_array(jsonb_build_object(
      'card_id', 'e1300000-0000-4000-8000-000000000001',
      'activity_type', 'recall', 'stimulus_type', 'text',
      'response_type', 'self_rate', 'evaluator_type', 'self_rate',
      'reason_code', 'due', 'priority', 0.5, 'estimated_minutes', 1)));
  IF (get_plan_digest(v_goal, v_tz, 7)->>'plans')::int <> 6 THEN
    RAISE EXCEPTION 'FAIL: a plan from three weeks ago entered the window';
  END IF;

  -- ── 2) A plan-level suggestion may name no card ──────────────────────────
  PERFORM set_study_recommendations(
    v_goal,
    jsonb_build_array(jsonb_build_object(
      'action_type', 'lower_intake',
      'reason', '3/7 finished',
      'payload', jsonb_build_object('value', 6))),
    'algorithm', 'plan-coach-v1');

  IF NOT EXISTS (SELECT 1 FROM study_recommendations
                  WHERE goal_id = v_goal AND action_type = 'lower_intake'
                    AND card_id IS NULL AND status = 'pending'
                    AND (payload->>'value')::int = 6) THEN
    RAISE EXCEPTION 'FAIL: the plan-level suggestion was not stored';
  END IF;

  -- ── 3) THE CHECK THIS RELAXATION NEEDS ───────────────────────────────────
  -- Only a LEVER may go untargeted. Anything else without a card is still refused, or 206
  -- turned a validated writer into an open one.
  BEGIN
    PERFORM set_study_recommendations(
      v_goal,
      jsonb_build_array(jsonb_build_object('action_type', 'review_card')),
      'algorithm', 'plan-coach-v1');
    RAISE EXCEPTION 'FAIL: an untargeted card recommendation was accepted';
  EXCEPTION WHEN sqlstate 'P0002' THEN NULL;
  END;
  BEGIN
    PERFORM set_study_recommendations(
      v_goal,
      jsonb_build_array(jsonb_build_object('action_type', 'not_a_lever')),
      'algorithm', 'plan-coach-v1');
    RAISE EXCEPTION 'FAIL: an unknown untargeted action was accepted';
  EXCEPTION WHEN sqlstate 'P0002' THEN NULL;
  END;

  -- ── 4) An answered suggestion survives the next regeneration ─────────────
  -- The whole reason the table keeps accepted/dismissed rows: a coach that re-asks a
  -- question the learner already answered is worse than one that never asks.
  UPDATE study_recommendations SET status = 'dismissed'
   WHERE goal_id = v_goal AND action_type = 'lower_intake';
  PERFORM set_study_recommendations(
    v_goal,
    jsonb_build_array(jsonb_build_object('action_type', 'hold')),
    'algorithm', 'plan-coach-v1');
  IF NOT EXISTS (SELECT 1 FROM study_recommendations
                  WHERE goal_id = v_goal AND action_type = 'lower_intake'
                    AND status = 'dismissed') THEN
    RAISE EXCEPTION 'FAIL: regeneration erased a decision the learner had made';
  END IF;

  -- ── 5) The levers are readable, and are rows ─────────────────────────────
  IF jsonb_array_length(get_learning_plan_levers()) < 6 THEN
    RAISE EXCEPTION 'FAIL: lever list is %', get_learning_plan_levers();
  END IF;

  RAISE NOTICE 'plan_coach_test: all assertions passed';
END;
$$;

ROLLBACK;

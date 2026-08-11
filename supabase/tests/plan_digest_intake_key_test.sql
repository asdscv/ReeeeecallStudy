-- Migration 213: the coach can finally see the learner's intake.
--
-- `get_plan_digest` reported `new_cards_per_day` from `settings->>'new_cards_per_day'`. No
-- writer has ever used that key — both goal forms and `parseNewCardsPerDay` use
-- `newCardsPerDay` — so the projection was NULL for every goal that has ever existed, and the
-- two levers whose dial is `new_cards_per_day` (`lower_intake`, `raise_intake`) could never
-- fire. Checked against production before the fix: three goals, zero with either key set.
--
-- Pinned here:
--
--   1) The camelCase key every client actually writes reaches the digest.
--   2) A legacy snake_case value still reaches it, so nobody has to re-save a goal.
--   3) A goal with neither still reports NULL, which is what lets the chooser tell "at the
--      floor" apart from "never configured".
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id) VALUES
  ('c9000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', 'c9000000-0000-4000-8000-000000000001', false);

DO $$
DECLARE
  v_uid uuid := 'c9000000-0000-4000-8000-000000000001';
  v_camel uuid; v_snake uuid; v_none uuid;
  v_digest jsonb;
BEGIN
  INSERT INTO learning_goals (user_id, domain_id, title, daily_minutes, settings)
    VALUES (v_uid, 'language', 'Camel', 20, '{"newCardsPerDay": 7, "cadence": {"studyDays": 7, "cycleDays": 7}}'::jsonb)
    RETURNING id INTO v_camel;
  INSERT INTO learning_goals (user_id, domain_id, title, daily_minutes, settings)
    VALUES (v_uid, 'language', 'Snake', 20, '{"new_cards_per_day": 3}'::jsonb)
    RETURNING id INTO v_snake;
  INSERT INTO learning_goals (user_id, domain_id, title, daily_minutes, settings)
    VALUES (v_uid, 'language', 'Neither', 20, '{}'::jsonb)
    RETURNING id INTO v_none;

  -- (1) The spelling every client writes. This is the one that was broken.
  v_digest := get_plan_digest(v_camel, 'UTC', 7);
  ASSERT (v_digest->>'new_cards_per_day')::int = 7,
    format('FAIL: the coach cannot see the intake every client writes: %s', v_digest->>'new_cards_per_day');

  -- (2) A legacy value must not be dropped by the fix.
  v_digest := get_plan_digest(v_snake, 'UTC', 7);
  ASSERT (v_digest->>'new_cards_per_day')::int = 3,
    format('FAIL: a legacy snake_case intake was lost: %s', v_digest->>'new_cards_per_day');

  -- (3) Absent stays absent. "Never configured" is a different answer from "set to zero", and
  -- the lever chooser needs to tell them apart.
  v_digest := get_plan_digest(v_none, 'UTC', 7);
  ASSERT v_digest->>'new_cards_per_day' IS NULL,
    format('FAIL: an unconfigured goal reported an intake: %s', v_digest->>'new_cards_per_day');

  RAISE NOTICE 'plan_digest_intake_key_test: all assertions passed';
END $$;

ROLLBACK;

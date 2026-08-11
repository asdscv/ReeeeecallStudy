-- Migration 209: the week strip's data, and the check's widened window.
--
-- What is actually at risk here is the ONE thing this change exists to fix. Both features
-- were invisible because they were correct-but-silent, and the failure mode of a fix for
-- that is a feature that is visible but WRONG — a strip that shows a day the learner did not
-- study as studied, or a check that offers cards it then refuses to build.
--
-- So the assertions are:
--   1) `by_day` has one cell per day, always, including days with no plan row.
--   2) Study done OUTSIDE a plan still lands on its day — that is most study, and the
--      plan-only aggregate is blind to it.
--   3) The counter and the builder agree. If the counter says there is a check, building it
--      must not raise.
--   4) Today still WINS. The fallback must never replace a real today.
\set ON_ERROR_STOP on
BEGIN;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id) VALUES
  ('f2000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;
INSERT INTO card_templates (id, user_id, name, fields, front_layout, back_layout) VALUES (
  'f2100000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'Week template',
  '[{"key":"word","type":"text"},{"key":"meaning","type":"text"}]'::jsonb,
  '[{"field_key":"word","style":"primary"}]'::jsonb,
  '[{"field_key":"meaning","style":"primary"}]'::jsonb);
INSERT INTO decks (id, user_id, name) VALUES
  ('f2200000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'Week deck');
INSERT INTO cards (id, deck_id, user_id, template_id, sort_position, field_values, created_at)
SELECT ('f230000' || n || '-0000-4000-8000-000000000001')::uuid,
       'f2200000-0000-4000-8000-000000000001',
       'f2000000-0000-4000-8000-000000000001',
       'f2100000-0000-4000-8000-000000000001', n,
       jsonb_build_object('word', 'Q' || n, 'meaning', 'A' || n), now()
  FROM generate_series(1, 5) AS n;
SET LOCAL session_replication_role = origin;

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'f2000000-0000-4000-8000-000000000001', true);

DO $$
DECLARE
  v_uid   uuid := 'f2000000-0000-4000-8000-000000000001';
  v_goal  uuid;
  v_tz    text := 'Asia/Seoul';
  v_today date;
  v_dig   jsonb;
  v_day   jsonb;
  v_cnt   jsonb;
  v_built jsonb;
  v_card  uuid := 'f2300001-0000-4000-8000-000000000001';
  v_card2 uuid := 'f2300002-0000-4000-8000-000000000001';
BEGIN
  v_goal := (create_learning_goal('language', 'Week goal', 20)->>'goal_id')::uuid;
  PERFORM set_learning_goal_decks(v_goal, jsonb_build_array(
    jsonb_build_object('deck_id', 'f2200000-0000-4000-8000-000000000001', 'importance', 0.5)));
  v_today := public._local_date(now(), v_tz);

  -- ── 1) Seven cells for seven days, even with no plans at all ──────────────
  -- This is the state the report was about: a goal with almost nothing in it. The strip must
  -- still be a week, or the screen goes back to being blank in exactly the case it is for.
  v_dig := get_plan_digest(v_goal, v_tz, 7);
  IF jsonb_array_length(v_dig->'by_day') <> 7 THEN
    RAISE EXCEPTION 'FAIL: by_day has % cells for a 7-day window', jsonb_array_length(v_dig->'by_day');
  END IF;
  IF (v_dig->'by_day'->6->>'date') <> to_char(v_today, 'YYYY-MM-DD') THEN
    RAISE EXCEPTION 'FAIL: the last cell is % not today (%)',
      v_dig->'by_day'->6->>'date', v_today;
  END IF;
  IF (v_dig->'by_day'->0->>'date') <> to_char(v_today - 6, 'YYYY-MM-DD') THEN
    RAISE EXCEPTION 'FAIL: the first cell is % not six days ago', v_dig->'by_day'->0->>'date';
  END IF;
  -- A day with no plan reads as zero PLANNED, which the screen draws as "no plan" — not as a
  -- plan that was ignored.
  IF (v_dig->'by_day'->0->>'planned')::int <> 0 THEN
    RAISE EXCEPTION 'FAIL: a day with no plan row reported planned=%',
      v_dig->'by_day'->0->>'planned';
  END IF;

  -- ── 2) A plan lands on its own day ────────────────────────────────────────
  PERFORM save_daily_plan(
    v_goal, v_today - 2, v_tz, 'daily-plan-v2', 'fnv1a32:week', 20,
    jsonb_build_array(jsonb_build_object(
      'card_id', v_card, 'activity_type', 'recall', 'stimulus_type', 'text',
      'response_type', 'self_rate', 'evaluator_type', 'self_rate',
      'reason_code', 'due', 'priority', 0.5, 'estimated_minutes', 1)));
  UPDATE daily_plans SET total_items = 10, completed_items = 4
   WHERE goal_id = v_goal AND plan_date = v_today - 2;

  v_dig := get_plan_digest(v_goal, v_tz, 7);
  v_day := v_dig->'by_day'->4;                    -- index 4 = today - 2
  IF (v_day->>'date') <> to_char(v_today - 2, 'YYYY-MM-DD') THEN
    RAISE EXCEPTION 'FAIL: cell 4 is % not %', v_day->>'date', v_today - 2;
  END IF;
  IF (v_day->>'planned')::int <> 10 OR (v_day->>'done')::int <> 4 THEN
    RAISE EXCEPTION 'FAIL: the plan day reads %/%', v_day->>'done', v_day->>'planned';
  END IF;

  -- ── 3) Study done OUTSIDE a plan still shows ──────────────────────────────
  -- The whole reason `studied` is in the cell. A learner who opened a deck and studied has
  -- studied; a strip that shows that day as empty is telling them the app was not watching.
  INSERT INTO study_logs (user_id, card_id, deck_id, study_mode, rating, studied_at)
  VALUES (v_uid, v_card,  'f2200000-0000-4000-8000-000000000001', 'srs', 'good',
          (v_today - 4)::timestamptz + interval '10 hours'),
         (v_uid, v_card2, 'f2200000-0000-4000-8000-000000000001', 'srs', 'good',
          (v_today - 4)::timestamptz + interval '11 hours');

  v_dig := get_plan_digest(v_goal, v_tz, 7);
  v_day := v_dig->'by_day'->2;                    -- index 2 = today - 4
  IF (v_day->>'studied')::int <> 2 THEN
    RAISE EXCEPTION 'FAIL: a day with study outside a plan reads studied=% (cell %)',
      v_day->>'studied', v_day;
  END IF;
  IF (v_day->>'planned')::int <> 0 THEN
    RAISE EXCEPTION 'FAIL: study invented a plan on that day';
  END IF;
  -- And it did not leak into the plan aggregates, which are about PLANS.
  IF (v_dig->>'plans')::int <> 1 THEN
    RAISE EXCEPTION 'FAIL: plan-free study was counted as a plan (plans=%)', v_dig->>'plans';
  END IF;

  -- The same card studied twice in a day is one card.
  INSERT INTO study_logs (user_id, card_id, deck_id, study_mode, rating, studied_at)
  VALUES (v_uid, v_card, 'f2200000-0000-4000-8000-000000000001', 'srs', 'easy',
          (v_today - 4)::timestamptz + interval '12 hours');
  IF ((get_plan_digest(v_goal, v_tz, 7)->'by_day'->2)->>'studied')::int <> 2 THEN
    RAISE EXCEPTION 'FAIL: re-studying one card counted it twice';
  END IF;

  -- ── 4) With nothing studied today, the check falls back ───────────────────
  -- Before 209 this was the permanently-invisible state.
  v_cnt := count_daily_check_cards(v_tz, 1);
  IF (v_cnt->>'checkable')::int <> 0 THEN
    RAISE EXCEPTION 'FAIL: lookback=1 found something on a day with no study (%)', v_cnt;
  END IF;
  IF (v_cnt->>'window_days')::int <> 1 THEN
    RAISE EXCEPTION 'FAIL: lookback=1 reported window %', v_cnt->>'window_days';
  END IF;

  v_cnt := count_daily_check_cards(v_tz, 7);
  IF (v_cnt->>'checkable')::int <> 2 THEN
    RAISE EXCEPTION 'FAIL: the widened window found % checkable, expected 2 (%)',
      v_cnt->>'checkable', v_cnt;
  END IF;
  IF (v_cnt->>'window_days')::int <> 7 THEN
    RAISE EXCEPTION 'FAIL: the widened window reported window_days=%', v_cnt->>'window_days';
  END IF;

  -- ── 5) THE ASSERTION THIS CHANGE EXISTS FOR ───────────────────────────────
  -- A counter that offers a check the builder refuses is worse than the silence it replaced:
  -- the learner presses a button and gets an error.
  v_built := build_daily_check(v_goal, v_tz, 8, 7);
  IF (v_built->>'persisted')::int <> 2 THEN
    RAISE EXCEPTION 'FAIL: the counter offered 2 but the builder made % (%)',
      v_built->>'persisted', v_built;
  END IF;
  IF (v_built->>'price_micro')::int <> 0 THEN
    RAISE EXCEPTION 'FAIL: the fallback check is not free (%)', v_built->>'price_micro';
  END IF;

  -- Re-opening the screen reuses it rather than building a second one.
  IF NOT (build_daily_check(v_goal, v_tz, 8, 7)->>'reused')::boolean THEN
    RAISE EXCEPTION 'FAIL: a second call built a second check';
  END IF;

  RAISE NOTICE 'plan_week_test: part one passed';
END;
$$;

ROLLBACK;

-- ── 6) Today still wins ───────────────────────────────────────────────────────
--
-- Separate transaction because it needs a clean check-set table: the block above already
-- built today's set, and the reuse branch would answer before the window is ever consulted.
--
-- This is the assertion that keeps 오늘의 확인 honest. The fallback exists so the section is
-- not blank on a day nothing has happened; it must never take over a day where something has.
BEGIN;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id) VALUES
  ('f3000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;
INSERT INTO card_templates (id, user_id, name, fields, front_layout, back_layout) VALUES (
  'f3100000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000001', 'Today template',
  '[{"key":"word","type":"text"},{"key":"meaning","type":"text"}]'::jsonb,
  '[{"field_key":"word","style":"primary"}]'::jsonb,
  '[{"field_key":"meaning","style":"primary"}]'::jsonb);
INSERT INTO decks (id, user_id, name) VALUES
  ('f3200000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000001', 'Today deck');
INSERT INTO cards (id, deck_id, user_id, template_id, sort_position, field_values, created_at)
SELECT ('f330000' || n || '-0000-4000-8000-000000000001')::uuid,
       'f3200000-0000-4000-8000-000000000001',
       'f3000000-0000-4000-8000-000000000001',
       'f3100000-0000-4000-8000-000000000001', n,
       jsonb_build_object('word', 'T' || n, 'meaning', 'B' || n), now()
  FROM generate_series(1, 4) AS n;
SET LOCAL session_replication_role = origin;

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'f3000000-0000-4000-8000-000000000001', true);

DO $$
DECLARE
  v_uid   uuid := 'f3000000-0000-4000-8000-000000000001';
  v_tz    text := 'Asia/Seoul';
  v_today date := public._local_date(now(), v_tz);
  v_cnt   jsonb;
  v_built jsonb;
  v_stems text[];
BEGIN
  -- Three cards a week ago, ONE card today.
  INSERT INTO study_logs (user_id, card_id, deck_id, study_mode, rating, studied_at)
  VALUES (v_uid, 'f3300001-0000-4000-8000-000000000001',
          'f3200000-0000-4000-8000-000000000001', 'srs', 'good',
          (v_today - 3)::timestamptz + interval '9 hours'),
         (v_uid, 'f3300002-0000-4000-8000-000000000001',
          'f3200000-0000-4000-8000-000000000001', 'srs', 'good',
          (v_today - 3)::timestamptz + interval '9 hours'),
         (v_uid, 'f3300003-0000-4000-8000-000000000001',
          'f3200000-0000-4000-8000-000000000001', 'srs', 'good',
          (v_today - 3)::timestamptz + interval '9 hours'),
         (v_uid, 'f3300004-0000-4000-8000-000000000001',
          'f3200000-0000-4000-8000-000000000001', 'srs', 'good', now());

  -- Asked with a 7-day fallback available, it must still answer with TODAY: one card, and a
  -- window of 1.
  v_cnt := count_daily_check_cards(v_tz, 7);
  IF (v_cnt->>'window_days')::int <> 1 THEN
    RAISE EXCEPTION 'FAIL: the fallback took over a day that had study (%)', v_cnt;
  END IF;
  IF (v_cnt->>'checkable')::int <> 1 THEN
    RAISE EXCEPTION 'FAIL: today has 1 checkable card, counted % (%)', v_cnt->>'checkable', v_cnt;
  END IF;

  v_built := build_daily_check(NULL, v_tz, 8, 7);
  IF (v_built->>'persisted')::int <> 1 THEN
    RAISE EXCEPTION 'FAIL: the builder widened past today (% questions)', v_built->>'persisted';
  END IF;

  -- And it is the card studied TODAY, not one of the three from before.
  SELECT array_agg(q.stem) INTO v_stems
    FROM quiz_questions q WHERE q.set_id = (v_built->>'set_id')::uuid;
  IF v_stems <> ARRAY['T4'] THEN
    RAISE EXCEPTION 'FAIL: the check asked about % instead of today''s card', v_stems;
  END IF;

  RAISE NOTICE 'plan_week_test: all assertions passed';
END;
$$;

ROLLBACK;

-- ── 7) Why nothing is checkable, when nothing is ─────────────────────────────
--
-- This is the live 영작 오답노트 template, reproduced: two `primary` back fields, and one of
-- them holds the WRONG expression. `_quiz_answer_for_cards` refuses it, and refusing is
-- right — a check that graded a learner correct for reproducing their own mistake would be
-- worse than no check at all.
--
-- What 210 adds is that the refusal is REPORTABLE. Twenty-nine studied cards and a blank
-- section is the bug in the report; twenty-nine studied cards and "이 템플릿은 정답 칸이
-- 둘이라 확인 문제를 만들 수 없어요" is a screen the learner can act on.
BEGIN;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id) VALUES
  ('f4000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;
INSERT INTO card_templates (id, user_id, name, fields, front_layout, back_layout) VALUES (
  'f4100000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001', '영작 오답노트',
  '[{"key":"meaning","type":"text"},{"key":"wrong","type":"text"},
    {"key":"correct","type":"text"},{"key":"point","type":"text"}]'::jsonb,
  '[{"field_key":"meaning","style":"primary"}]'::jsonb,
  '[{"field_key":"wrong","style":"primary"},{"field_key":"correct","style":"primary"},
    {"field_key":"point","style":"secondary"}]'::jsonb);
INSERT INTO decks (id, user_id, name) VALUES
  ('f4200000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001', '오답 덱');
INSERT INTO cards (id, deck_id, user_id, template_id, sort_position, field_values, created_at)
SELECT ('f440000' || n || '-0000-4000-8000-000000000001')::uuid,
       'f4200000-0000-4000-8000-000000000001',
       'f4000000-0000-4000-8000-000000000001',
       'f4100000-0000-4000-8000-000000000001', n,
       jsonb_build_object('meaning', '뜻' || n, 'wrong', 'bad' || n,
                          'correct', 'good' || n, 'point', 'p' || n), now()
  FROM generate_series(1, 3) AS n;
SET LOCAL session_replication_role = origin;

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'f4000000-0000-4000-8000-000000000001', true);

DO $$
DECLARE
  v_uid uuid := 'f4000000-0000-4000-8000-000000000001';
  v_tz  text := 'Asia/Seoul';
  v_cnt jsonb;
BEGIN
  INSERT INTO study_logs (user_id, card_id, deck_id, study_mode, rating, studied_at)
  SELECT v_uid, ('f440000' || n || '-0000-4000-8000-000000000001')::uuid,
         'f4200000-0000-4000-8000-000000000001', 'srs', 'good', now()
    FROM generate_series(1, 3) AS n;

  v_cnt := count_daily_check_cards(v_tz, 7);

  -- The refusal itself must not have softened. If this ever reports a checkable card, some
  -- change has started guessing which of `wrong`/`correct` is the answer.
  IF (v_cnt->>'checkable')::int <> 0 THEN
    RAISE EXCEPTION 'FAIL: an ambiguous template produced % checkable cards — the check is now guessing which field is the answer', v_cnt->>'checkable';
  END IF;
  IF (v_cnt->>'studied_today')::int <> 3 THEN
    RAISE EXCEPTION 'FAIL: the window lost the studied cards (%)', v_cnt;
  END IF;

  -- And the reason is now sayable.
  IF jsonb_array_length(v_cnt->'blocked') <> 1 THEN
    RAISE EXCEPTION 'FAIL: blocked is % — the screen has nothing to explain with', v_cnt->'blocked';
  END IF;
  IF (v_cnt->'blocked'->0->>'template_id') <> 'f4100000-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'FAIL: blocked names the wrong template (%)', v_cnt->'blocked';
  END IF;
  IF (v_cnt->'blocked'->0->>'name') <> '영작 오답노트' THEN
    RAISE EXCEPTION 'FAIL: blocked has no name to render (%)', v_cnt->'blocked';
  END IF;
  IF (v_cnt->'blocked'->0->>'cards')::int <> 3 THEN
    RAISE EXCEPTION 'FAIL: blocked counted % cards, expected 3', v_cnt->'blocked'->0->>'cards';
  END IF;

  -- Fix the template the way the screen will tell them to — one primary — and the check
  -- appears. The explanation has to be TRUE, not just present: if this does not now work,
  -- the screen is sending learners to change a setting that was never the problem.
  UPDATE card_templates
     SET back_layout = '[{"field_key":"correct","style":"primary"},
                         {"field_key":"wrong","style":"secondary"},
                         {"field_key":"point","style":"secondary"}]'::jsonb
   WHERE id = 'f4100000-0000-4000-8000-000000000001';

  v_cnt := count_daily_check_cards(v_tz, 7);
  IF (v_cnt->>'checkable')::int <> 3 THEN
    RAISE EXCEPTION 'FAIL: after naming one answer field, checkable is % (%)',
      v_cnt->>'checkable', v_cnt;
  END IF;
  IF jsonb_array_length(v_cnt->'blocked') <> 0 THEN
    RAISE EXCEPTION 'FAIL: the explanation outlived the problem (%)', v_cnt->'blocked';
  END IF;

  -- The question asks the MEANING and expects the CORRECT expression — never the wrong one.
  PERFORM build_daily_check(NULL, v_tz, 8, 7);
  IF EXISTS (SELECT 1 FROM quiz_questions q
              WHERE q.owner_user_id = v_uid AND q.reference_answer LIKE 'bad%') THEN
    RAISE EXCEPTION 'FAIL: a check was built whose reference answer is the learner''s mistake';
  END IF;

  RAISE NOTICE 'plan_week_test: blocked-template assertions passed';
END;
$$;

ROLLBACK;

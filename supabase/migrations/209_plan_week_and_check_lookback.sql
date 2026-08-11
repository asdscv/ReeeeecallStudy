-- 209 — 학습 플랜 화면이 비어 있는 진짜 이유를 서버 쪽에서 없앤다.
--
-- The plan screen has five sections and every one of them is `return null` guarded:
--
--   AttemptHistory      — nothing studied TODAY            → null
--   LearningDiagnostics — no attempt in 30 days            → null
--   DailyCheck          — nothing studied TODAY            → null
--   PlanCoach           — fewer than 4 plans, or `hold`    → null
--
-- Each guard is individually right: none of those sections has anything true to say in the
-- state it hides in. Together they mean that a learner who has not studied yet today — which
-- is EVERY learner at the moment they open the app to decide whether to study — sees one
-- card and a button. That is the screen in the report: 그대로네?
--
-- Two of those guards are hiding data that already exists.
--
--   1) The week. `get_plan_digest` already counts finished/partial/untouched days, and the
--      coach throws every one of those numbers away when it decides there is nothing worth
--      saying. But "지난 7일 중 3일 학습" is worth saying on its own — it is the one thing on
--      this screen a learner cannot get anywhere else, it is true on day one, and it is true
--      on a day nothing is wrong. It just has to be PER DAY to be readable, so this adds
--      `by_day`: one entry per calendar day in the window, including days with no plan row
--      at all, and counting study done OUTSIDE a plan — which is most of it, and which the
--      plan-only aggregate has never been able to see.
--
--   2) The check. `count_daily_check_cards` and `build_daily_check` look at today and only
--      today, so the section is invisible until the learner has already studied — at which
--      point they are leaving, not arriving. The window now widens: today first, and only if
--      today has nothing checkable does it fall back to the last N days. Both functions read
--      the SAME window function, or the counter would offer a check the builder refuses.
--
-- Nothing here is charged and nothing calls a model: both changes are additional reads over
-- rows that were already being written.
BEGIN;

-- ── 1) The digest, per day ───────────────────────────────────────────────────
--
-- `by_day` is ordered oldest → newest and always holds exactly `p_days` entries, because a
-- strip with a hole in it cannot be read as a week. A day with no plan is `planned: 0`,
-- which is a different statement from `planned: 12, done: 0`, and the screen draws it
-- differently.
--
-- `studied` counts DISTINCT cards from both study writers, not plan completions. A learner
-- who studied a deck directly did study — and the plan-only view of that day is a zero,
-- which is exactly the reading that makes this screen feel like it is not watching.
CREATE OR REPLACE FUNCTION public.get_plan_digest(
  p_goal_id  uuid,
  p_timezone text DEFAULT 'UTC',
  p_days     integer DEFAULT 7
) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_today  date;
  v_from   date;
  v_row    record;
  v_by_day jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM learning_goals WHERE id = p_goal_id AND user_id = v_uid) THEN
    RAISE EXCEPTION 'Goal not accessible' USING errcode = '42501';
  END IF;
  IF p_days IS NULL OR p_days < 1 OR p_days > 60 THEN
    RAISE EXCEPTION 'days out of range' USING errcode = 'invalid_parameter_value';
  END IF;

  v_today := public._local_date(now(), p_timezone);
  v_from  := v_today - (p_days - 1);

  SELECT
    count(*)                                                        AS plans,
    count(*) FILTER (WHERE p.completed_items >= p.total_items
                       AND p.total_items > 0)                       AS days_finished,
    count(*) FILTER (WHERE p.completed_items = 0
                       AND p.total_items > 0)                       AS days_untouched,
    count(*) FILTER (WHERE p.completed_items > 0
                       AND p.completed_items < p.total_items)       AS days_partial,
    COALESCE(sum(p.total_items), 0)                                 AS items_planned,
    COALESCE(sum(p.completed_items), 0)                             AS items_done
  INTO v_row
  FROM daily_plans p
  WHERE p.user_id = v_uid AND p.goal_id = p_goal_id
    AND p.plan_date >= v_from AND p.plan_date <= v_today;

  -- The same window, day by day. `generate_series` is the left side, so a day with neither a
  -- plan nor a study event still produces a cell.
  --
  -- The `created_at >= ...` bounds are an index guard, not the filter: the real filter is
  -- `_local_date`, and the guard is deliberately two days wide so no timezone offset can
  -- push a local day outside it.
  WITH days AS (
    SELECT d::date AS day
      FROM generate_series(v_from::timestamp, v_today::timestamp, interval '1 day') AS d
  ), touched AS (
    SELECT public._local_date(e.created_at, p_timezone) AS day, e.card_id
      FROM study_rating_events e
     WHERE e.user_id = v_uid
       AND e.created_at >= (v_from - 2)::timestamptz
       AND e.card_id IS NOT NULL
    UNION ALL
    SELECT public._local_date(l.studied_at, p_timezone), l.card_id
      FROM study_logs l
     WHERE l.user_id = v_uid
       AND l.studied_at >= (v_from - 2)::timestamptz
       AND l.card_id IS NOT NULL
  ), studied AS (
    -- De-duplicated ACROSS both writers: a card rated and logged in one session is one
    -- card, not two.
    SELECT t.day, count(DISTINCT t.card_id) AS cards
      FROM touched t
     WHERE t.day BETWEEN v_from AND v_today
     GROUP BY t.day
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'date',    to_char(d.day, 'YYYY-MM-DD'),
           'planned', COALESCE(p.total_items, 0),
           'done',    COALESCE(p.completed_items, 0),
           'studied', COALESCE(st.cards, 0)
         ) ORDER BY d.day), '[]'::jsonb)
    INTO v_by_day
    FROM days d
    LEFT JOIN daily_plans p
           ON p.user_id = v_uid AND p.goal_id = p_goal_id AND p.plan_date = d.day
    LEFT JOIN studied st ON st.day = d.day;

  RETURN jsonb_build_object(
    'goal_id', p_goal_id,
    'days', p_days,
    'plans', COALESCE(v_row.plans, 0),
    'days_finished', COALESCE(v_row.days_finished, 0),
    'days_untouched', COALESCE(v_row.days_untouched, 0),
    'days_partial', COALESCE(v_row.days_partial, 0),
    'items_planned', COALESCE(v_row.items_planned, 0),
    'items_done', COALESCE(v_row.items_done, 0),
    -- Per-day, for a screen. The coach reads the aggregates above and ignores this; it is
    -- here so both come from ONE round trip and cannot disagree about the same week.
    'by_day', v_by_day,
    -- The learner's own settings, so the chooser can refuse a lever that is already at its
    -- floor rather than suggesting a change that does nothing.
    'daily_minutes', (SELECT daily_minutes FROM learning_goals WHERE id = p_goal_id),
    'new_cards_per_day', (SELECT (settings->>'new_cards_per_day')::int
                            FROM learning_goals WHERE id = p_goal_id));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_plan_digest(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_plan_digest(uuid, text, integer) TO authenticated;

COMMENT ON FUNCTION public.get_plan_digest(uuid, text, integer) IS
  'The last N days of a goal''s plans, as the few numbers a coach can act on, plus `by_day` for a screen: one entry per calendar day, including days with no plan and study done outside one.';

-- ── 2) The window the check draws from ───────────────────────────────────────
--
-- One place for the rule, so the counter and the builder cannot drift into offering a check
-- that cannot be built. It returns the day each card was last touched as well, because when
-- the window widens the choice should prefer recent days — but stay random WITHIN a day, or
-- a learner always gets the last eight cards of a session and never the first.
--
-- SECURITY INVOKER on purpose. It takes a uid, and a DEFINER function that takes a uid is a
-- way to read another learner's rows; as INVOKER it runs with whatever privileges its caller
-- already has, which inside these DEFINER functions is exactly what they had anyway.
CREATE OR REPLACE FUNCTION public._daily_check_window(
  p_uid      uuid,
  p_timezone text,
  p_lookback integer
) RETURNS TABLE (card_id uuid, day date, window_days integer)
  LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_today date := public._local_date(now(), p_timezone);
  v_has   boolean;
BEGIN
  -- Today, and only today, is tried first: 오늘의 확인 means today whenever today exists.
  -- The fallback is not a substitute for that; it is what the screen shows instead of
  -- nothing.
  SELECT EXISTS (
    SELECT 1 FROM _quiz_answer_for_cards(p_uid, ARRAY(
      SELECT s.c FROM (
        SELECT DISTINCT e.card_id AS c FROM study_rating_events e
         WHERE e.user_id = p_uid
           AND public._local_date(e.created_at, p_timezone) = v_today
        UNION
        SELECT DISTINCT l.card_id FROM study_logs l
         WHERE l.user_id = p_uid
           AND public._local_date(l.studied_at, p_timezone) = v_today
      ) s WHERE s.c IS NOT NULL))
  ) INTO v_has;

  IF v_has THEN
    RETURN QUERY
      SELECT s.c, v_today, 1
        FROM (
          SELECT DISTINCT e.card_id AS c FROM study_rating_events e
           WHERE e.user_id = p_uid
             AND public._local_date(e.created_at, p_timezone) = v_today
          UNION
          SELECT DISTINCT l.card_id FROM study_logs l
           WHERE l.user_id = p_uid
             AND public._local_date(l.studied_at, p_timezone) = v_today
        ) s
       WHERE s.c IS NOT NULL;
    RETURN;
  END IF;

  -- `1` means today only. A caller that did not ask for a fallback gets none.
  IF p_lookback IS NULL OR p_lookback < 2 THEN RETURN; END IF;

  RETURN QUERY
    SELECT s.c, max(s.d)::date, p_lookback
      FROM (
        SELECT e.card_id AS c, public._local_date(e.created_at, p_timezone) AS d
          FROM study_rating_events e
         WHERE e.user_id = p_uid
           AND e.created_at >= (v_today - (p_lookback + 1))::timestamptz
        UNION ALL
        SELECT l.card_id, public._local_date(l.studied_at, p_timezone)
          FROM study_logs l
         WHERE l.user_id = p_uid
           AND l.studied_at >= (v_today - (p_lookback + 1))::timestamptz
      ) s
     WHERE s.c IS NOT NULL
       AND s.d BETWEEN v_today - (p_lookback - 1) AND v_today
     GROUP BY s.c;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._daily_check_window(uuid, text, integer) FROM PUBLIC, anon;

COMMENT ON FUNCTION public._daily_check_window(uuid, text, integer) IS
  'Cards the daily check may draw from: today if today has any, otherwise the last p_lookback days. Shared by the counter and the builder so the two cannot disagree.';

-- ── 3) The counter ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.count_daily_check_cards(
  p_timezone text DEFAULT 'UTC',
  p_lookback integer DEFAULT 1
) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_n     integer;
  v_total integer;
  v_win   integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;
  IF p_lookback IS NULL OR p_lookback < 1 OR p_lookback > 30 THEN
    RAISE EXCEPTION 'lookback out of range' USING errcode = 'invalid_parameter_value';
  END IF;

  WITH win AS (
    SELECT * FROM _daily_check_window(v_uid, p_timezone, p_lookback)
  )
  SELECT
    (SELECT count(*) FROM win),
    (SELECT max(w.window_days) FROM win w),
    (SELECT count(*) FROM _quiz_answer_for_cards(v_uid, ARRAY(SELECT w.card_id FROM win w)))
  INTO v_total, v_win, v_n;

  RETURN jsonb_build_object(
    -- The name is kept from 205 so no client breaks; when `window_days` is larger than 1 it
    -- is a count of recent study, not of today's.
    'studied_today', COALESCE(v_total, 0),
    'checkable',     COALESCE(v_n, 0),
    -- 1 means today. Anything larger means the screen is offering RECENT study, and the copy
    -- has to say so — being told you are checking today's cards on a day you did not study
    -- is the kind of small lie that costs a feature its credibility.
    'window_days',   COALESCE(v_win, 1));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.count_daily_check_cards(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.count_daily_check_cards(text, integer) TO authenticated;

-- ── 4) The builder ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.build_daily_check(
  p_goal_id  uuid DEFAULT NULL,
  p_timezone text DEFAULT 'UTC',
  p_limit    integer DEFAULT 8,
  p_lookback integer DEFAULT 1
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_today  date;
  v_chosen uuid[];
  v_set    uuid;
  v_pos    smallint := 0;
  v_n      integer := 0;
  r        record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 20 THEN
    RAISE EXCEPTION 'limit out of range' USING errcode = 'P0009';
  END IF;
  IF p_lookback IS NULL OR p_lookback < 1 OR p_lookback > 30 THEN
    RAISE EXCEPTION 'lookback out of range' USING errcode = 'invalid_parameter_value';
  END IF;
  IF p_goal_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM learning_goals g WHERE g.id = p_goal_id AND g.user_id = v_uid) THEN
    RAISE EXCEPTION 'Goal not accessible' USING errcode = '42501';
  END IF;

  v_today := public._local_date(now(), p_timezone);

  -- One check per goal per day. Re-opening the screen must reuse the set rather than charge
  -- a second reservation and split the day's answers across two histories.
  SELECT id INTO v_set FROM quiz_sets
   WHERE owner_user_id = v_uid
     AND goal_id IS NOT DISTINCT FROM p_goal_id
     AND question_type = 'short'
     AND title = '__daily_check__'
     AND public._local_date(created_at, p_timezone) = v_today
   ORDER BY created_at DESC LIMIT 1;
  IF v_set IS NOT NULL THEN
    RETURN jsonb_build_object('set_id', v_set, 'reused', true, 'price_micro', 0,
      'persisted', (SELECT generated_count FROM quiz_sets WHERE id = v_set));
  END IF;

  -- Of what the window offers, the ones whose template actually says which field is the
  -- answer. A card that does not is dropped, never guessed at.
  --
  -- Recent days first, random within a day: over a widened window "recent" is the useful
  -- order, and inside one day it would just mean the tail of the session every time.
  WITH win AS (
    SELECT * FROM _daily_check_window(v_uid, p_timezone, p_lookback)
  ), answerable AS (
    SELECT a.card_id
      FROM _quiz_answer_for_cards(v_uid, ARRAY(SELECT w.card_id FROM win w)) a
  )
  SELECT array_agg(picked.card_id) INTO v_chosen FROM (
    SELECT w.card_id
      FROM win w
      JOIN answerable a ON a.card_id = w.card_id
     ORDER BY w.day DESC, random()
     LIMIT p_limit
  ) picked;

  IF v_chosen IS NULL OR cardinality(v_chosen) = 0 THEN
    RAISE EXCEPTION 'Nothing recent to check' USING errcode = 'P0010';
  END IF;

  INSERT INTO quiz_sets (owner_user_id, deck_id, goal_id, title, question_type, scope_kind,
                         scope_card_ids, requested_count, content_locale, difficulty,
                         generated_count)
  VALUES (
    v_uid,
    -- The deck of the first chosen card. A day crosses decks, so this column is not the
    -- set's definition — `scope_card_ids` is. It is populated because `quiz_sets.deck_id` is
    -- NOT NULL and widening it would touch every quiz path for no gain here.
    (SELECT c.deck_id FROM cards c WHERE c.id = v_chosen[1]),
    p_goal_id, '__daily_check__', 'short', 'cards',
    v_chosen, cardinality(v_chosen), 'ko', 1, 0)
  RETURNING id INTO v_set;

  FOR r IN
    SELECT a.card_id, a.prompt_text, a.answer_text
      FROM _quiz_answer_for_cards(v_uid, v_chosen) a
  LOOP
    INSERT INTO quiz_questions (
      set_id, owner_user_id, card_id, question_type, position, stem,
      reference_answer, source_fingerprint, difficulty, meta)
    VALUES (
      v_set, v_uid, r.card_id, 'short', v_pos,
      -- The card's own prompt, verbatim. No model wrote any part of this question, so there
      -- is nothing here to validate and nothing that can leak the answer.
      r.prompt_text,
      r.answer_text, md5(r.prompt_text || ' ' || r.answer_text), 1,
      jsonb_build_object('source', 'daily_check'));
    v_pos := v_pos + 1;
    v_n := v_n + 1;
  END LOOP;

  UPDATE quiz_sets SET generated_count = v_n, updated_at = now() WHERE id = v_set;
  RETURN jsonb_build_object('set_id', v_set, 'persisted', v_n, 'reused', false,
                            'price_micro', 0);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.build_daily_check(uuid, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.build_daily_check(uuid, text, integer, integer) TO authenticated;

-- The 3-argument forms are dropped, not kept beside the new ones: leaving them would let a
-- client reach the old builder with the new counter's answer and get P0010 on a check the
-- screen had just offered.
DROP FUNCTION IF EXISTS public.count_daily_check_cards(text);
DROP FUNCTION IF EXISTS public.build_daily_check(uuid, text, integer);

COMMIT;

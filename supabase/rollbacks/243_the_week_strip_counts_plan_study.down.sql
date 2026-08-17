-- 243 되돌리기: `get_plan_digest` 를 213 그대로 복원합니다.
--
-- 되돌리면 주간 띠는 다시 덱 학습 세션만 셉니다 — 학습플랜에서 답한 날은 다시 빈 칸이 됩니다.
BEGIN;

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
    -- Both spellings. The reader has always asked for `new_cards_per_day`; every writer —
    -- both goal forms and `parseNewCardsPerDay` — uses `newCardsPerDay`, so this projection
    -- has returned NULL for every goal that ever existed, and two of the coach's six levers
    -- have never been able to fire. Snake first only because a legacy row would be the older
    -- deliberate value; new writes are camel and `applyPlanCoach` now deletes the snake one.
    'new_cards_per_day', (SELECT COALESCE(
                              (settings->>'new_cards_per_day')::int,
                              (settings->>'newCardsPerDay')::int)
                            FROM learning_goals WHERE id = p_goal_id));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_plan_digest(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_plan_digest(uuid, text, integer) TO authenticated;

COMMIT;

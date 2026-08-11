-- Rollback 209 — back to the 206/205 shapes.
--
-- `by_day` disappearing is safe: the screen renders the strip only when the key is present,
-- and every other consumer of the digest reads the aggregates.
--
-- The check functions have to go back to their 3-argument signatures, because a client on
-- the old bundle calls them by name with the old parameter set.
BEGIN;

DROP FUNCTION IF EXISTS public.count_daily_check_cards(text, integer);
DROP FUNCTION IF EXISTS public.build_daily_check(uuid, text, integer, integer);
DROP FUNCTION IF EXISTS public._daily_check_window(uuid, text, integer);

-- ── get_plan_digest, as 206 wrote it ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_plan_digest(
  p_goal_id  uuid,
  p_timezone text DEFAULT 'UTC',
  p_days     integer DEFAULT 7
) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_today date;
  v_row   record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM learning_goals WHERE id = p_goal_id AND user_id = v_uid) THEN
    RAISE EXCEPTION 'Goal not accessible' USING errcode = '42501';
  END IF;
  IF p_days IS NULL OR p_days < 1 OR p_days > 60 THEN
    RAISE EXCEPTION 'days out of range' USING errcode = 'invalid_parameter_value';
  END IF;

  v_today := public._local_date(now(), p_timezone);

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
    AND p.plan_date > v_today - p_days AND p.plan_date <= v_today;

  RETURN jsonb_build_object(
    'goal_id', p_goal_id,
    'days', p_days,
    'plans', COALESCE(v_row.plans, 0),
    'days_finished', COALESCE(v_row.days_finished, 0),
    'days_untouched', COALESCE(v_row.days_untouched, 0),
    'days_partial', COALESCE(v_row.days_partial, 0),
    'items_planned', COALESCE(v_row.items_planned, 0),
    'items_done', COALESCE(v_row.items_done, 0),
    'daily_minutes', (SELECT daily_minutes FROM learning_goals WHERE id = p_goal_id),
    'new_cards_per_day', (SELECT (settings->>'new_cards_per_day')::int
                            FROM learning_goals WHERE id = p_goal_id));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_plan_digest(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_plan_digest(uuid, text, integer) TO authenticated;

-- ── count_daily_check_cards, as 205 wrote it ────────────────────────────────
CREATE OR REPLACE FUNCTION public.count_daily_check_cards(
  p_timezone text DEFAULT 'UTC'
) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_today date;
  v_n     integer;
  v_total integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;
  v_today := public._local_date(now(), p_timezone);

  WITH studied AS (
    SELECT DISTINCT e.card_id
      FROM study_rating_events e
     WHERE e.user_id = v_uid
       AND public._local_date(e.created_at, p_timezone) = v_today
    UNION
    SELECT DISTINCT l.card_id
      FROM study_logs l
     WHERE l.user_id = v_uid
       AND public._local_date(l.studied_at, p_timezone) = v_today
  )
  SELECT count(*) INTO v_total FROM studied;

  SELECT count(*) INTO v_n
    FROM _quiz_answer_for_cards(v_uid, ARRAY(SELECT card_id FROM (
      SELECT DISTINCT e.card_id FROM study_rating_events e
       WHERE e.user_id = v_uid
         AND public._local_date(e.created_at, p_timezone) = v_today
      UNION
      SELECT DISTINCT l.card_id FROM study_logs l
       WHERE l.user_id = v_uid
         AND public._local_date(l.studied_at, p_timezone) = v_today
    ) s));

  RETURN jsonb_build_object('studied_today', COALESCE(v_total, 0),
                            'checkable', COALESCE(v_n, 0));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.count_daily_check_cards(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.count_daily_check_cards(text) TO authenticated;

-- ── build_daily_check, as 205 wrote it ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.build_daily_check(
  p_goal_id  uuid DEFAULT NULL,
  p_timezone text DEFAULT 'UTC',
  p_limit    integer DEFAULT 8
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_today   date;
  v_studied uuid[];
  v_chosen  uuid[];
  v_set     uuid;
  v_pos     smallint := 0;
  v_n       integer := 0;
  r         record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 20 THEN
    RAISE EXCEPTION 'limit out of range' USING errcode = 'P0009';
  END IF;
  IF p_goal_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM learning_goals g WHERE g.id = p_goal_id AND g.user_id = v_uid) THEN
    RAISE EXCEPTION 'Goal not accessible' USING errcode = '42501';
  END IF;

  v_today := public._local_date(now(), p_timezone);

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

  SELECT array_agg(DISTINCT card_id) INTO v_studied FROM (
    SELECT e.card_id FROM study_rating_events e
     WHERE e.user_id = v_uid
       AND public._local_date(e.created_at, p_timezone) = v_today
    UNION
    SELECT l.card_id FROM study_logs l
     WHERE l.user_id = v_uid
       AND public._local_date(l.studied_at, p_timezone) = v_today
  ) s WHERE card_id IS NOT NULL;

  IF v_studied IS NULL OR cardinality(v_studied) = 0 THEN
    RAISE EXCEPTION 'Nothing studied today to check' USING errcode = 'P0010';
  END IF;

  SELECT array_agg(card_id) INTO v_chosen FROM (
    SELECT a.card_id FROM _quiz_answer_for_cards(v_uid, v_studied) a
     ORDER BY random() LIMIT p_limit
  ) c;

  IF v_chosen IS NULL OR cardinality(v_chosen) = 0 THEN
    RAISE EXCEPTION 'Nothing studied today to check' USING errcode = 'P0010';
  END IF;

  INSERT INTO quiz_sets (owner_user_id, deck_id, goal_id, title, question_type, scope_kind,
                         scope_card_ids, requested_count, content_locale, difficulty,
                         generated_count)
  VALUES (
    v_uid,
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
REVOKE EXECUTE ON FUNCTION public.build_daily_check(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.build_daily_check(uuid, text, integer) TO authenticated;

COMMIT;

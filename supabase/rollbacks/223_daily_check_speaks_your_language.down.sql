-- Rollback 223: the daily check goes back to Korean for everyone.
--
-- Drops the five-argument form and restores the four-argument one, which writes
-- `content_locale = 'ko'` regardless of who is studying.
DROP FUNCTION IF EXISTS public.build_daily_check(uuid, text, integer, integer, text);

CREATE OR REPLACE FUNCTION public.build_daily_check(p_goal_id uuid DEFAULT NULL::uuid, p_timezone text DEFAULT 'UTC'::text, p_limit integer DEFAULT 8, p_lookback integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$

;

REVOKE EXECUTE ON FUNCTION public.build_daily_check(uuid, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.build_daily_check(uuid, text, integer, integer) TO authenticated;

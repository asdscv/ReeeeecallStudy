-- 210 — 오늘의 확인이 왜 안 뜨는지 말해준다.
--
-- Measured on the live account the report came from, after 209 widened the window:
--
--     count_daily_check_cards('Asia/Seoul', 7)
--       → { studied_today: 29, checkable: 0, window_days: 7 }
--
-- Twenty-nine cards studied in the last week and not one of them can be checked. Not a bug in
-- 209 — the window found them all. `_quiz_answer_for_cards` then dropped every one, because
-- their template (영작 오답노트) declares TWO primary back fields:
--
--     back_layout: [ {wrong, primary}, {correct, primary}, {explanation, …}, {point, …} ]
--
-- and one of them is literally the WRONG expression. Refusing is right: a check that graded a
-- learner correct for reproducing their own mistake is worse than no check. `card-answer.ts`
-- argues the same thing at length — absence is a usable answer, a guess is not, and this is
-- the exact template that makes the point.
--
-- But refusing SILENTLY is what the report is about. The section renders nothing, so the
-- learner has no way to know the feature exists, that their deck is one setting away from it,
-- or which setting. The information to say all three is already in the query that refuses.
--
-- So `blocked` comes back with it: the templates whose cards were studied and dropped, with
-- enough to name them and link to their editor. Nothing about the refusal changes.
\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION public.count_daily_check_cards(
  p_timezone text DEFAULT 'UTC',
  p_lookback integer DEFAULT 1
) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_n       integer;
  v_total   integer;
  v_win     integer;
  v_blocked jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;
  IF p_lookback IS NULL OR p_lookback < 1 OR p_lookback > 30 THEN
    RAISE EXCEPTION 'lookback out of range' USING errcode = 'invalid_parameter_value';
  END IF;

  WITH win AS (
    SELECT * FROM _daily_check_window(v_uid, p_timezone, p_lookback)
  ), ok AS (
    SELECT a.card_id FROM _quiz_answer_for_cards(v_uid, ARRAY(SELECT w.card_id FROM win w)) a
  ), dropped AS (
    -- Studied, and refused. Grouped by template because that is the thing a learner can
    -- change; one row per CARD would be a list of 29 identical problems.
    SELECT c.template_id, count(*) AS cards
      FROM win w
      JOIN cards c ON c.id = w.card_id AND c.user_id = v_uid
     WHERE NOT EXISTS (SELECT 1 FROM ok WHERE ok.card_id = w.card_id)
     GROUP BY c.template_id
     ORDER BY count(*) DESC
     LIMIT 3
  )
  SELECT
    (SELECT count(*) FROM win),
    (SELECT max(w.window_days) FROM win w),
    (SELECT count(*) FROM ok),
    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'template_id', d.template_id,
              'name', t.name,
              'cards', d.cards)), '[]'::jsonb)
       FROM dropped d JOIN card_templates t ON t.id = d.template_id)
  INTO v_total, v_win, v_n, v_blocked;

  RETURN jsonb_build_object(
    -- The name is kept from 205 so no client breaks; when `window_days` is larger than 1 it
    -- is a count of recent study, not of today's.
    'studied_today', COALESCE(v_total, 0),
    'checkable',     COALESCE(v_n, 0),
    -- 1 means today. Anything larger means the screen is offering RECENT study, and the copy
    -- has to say so — being told you are checking today's cards on a day you did not study
    -- is the kind of small lie that costs a feature its credibility.
    'window_days',   COALESCE(v_win, 1),
    -- Why nothing is checkable, when nothing is. Only meaningful alongside
    -- `studied_today > 0 AND checkable = 0`; at any other time it is noise the screen should
    -- not render, because a template that blocks SOME cards while others work is not a
    -- problem the learner needs to be interrupted about.
    'blocked',       COALESCE(v_blocked, '[]'::jsonb));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.count_daily_check_cards(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.count_daily_check_cards(text, integer) TO authenticated;

COMMENT ON FUNCTION public.count_daily_check_cards(text, integer) IS
  'How many recently studied cards can be checked, which window that answer came from, and — when none can — the templates that blocked them, so the screen can say why instead of vanishing.';

COMMIT;

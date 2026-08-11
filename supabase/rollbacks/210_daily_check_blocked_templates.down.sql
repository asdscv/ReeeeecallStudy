-- Rollback 210 — the counter stops explaining itself, back to 209's three keys.
--
-- Safe in either direction: the screen renders the explanation only when `blocked` is a
-- non-empty array, so a server without the key falls back to the silence 209 shipped with.
BEGIN;

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
    'studied_today', COALESCE(v_total, 0),
    'checkable',     COALESCE(v_n, 0),
    'window_days',   COALESCE(v_win, 1));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.count_daily_check_cards(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.count_daily_check_cards(text, integer) TO authenticated;

COMMIT;

-- Rollback 218: back to deck and template being free and unmetered.
--
-- Re-apply 216, whose reserve_ai_generation forces p_cards := 0 for any kind but 'cards'. That
-- reopens an unpriced channel on the most expensive call in the app; it is here for symmetry,
-- not because you would want it.
-- ── reserve: agree the price up front, and gate on being able to pay it ─────
--
-- The old gate was `balance > 0`, which admits a learner with one micro-USD to a call that
-- costs fifty thousand. That was survivable while the charge followed cost — the wallet simply
-- went slightly negative. With a fixed price it is not: the learner is committed to a number
-- before the work starts, so the check has to be against that number.
BEGIN;

CREATE OR REPLACE FUNCTION public.reserve_ai_generation(p_kind text, p_cards integer DEFAULT 0)
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid  uuid    := auth.uid();
  v_today date   := (now() AT TIME ZONE 'UTC')::date;
  v_used integer; v_reqs integer;
  v_free integer; v_paid integer;
  v_bal  bigint;
  v_unit bigint; v_price bigint := 0;
  v_ref  text    := gen_random_uuid()::text;
  c_free constant integer := public._ai_free_cards_per_day();
  c_max_reqs constant integer := 300;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_kind NOT IN ('cards', 'template', 'deck') THEN
    RAISE EXCEPTION 'Invalid generation kind: %', p_kind USING errcode = 'invalid_parameter_value';
  END IF;
  IF p_cards IS NULL OR p_cards < 0 THEN p_cards := 0; END IF;
  IF p_kind <> 'cards' THEN p_cards := 0; END IF;

  INSERT INTO ai_generation_usage (user_id, usage_date) VALUES (v_uid, v_today)
    ON CONFLICT (user_id, usage_date) DO NOTHING;
  SELECT free_cards_used, req_count INTO v_used, v_reqs
    FROM ai_generation_usage WHERE user_id = v_uid AND usage_date = v_today FOR UPDATE;

  IF v_reqs + 1 > c_max_reqs THEN
    RAISE EXCEPTION 'AI generation request cap exceeded' USING errcode = 'check_violation';
  END IF;

  v_free := LEAST(p_cards, GREATEST(0, c_free - v_used));
  v_paid := p_cards - v_free;

  -- Only the cards beyond the free allowance are priced.
  v_unit  := COALESCE(public._ai_action_price('card'), 0);
  v_price := v_paid::bigint * v_unit;

  IF v_price > 0 THEN
    SELECT balance INTO v_bal FROM ai_credit_balance WHERE user_id = v_uid;
    IF COALESCE(v_bal, 0) < v_price THEN
      RAISE EXCEPTION 'Insufficient AI wallet balance' USING errcode = 'P0002';
    END IF;
  END IF;

  UPDATE ai_generation_usage
     SET free_cards_used = free_cards_used + v_free,
         paid_cards_used = paid_cards_used + v_paid,
         req_count       = req_count + 1
   WHERE user_id = v_uid AND usage_date = v_today;

  INSERT INTO ai_generation_jobs (id, user_id, usage_date, free_cards, paid_cards, image_jobs,
                                  fixed_price_micro)
    VALUES (v_ref, v_uid, v_today, v_free, v_paid, 0, NULLIF(v_price, 0));

  RETURN jsonb_build_object(
    'remaining_free', GREATEST(0, c_free - (v_used + v_free)),
    'free_now', v_free, 'paid_now', v_paid, 'job_ref', v_ref,
    'price_micro', v_price);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.reserve_ai_generation(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_ai_generation(text, integer) TO authenticated;

COMMIT;

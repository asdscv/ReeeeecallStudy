-- 218: deck and template generation were the only model calls with no meter at all.
--
-- `reserve_ai_generation` did `IF p_kind <> 'cards' THEN p_cards := 0`, so a deck-metadata or
-- template generation was priced at nothing and counted against nothing. The intent was
-- reasonable — you cannot sell cards to someone who has not been able to make a deck, so the
-- setup step was left open. The effect was a loss with no ceiling except the shared 300
-- requests/day, and it was open on the single most expensive call in the app.
--
-- Measured on production, at the dearest model in the chain:
--
--     card, short topic        161 micro
--     deck metadata            306
--     template                 851      <- 5.3x a card, and the one that was free
--
-- Now both count as ONE card against the same daily free allowance. Nothing new is shown to a
-- learner and no new paywall appears: the allowance is ten a day, and making a deck plus its
-- template is two of them. What changes is that the loss ceiling is the free allowance itself
-- rather than the free allowance PLUS an unmetered channel — which is the whole point of having
-- an allowance.
--
-- Past the allowance they are a paid card at the list price, like everything else. That is
-- generous to us on deck (306 against 10,000) and merely correct on template (851), and it
-- means the price-floor test now covers a path it could not see before, because a price of zero
-- is not a price the floor can check.
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
  -- ONE unit, not zero. A deck or a template is a single model call whose cost sits between a
  -- card and five of them; charging it as one card is the closest honest unit we already have,
  -- and it keeps the meter's vocabulary to a single thing.
  IF p_kind <> 'cards' THEN p_cards := 1; END IF;

  INSERT INTO ai_generation_usage (user_id, usage_date) VALUES (v_uid, v_today)
    ON CONFLICT (user_id, usage_date) DO NOTHING;
  SELECT free_cards_used, req_count INTO v_used, v_reqs
    FROM ai_generation_usage WHERE user_id = v_uid AND usage_date = v_today FOR UPDATE;

  IF v_reqs + 1 > c_max_reqs THEN
    RAISE EXCEPTION 'AI generation request cap exceeded' USING errcode = 'check_violation';
  END IF;

  v_free := LEAST(p_cards, GREATEST(0, c_free - v_used));
  v_paid := p_cards - v_free;

  -- Only what the free allowance did not cover is priced.
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

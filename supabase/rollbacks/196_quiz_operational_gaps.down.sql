-- Rollback for 196.
--
-- Restores the three functions to their pre-196 bodies. No tables, columns or data are touched.
--
-- Note what reverting COSTS, so it is a decision and not an accident:
--
--   * `reserve_ai_quiz` loses the opportunistic sweep, and since pg_cron is not installed and
--     nothing else calls `sweep_ai_quiz_holds`, abandoned holds become permanent again — each
--     one silently shortening exactly one learner's wallet.
--   * `get_ai_wallet_summary` stops reporting the quiz allowance, so the 60-unit trial is once
--     more visible only inside a quote on the quiz setup screen.
--   * `get_ai_margin_daily` goes back to blending quiz and card margin in one (day, provider,
--     model) bucket, where quiz's ~20x markup absorbs a card-side cost regression.
--
-- The margin function's signature changes, so it is DROPped first — a `CREATE OR REPLACE` that
-- removes a return column fails with 42P13.

BEGIN;

-- ── 1) reserve_ai_quiz, as 194 defined it ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.reserve_ai_quiz(
  p_action          text,
  p_count           integer,
  p_client_ref      uuid,
  p_max_price_micro bigint,
  p_deck_id         uuid   DEFAULT NULL,
  p_card_ids        uuid[] DEFAULT '{}'::uuid[],
  p_set_id          uuid   DEFAULT NULL,
  p_run_item_id     uuid   DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_today      date := (now() AT TIME ZONE 'UTC')::date;
  v_ref        text := gen_random_uuid()::text;
  s            ai_pricing_settings%ROWTYPE;
  v_units_each smallint;
  v_job_kind   text;
  v_total      integer;
  v_trial_left integer := 0;
  v_free_used  integer := 0;
  v_free_left  integer;
  v_alloc      record;
  v_price      bigint;
  v_balance    bigint := 0;
  v_held       bigint := 0;
  v_requests   integer;
  v_existing   ai_generation_jobs%ROWTYPE;
  v_card       uuid;
  c_max_requests constant integer := 300;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;
  IF p_client_ref IS NULL OR p_max_price_micro IS NULL OR p_max_price_micro < 0 THEN
    RAISE EXCEPTION 'client_ref and max_price are required'
      USING errcode = 'invalid_parameter_value';
  END IF;

  SELECT units, job_kind INTO v_units_each, v_job_kind
    FROM ai_quiz_price_units WHERE action = p_action;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown quiz action' USING errcode = 'invalid_parameter_value';
  END IF;

  SELECT * INTO s FROM ai_pricing_settings WHERE id = 1;

  IF p_count IS NULL OR p_count < 1 THEN
    RAISE EXCEPTION 'count must be positive' USING errcode = 'invalid_parameter_value';
  END IF;
  IF v_job_kind = 'quiz_grade' AND p_count <> 1 THEN
    RAISE EXCEPTION 'grading reserves one answer at a time' USING errcode = 'invalid_parameter_value';
  END IF;
  v_total := v_units_each * p_count;
  IF v_total > s.quiz_max_units_per_call THEN
    RAISE EXCEPTION 'Quiz request too large' USING errcode = 'P0009';
  END IF;

  IF p_deck_id IS NOT NULL AND NOT public._check_deck_access(v_uid, p_deck_id) THEN
    RAISE EXCEPTION 'Deck not accessible' USING errcode = '42501';
  END IF;
  IF cardinality(COALESCE(p_card_ids, '{}'::uuid[])) > 50 THEN
    RAISE EXCEPTION 'Too many cards' USING errcode = 'P0009';
  END IF;
  FOREACH v_card IN ARRAY COALESCE(p_card_ids, '{}'::uuid[]) LOOP
    IF NOT public._check_card_access(v_uid, v_card) THEN
      RAISE EXCEPTION 'Card not accessible' USING errcode = '42501';
    END IF;
  END LOOP;
  IF p_set_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM quiz_sets WHERE id = p_set_id AND owner_user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Quiz set not accessible' USING errcode = '42501';
  END IF;
  IF p_run_item_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM quiz_run_items i JOIN quiz_runs r ON r.id = i.run_id
     WHERE i.id = p_run_item_id AND r.user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Quiz run item not accessible' USING errcode = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || p_client_ref::text, 0));
  SELECT * INTO v_existing FROM ai_generation_jobs
   WHERE user_id = v_uid AND client_ref = p_client_ref;
  IF FOUND THEN
    IF v_existing.quiz_action IS DISTINCT FROM p_action
       OR v_existing.quiz_units_held IS DISTINCT FROM v_total THEN
      RAISE EXCEPTION 'client_ref reused with different parameters'
        USING errcode = 'invalid_parameter_value';
    END IF;
    RETURN jsonb_build_object('job_ref', v_existing.id, 'job_kind', v_existing.job_kind,
                              'units', v_existing.quiz_units_held,
                              'paid_units', v_existing.quiz_units_held - v_existing.quiz_free_held
                                            - v_existing.quiz_trial_held,
                              'unit_price_micro', v_existing.quiz_unit_price, 'replayed', true);
  END IF;

  INSERT INTO ai_generation_usage (user_id, usage_date) VALUES (v_uid, v_today)
    ON CONFLICT (user_id, usage_date) DO NOTHING;
  SELECT req_count, COALESCE(free_quiz_units_used, 0) INTO v_requests, v_free_used
    FROM ai_generation_usage WHERE user_id = v_uid AND usage_date = v_today FOR UPDATE;
  IF v_requests + 1 > c_max_requests THEN
    RAISE EXCEPTION 'AI generation request cap exceeded' USING errcode = 'check_violation';
  END IF;

  SELECT COALESCE(units_remaining, 0) INTO v_trial_left
    FROM ai_quiz_trial WHERE user_id = v_uid FOR UPDATE;
  v_free_left := GREATEST(0, s.free_quiz_units_per_day - v_free_used);
  SELECT * INTO v_alloc FROM _ai_quiz_allocate(v_total, COALESCE(v_trial_left, 0), v_free_left);
  v_price := v_alloc.paid_units::bigint * s.quiz_unit_price_micro;

  IF v_price > p_max_price_micro THEN
    RAISE EXCEPTION 'Price changed since the quote' USING errcode = 'P0008';
  END IF;

  SELECT COALESCE(balance, 0) INTO v_balance FROM ai_credit_balance WHERE user_id = v_uid FOR UPDATE;
  SELECT COALESCE(sum((quiz_units_held - quiz_free_held - quiz_trial_held)::bigint * quiz_unit_price), 0)
    INTO v_held
    FROM ai_generation_jobs
   WHERE user_id = v_uid AND quiz_units_done IS NULL AND quiz_units_held > 0
     AND NOT charged AND NOT refunded;
  IF COALESCE(v_balance, 0) < v_held + v_price THEN
    RAISE EXCEPTION 'Insufficient AI wallet balance' USING errcode = 'P0002';
  END IF;

  IF v_alloc.trial_units > 0 THEN
    UPDATE ai_quiz_trial SET units_remaining = units_remaining - v_alloc.trial_units
     WHERE user_id = v_uid;
  END IF;
  UPDATE ai_generation_usage
     SET req_count = req_count + 1,
         free_quiz_units_used = free_quiz_units_used + v_alloc.free_units,
         paid_quiz_units_used = paid_quiz_units_used + v_alloc.paid_units
   WHERE user_id = v_uid AND usage_date = v_today;

  INSERT INTO ai_generation_jobs
    (id, user_id, usage_date, free_cards, paid_cards, image_jobs, job_kind, billable_fraction,
     quiz_action, quiz_units_held, quiz_free_held, quiz_trial_held, quiz_unit_price,
     quiz_set_id, quiz_run_item_id, client_ref)
  VALUES
    (v_ref, v_uid, v_today, 0, 0, 0, v_job_kind, 1.0,
     p_action, v_total, v_alloc.free_units, v_alloc.trial_units, s.quiz_unit_price_micro,
     p_set_id, p_run_item_id, p_client_ref);

  RETURN jsonb_build_object('job_ref', v_ref, 'job_kind', v_job_kind, 'units', v_total,
                            'trial_units', v_alloc.trial_units, 'free_units', v_alloc.free_units,
                            'paid_units', v_alloc.paid_units,
                            'unit_price_micro', s.quiz_unit_price_micro,
                            'price_micro', v_price, 'replayed', false);
END;
$$;

-- ── 2) get_ai_wallet_summary, without the quiz keys ─────────────────────────
CREATE OR REPLACE FUNCTION public.get_ai_wallet_summary()
  RETURNS json
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid        uuid    := auth.uid();
  v_today      date    := (now() AT TIME ZONE 'UTC')::date;
  v_free_limit integer := public._ai_free_cards_per_day();
  v_free_used  integer;
  result       json;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT free_cards_used INTO v_free_used
    FROM ai_generation_usage
   WHERE user_id = v_uid AND usage_date = v_today;
  v_free_used := COALESCE(v_free_used, 0);

  SELECT json_build_object(
    'balance_micro_won',        COALESCE((SELECT b.balance FROM ai_credit_balance b WHERE b.user_id = v_uid), 0),
    'est_price_per_card_micro', public._ai_est_price_per_card(),
    'free_limit',               v_free_limit,
    'free_used_today',          v_free_used,
    'free_remaining_today',     GREATEST(0, v_free_limit - v_free_used),
    'ledger', COALESCE((
      SELECT json_agg(row_to_json(r))
      FROM (
        SELECT delta, reason, balance_after, created_at
          FROM ai_credit_ledger
         WHERE user_id = v_uid
         ORDER BY created_at DESC
         LIMIT 30
      ) r
    ), '[]'::json)
  ) INTO result;

  RETURN result;
END;
$$;

-- ── 3) get_ai_margin_daily, blended again ───────────────────────────────────
DROP FUNCTION IF EXISTS public.get_ai_margin_daily(date);
CREATE OR REPLACE FUNCTION public.get_ai_margin_daily(
  p_since date DEFAULT ((now() - '30 days'::interval))::date
) RETURNS TABLE (
  day date, provider text, model text,
  jobs bigint, unknown_cost_jobs bigint, rate_missing_jobs bigint,
  under_target_jobs bigint, net_negative_jobs bigint,
  price_won_micros numeric, cost_won_micros numeric, margin_won_micros numeric,
  realized_margin_ratio numeric
)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'Not authorized' USING errcode = '42501';
  END IF;
  RETURN QUERY
  SELECT
    date_trunc('day', l.created_at)::date AS day,
    l.provider, l.model,
    count(*)::bigint,
    count(*) FILTER (WHERE l.estimated)::bigint,
    count(*) FILTER (WHERE l.rate_missing)::bigint,
    count(*) FILTER (WHERE l.under_target)::bigint,
    count(*) FILTER (WHERE NOT l.estimated AND l.price_won_micros > 0
                       AND l.margin_won_micros < 0)::bigint,
    COALESCE(sum(CASE WHEN j.refunded THEN 0 ELSE l.price_won_micros END)
             FILTER (WHERE NOT l.estimated), 0)::numeric,
    COALESCE(sum(l.cost_won_micros) FILTER (WHERE NOT l.estimated), 0)::numeric,
    (COALESCE(sum(CASE WHEN j.refunded THEN 0 ELSE l.price_won_micros END)
              FILTER (WHERE NOT l.estimated), 0)
     - COALESCE(sum(l.cost_won_micros) FILTER (WHERE NOT l.estimated), 0))::numeric,
    round(1.0 - (COALESCE(sum(l.cost_won_micros) FILTER (WHERE NOT l.estimated), 0))::numeric
          / NULLIF(sum(CASE WHEN j.refunded THEN 0 ELSE l.price_won_micros END)
                   FILTER (WHERE NOT l.estimated), 0), 4)
  FROM ai_cost_ledger l JOIN ai_generation_jobs j ON j.id = l.job_ref
  WHERE l.created_at::date >= p_since
  GROUP BY 1, 2, 3
  ORDER BY 1 DESC, 2, 3;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_ai_margin_daily(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ai_margin_daily(date) TO authenticated;

COMMIT;

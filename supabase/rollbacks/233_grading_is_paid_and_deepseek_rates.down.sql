-- Rollback 233: grading can be free again, and DeepSeek's rate rows go.
--
-- Restores the quote and the reservation to allocating free/trial units to every action, which
-- is the state where the run screen advertises "무료로 채점돼요 · N번 더 무료" on the one action
-- that repeats without limit.
DELETE FROM ai_pricing_config WHERE provider = 'deepseek'
   AND model IN ('deepseek-v4-flash', 'deepseek-v4-pro');

CREATE OR REPLACE FUNCTION public.get_ai_quiz_quote(p_action text, p_count integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid        uuid := auth.uid();
  v_today      date := (now() AT TIME ZONE 'UTC')::date;
  s            ai_pricing_settings%ROWTYPE;
  v_units_each smallint;
  v_total      integer;
  v_trial_left integer := 0;
  v_free_used  integer := 0;
  v_free_left  integer;
  v_alloc      record;
  v_balance    bigint := 0;
  v_held       bigint := 0;
  v_price      bigint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;

  SELECT units INTO v_units_each FROM ai_quiz_price_units WHERE action = p_action;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown quiz action' USING errcode = 'invalid_parameter_value';
  END IF;

  SELECT * INTO s FROM ai_pricing_settings WHERE id = 1;
  IF p_count IS NULL OR p_count < 1 THEN
    RAISE EXCEPTION 'count must be positive' USING errcode = 'invalid_parameter_value';
  END IF;
  v_total := v_units_each * p_count;

  SELECT COALESCE(units_remaining, 0) INTO v_trial_left FROM ai_quiz_trial WHERE user_id = v_uid;
  SELECT COALESCE(free_quiz_units_used, 0) INTO v_free_used
    FROM ai_generation_usage WHERE user_id = v_uid AND usage_date = v_today;
  v_free_left := GREATEST(0, s.free_quiz_units_per_day - COALESCE(v_free_used, 0));

  SELECT * INTO v_alloc FROM _ai_quiz_allocate(v_total, COALESCE(v_trial_left, 0), v_free_left);
  v_price := v_alloc.paid_units::bigint * s.quiz_unit_price_micro;

  SELECT COALESCE(balance, 0) INTO v_balance FROM ai_credit_balance WHERE user_id = v_uid;
  SELECT COALESCE(sum((quiz_units_held - quiz_free_held - quiz_trial_held)::bigint * quiz_unit_price), 0)
    INTO v_held
    FROM ai_generation_jobs
   WHERE user_id = v_uid AND quiz_units_done IS NULL AND quiz_units_held > 0
     AND NOT charged AND NOT refunded;

  RETURN jsonb_build_object(
    'action', p_action,
    'count', p_count,
    'units_each', v_units_each,
    'units_total', v_total,
    'trial_units', v_alloc.trial_units,
    'free_units', v_alloc.free_units,
    'paid_units', v_alloc.paid_units,
    'unit_price_micro', s.quiz_unit_price_micro,
    'price_micro', v_price,
    'balance_micro', COALESCE(v_balance, 0),
    'held_micro', v_held,
    'free_remaining_today', v_free_left,
    'trial_remaining', COALESCE(v_trial_left, 0),
    'max_units_per_call', s.quiz_max_units_per_call,
    'sufficient', COALESCE(v_balance, 0) >= v_held + v_price
  );
END;
$function$

;
CREATE OR REPLACE FUNCTION public.reserve_ai_quiz(p_action text, p_count integer, p_client_ref uuid, p_max_price_micro bigint, p_deck_id uuid DEFAULT NULL::uuid, p_card_ids uuid[] DEFAULT '{}'::uuid[], p_set_id uuid DEFAULT NULL::uuid, p_run_item_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_stale      record;
  c_max_requests constant integer := 300;
  c_stale_after  constant interval := '30 minutes';
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

  -- ── NEW: reclaim this caller's own abandoned holds ────────────────────────
  --
  -- Before the balance gate, because a stale hold is exactly what would make the
  -- gate refuse a request the learner can afford. Scoped to the caller: nobody
  -- else's hold can block this balance, so nobody else's needs touching here, and
  -- keeping it narrow keeps a normal reserve from scanning the whole table.
  --
  -- Returning free/trial units and writing no ledger row is what settling at zero
  -- does, which is the correct treatment of work that was never delivered.
  -- Inlined rather than calling `settle_ai_quiz`: that function requires service_role,
  -- and SECURITY DEFINER does not change `auth.role()` — it still reads the caller's
  -- JWT claim, which is `authenticated`. (Found by the test, which is the only reason
  -- this is not a runtime failure on the first abandoned hold.)
  --
  -- A zero-delivery settle is small and unambiguous anyway: hand the free and trial
  -- units back, stamp the job, write NO ledger row and NO cost row. Nothing was
  -- delivered, so nothing is owed and there is no provider cost to attribute.
  FOR v_stale IN
    SELECT id, quiz_free_held, quiz_trial_held, usage_date
      FROM ai_generation_jobs
     WHERE user_id = v_uid
       AND job_kind IN ('quiz_generate', 'quiz_grade')
       AND quiz_units_done IS NULL AND quiz_units_held > 0
       AND NOT charged AND NOT refunded
       AND created_at < now() - c_stale_after
     FOR UPDATE SKIP LOCKED
  LOOP
    IF v_stale.quiz_trial_held > 0 THEN
      UPDATE ai_quiz_trial SET units_remaining = units_remaining + v_stale.quiz_trial_held
       WHERE user_id = v_uid;
    END IF;
    IF v_stale.quiz_free_held > 0 THEN
      UPDATE ai_generation_usage
         SET free_quiz_units_used = GREATEST(0, free_quiz_units_used - v_stale.quiz_free_held)
       WHERE user_id = v_uid AND usage_date = v_stale.usage_date;
    END IF;
    UPDATE ai_generation_jobs
       SET quiz_units_done = 0, refunded = true
     WHERE id = v_stale.id;
  END LOOP;

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
$function$

;

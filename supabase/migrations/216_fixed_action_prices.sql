-- 216: sell a KNOWN price, not whatever the tokens came to.
--
-- Two of the four paid paths priced by measuring the call and applying a markup. That is what
-- made 214's missing price row cost a learner 43x, and it is what made the same explanation
-- cost 1,095 one hour and 50,325 the next — the number moved because Google's did.
--
-- The quiz never had this problem, and not by luck: `ai_quiz_price_units` maps an action to a
-- number of units and `quiz_unit_price_micro` is a list price the owner sets. A missing model
-- rate cannot touch it. This migration gives remediation and card generation the same shape.
--
-- ## How
--
-- `ai_generation_jobs.fixed_price_micro`, set at reserve time. When it is present,
-- `charge_ai_generation` charges exactly that and ignores the token arithmetic. Cost is still
-- measured and still written to `ai_cost_ledger`, because margin reporting is the reason that
-- ledger exists — what changes is that the measurement no longer reaches the learner.
--
-- ## The prices
--
-- One credit is 1,000 micro-USD, which is what the quiz has been using all along
-- (quiz_unit_price_micro 5,000 = 5 credits per unit). Set against measured cost on the DEAREST
-- model in the chain, so a fallback can never sell below cost:
--
--     action              cost/unit   floor (x10)   price     margin at typical
--     card                    366        3,660     10,000      27x
--     explanation           1,023       10,230     50,000      49x
--
-- Cost is well under 1% of either price. These are retail numbers chosen against what a month
-- of use should come to, with the floor as a guard rail underneath — see
-- packages/web/src/lib/__tests__/price-floor.test.ts, which fails if a price ever drops below
-- ten times what the most expensive model in the chain would charge to serve it.
--
-- The free daily card allowance is untouched: only `paid_cards` are priced, so a learner inside
-- the allowance still pays nothing.
BEGIN;

ALTER TABLE public.ai_generation_jobs
  ADD COLUMN IF NOT EXISTS fixed_price_micro bigint;

COMMENT ON COLUMN public.ai_generation_jobs.fixed_price_micro IS
  'List price agreed at reserve time. When set, charge_ai_generation bills exactly this and '
  'ignores token cost — cost is still recorded in ai_cost_ledger for margin reporting.';

CREATE TABLE IF NOT EXISTS public.ai_action_prices (
  action      text PRIMARY KEY,
  price_micro bigint NOT NULL CHECK (price_micro >= 0),
  note        text NOT NULL DEFAULT '',
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_action_prices ENABLE ROW LEVEL SECURITY;
-- Readable by a signed-in learner so a screen can show the price BEFORE the button is pressed,
-- which is the whole point of a fixed price.
DROP POLICY IF EXISTS "Anyone signed in can read action prices" ON public.ai_action_prices;
CREATE POLICY "Anyone signed in can read action prices" ON public.ai_action_prices
  FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.ai_action_prices TO authenticated;
GRANT ALL    ON public.ai_action_prices TO service_role;

INSERT INTO public.ai_action_prices (action, price_micro, note) VALUES
  ('card',                10000, '10 credits per card'),
  ('remediation_explain', 50000, '50 credits per explanation')
ON CONFLICT (action) DO NOTHING;

CREATE OR REPLACE FUNCTION public._ai_action_price(p_action text)
  RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT price_micro FROM ai_action_prices WHERE action = p_action $$;
REVOKE EXECUTE ON FUNCTION public._ai_action_price(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._ai_action_price(text) TO authenticated, service_role;

-- ── charge: honour a fixed price when the job carries one ───────────────────
CREATE OR REPLACE FUNCTION public.charge_ai_generation(
  p_user_id uuid, p_job_ref text, p_provider text, p_model text,
  p_tokens_in integer, p_tokens_out integer
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  j public.ai_generation_jobs%ROWTYPE;
  s public.ai_pricing_settings%ROWTYPE;
  v_in bigint; v_out bigint; v_missing boolean := false; v_estimated boolean := false;
  v_cost_usd bigint; v_cost_won bigint;
  v_markup numeric; v_paid_share numeric;
  v_price bigint := 0; v_margin bigint; v_bps integer; v_bal bigint;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Not authorized to charge' USING errcode = '42501';
  END IF;
  IF p_user_id IS NULL OR p_job_ref IS NULL THEN RETURN jsonb_build_object('charged', false); END IF;

  SELECT * INTO j FROM ai_generation_jobs WHERE id = p_job_ref AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND OR j.charged OR j.refunded THEN RETURN jsonb_build_object('charged', false); END IF;

  -- Quiz jobs are priced per unit by settle_ai_quiz, not per card by markup.
  IF j.job_kind IN ('quiz_generate', 'quiz_grade') THEN
    RETURN jsonb_build_object('charged', false, 'reason', 'quiz_uses_settle');
  END IF;

  SELECT * INTO s FROM ai_pricing_settings WHERE id = 1;
  v_markup := 10000.0 / GREATEST(1, 10000 - s.target_margin_bps);
  v_paid_share := CASE
    WHEN j.image_jobs > 0 THEN 1.0
    WHEN (j.free_cards + j.paid_cards) = 0 THEN 0
    ELSE j.paid_cards::numeric / (j.free_cards + j.paid_cards)
  END;

  IF p_tokens_in IS NULL OR p_tokens_out IS NULL OR p_tokens_in < 0 OR p_tokens_out < 0
     OR (p_tokens_in + p_tokens_out) = 0 THEN
    v_estimated := true;
    v_cost_won := NULL;
  ELSE
    SELECT in_rate, out_rate INTO v_in, v_out FROM _ai_resolve_rate(p_provider, p_model);
    IF NOT FOUND OR v_in IS NULL THEN
      v_in := s.fallback_in_micro_usd; v_out := s.fallback_out_micro_usd; v_missing := true;
    END IF;
    v_cost_usd := (p_tokens_in::bigint * v_in + p_tokens_out::bigint * v_out) / 1000000;
    v_cost_won := round(v_cost_usd * s.usd_won_rate)::bigint;
  END IF;

  -- THE CHANGE. A job that agreed a price at reserve time is billed that price; the token
  -- arithmetic above still ran, and still lands in the ledger, but it no longer decides what
  -- the learner pays.
  IF j.fixed_price_micro IS NOT NULL THEN
    v_price := j.fixed_price_micro;
  ELSIF NOT v_estimated THEN
    v_price := round(v_cost_won * v_paid_share * v_markup)::bigint;
  END IF;

  v_margin := CASE WHEN v_cost_won IS NOT NULL THEN v_price - v_cost_won END;
  v_bps    := CASE WHEN v_price > 0 AND v_margin IS NOT NULL
                   THEN (v_margin * 10000 / v_price)::integer END;

  INSERT INTO ai_cost_ledger (job_ref, user_id, provider, model, tokens_in, tokens_out,
      cost_usd_micros, cost_won_micros, price_won_micros, margin_won_micros, margin_bps,
      rate_missing, estimated, under_target)
    VALUES (p_job_ref, p_user_id, p_provider, p_model,
      COALESCE(p_tokens_in, 0), COALESCE(p_tokens_out, 0),
      v_cost_usd, v_cost_won, v_price, v_margin, v_bps,
      v_missing, v_estimated, (v_bps IS NOT NULL AND v_bps < s.target_margin_bps))
    ON CONFLICT (job_ref) DO NOTHING;

  IF v_price > 0 THEN
    UPDATE ai_credit_balance SET balance = balance - v_price, updated_at = now()
      WHERE user_id = p_user_id RETURNING balance INTO v_bal;
    IF FOUND THEN
      INSERT INTO ai_credit_ledger (user_id, delta, reason, ref, balance_after)
        VALUES (p_user_id, -v_price, 'spend', p_job_ref, v_bal);
    END IF;
  END IF;

  UPDATE ai_generation_jobs SET price_micro_won = v_price, charged = true WHERE id = p_job_ref;
  RETURN jsonb_build_object('charged', true, 'price_micro_won', v_price, 'estimated', v_estimated, 'balance', v_bal);
END;
$$;

COMMIT;

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

-- ── remediation: a list price, agreed before the model is called ────────────
BEGIN;

CREATE OR REPLACE FUNCTION public.reserve_ai_remediation(
  p_action text,
  p_goal_id uuid DEFAULT NULL,
  p_activity_id uuid DEFAULT NULL,
  p_attempt_id uuid DEFAULT NULL,
  p_card_ids uuid[] DEFAULT '{}'::uuid[],
  p_concept_ids uuid[] DEFAULT '{}'::uuid[]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_ref text := gen_random_uuid()::text;
  v_balance bigint;
  v_requests integer;
  v_id uuid;
  v_existing_id uuid;
  v_existing_content jsonb;
  v_price bigint;
  c_max_requests constant integer := 300;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;
  IF p_action NOT IN ('explain','compare','hint','generate','evaluate','recommend') THEN
    RAISE EXCEPTION 'Invalid remediation action' USING errcode = 'invalid_parameter_value';
  END IF;
  IF cardinality(COALESCE(p_card_ids, '{}'::uuid[])) > 50
     OR cardinality(COALESCE(p_concept_ids, '{}'::uuid[])) > 50 THEN
    RAISE EXCEPTION 'Too many remediation references' USING errcode = 'check_violation';
  END IF;
  IF p_goal_id IS NULL AND p_activity_id IS NULL AND p_attempt_id IS NULL
     AND cardinality(COALESCE(p_card_ids, '{}'::uuid[])) = 0
     AND cardinality(COALESCE(p_concept_ids, '{}'::uuid[])) = 0 THEN
    RAISE EXCEPTION 'Remediation requires a structured learning reference' USING errcode = 'invalid_parameter_value';
  END IF;

  IF p_goal_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM learning_goals WHERE id = p_goal_id AND user_id = v_uid AND status <> 'archived'
  ) THEN RAISE EXCEPTION 'Goal not accessible' USING errcode = '42501'; END IF;

  IF p_activity_id IS NOT NULL AND NOT public._check_activity_access(v_uid, p_activity_id) THEN
    RAISE EXCEPTION 'Activity not accessible' USING errcode = '42501';
  END IF;

  IF p_attempt_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM answer_attempts WHERE id = p_attempt_id AND user_id = v_uid
  ) THEN RAISE EXCEPTION 'Attempt not accessible' USING errcode = '42501'; END IF;

  FOREACH v_id IN ARRAY COALESCE(p_card_ids, '{}'::uuid[]) LOOP
    IF NOT public._check_card_access(v_uid, v_id) THEN
      RAISE EXCEPTION 'Card not accessible' USING errcode = '42501';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM unnest(COALESCE(p_concept_ids, '{}'::uuid[])) requested(id)
    LEFT JOIN learning_concepts c ON c.id = requested.id
    WHERE c.id IS NULL OR NOT (
      c.owner_user_id = v_uid OR (
        c.owner_user_id IS NULL AND (
          p_goal_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM learning_goal_concepts gc
            WHERE gc.goal_id = p_goal_id AND gc.concept_id = c.id
          )
        )
      )
    )
  ) THEN RAISE EXCEPTION 'Concept not accessible' USING errcode = '42501'; END IF;

  -- ── Bought already? ────────────────────────────────────────────────────────
  --
  -- After the ownership checks, so a caller cannot probe another learner's history for the
  -- existence of an explanation, and before the balance check, so replay works with an empty
  -- wallet — the learner is being handed something they have already paid for.
  --
  -- Only when an attempt anchors the request. Without one the references are a loose bag of
  -- card ids with no natural identity, and a false replay would hand back an answer about a
  -- different question. Refusing to dedupe there is the conservative direction.
  IF p_attempt_id IS NOT NULL THEN
    -- Serializes two presses that arrive together. Transaction-scoped, so it is released at
    -- COMMIT — it orders the lookups, and the in-flight check below is what covers the much
    -- longer window while the model is thinking.
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_uid::text || '|' || p_attempt_id::text || '|' || p_action, 0));

    SELECT id, content INTO v_existing_id, v_existing_content
      FROM user_enrichments
     WHERE user_id = v_uid AND attempt_id = p_attempt_id AND action = p_action
     ORDER BY created_at DESC
     LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'replay', true,
        'enrichment_id', v_existing_id,
        'content', v_existing_content,
        'job_kind', 'remediation');
    END IF;

    -- Reserved, not yet settled, and recent: the model has not answered yet. Two minutes is
    -- comfortably longer than a generation and short enough that an abandoned job frees the
    -- feature again on its own.
    IF EXISTS (
      SELECT 1 FROM ai_generation_jobs
       WHERE user_id = v_uid
         AND remediation_attempt_id = p_attempt_id
         AND job_kind = 'remediation'
         AND charged = false AND refunded = false
         AND created_at > now() - interval '2 minutes'
    ) THEN
      RAISE EXCEPTION 'Remediation already in flight' USING errcode = '55006';
    END IF;
  END IF;

  -- The LIST PRICE, agreed before the model is called. The old gate was `balance > 0`, which
  -- let a learner with a single micro-USD commit to a call and then go negative — survivable
  -- while the charge followed cost, not survivable once the price is fixed in advance.
  v_price := COALESCE(public._ai_action_price('remediation_explain'), 0);
  SELECT balance INTO v_balance FROM ai_credit_balance WHERE user_id = v_uid FOR UPDATE;
  IF COALESCE(v_balance, 0) < GREATEST(v_price, 1) THEN
    RAISE EXCEPTION 'Insufficient AI wallet balance' USING errcode = 'P0002';
  END IF;

  INSERT INTO ai_generation_usage (user_id, usage_date) VALUES (v_uid, v_today)
    ON CONFLICT (user_id, usage_date) DO NOTHING;
  SELECT req_count INTO v_requests FROM ai_generation_usage
    WHERE user_id = v_uid AND usage_date = v_today FOR UPDATE;
  IF v_requests + 1 > c_max_requests THEN
    RAISE EXCEPTION 'AI generation request cap exceeded' USING errcode = 'check_violation';
  END IF;
  UPDATE ai_generation_usage SET req_count = req_count + 1
    WHERE user_id = v_uid AND usage_date = v_today;

  -- paid_cards=1 keeps the existing actual-cost charge function's paid_share at 1.
  INSERT INTO ai_generation_jobs
    (id, user_id, usage_date, free_cards, paid_cards, image_jobs, job_kind, billable_fraction,
     remediation_attempt_id, fixed_price_micro)
  VALUES (v_ref, v_uid, v_today, 0, 1, 0, 'remediation', 1.0, p_attempt_id, NULLIF(v_price, 0));

  RETURN jsonb_build_object(
    'job_ref', v_ref, 'billable_fraction', 1.0, 'job_kind', 'remediation', 'replay', false,
    'price_micro', v_price);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.reserve_ai_remediation(text, uuid, uuid, uuid, uuid[], uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_ai_remediation(text, uuid, uuid, uuid, uuid[], uuid[])
  TO authenticated;

COMMIT;

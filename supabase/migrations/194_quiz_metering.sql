-- ============================================================================
-- 194: Quiz metering — hold at reserve, debit at settle, charge only what shipped
--
-- ── Why quiz cannot reuse the card meter ────────────────────────────────────
--
-- `reserve_ai_generation` counts CARDS and `charge_ai_generation` prices them by
-- pro-rata paid share. A quiz job has no cards, so `v_paid_share` falls to its
-- `(free_cards + paid_cards) = 0` branch and returns 0 — and then still stamps
-- `charged = true`. A quiz that rode that path would be free forever AND would leave
-- its hold permanently stuck, because settle finds the job already charged and
-- returns. So `charge_ai_generation` is taught to refuse quiz jobs outright below,
-- rather than being relied on to compute zero.
--
-- ── Why the price is a list price, not a cost multiple ──────────────────────
--
-- Everything else here is priced at `10000 / (10000 - target_margin_bps)` over
-- measured provider cost — 5x at the current 8000 bps. Applied to quiz that produces
-- a business that cannot exist: grading one short answer costs about $0.0002 on
-- flash-lite, so a $4.99 pack would buy ~24,000 gradings. There is no usage level at
-- which that is revenue.
--
-- `quiz_unit_price_micro` is therefore owner-set and NOT derived from cost.
-- `refresh_ai_est_price()` must never be pointed at it: the moment this follows cost
-- again, the feature's revenue converges to zero. The defensible number is what a
-- learner spends per month, not the multiple over a fraction of a cent.
--
-- ── Why reserve does not take the money ─────────────────────────────────────
--
-- The obvious design — debit at reserve, refund on failure — is unsafe here, and the
-- reason is in the refund machinery rather than in this file. `_ai_pack_already_used`
-- decides whether a purchased pack may still be refunded by summing ledger rows with
-- `delta < 0 AND reason <> 'refund'`. A debit followed by a compensating positive row
-- does not cancel: the negative row stays in that sum forever. A failed generation
-- would therefore burn the learner's statutory refund right on a pack they never got
-- to use.
--
-- So reserve places a HOLD — a job row with `quiz_units_held` and no ledger write —
-- and the balance gate compares against the sum of outstanding holds. Money moves
-- exactly once, at settle, for units actually delivered. There is no `refund_quiz`
-- reason because there is nothing to refund.
--
-- ── Why free units are not wallet credits ───────────────────────────────────
--
-- The daily allowance and the one-time trial are counters, not balance. Granting them
-- as credits would put positive rows in `ai_credit_ledger` that the refund arithmetic
-- above would have to reason about, and would let a free allowance be spent on card
-- generation. They are units, they expire, and they never touch the wallet.
--
-- ── Prices ──────────────────────────────────────────────────────────────────
--
--   1 unit = $0.005.  generate mcq/short 2, essay 3.  grade short 2, essay 8.
--   grade_mcq is ABSENT from the price table on purpose: deterministic index compare,
--   zero marginal cost, and an action with no row cannot be reserved, so it cannot be
--   billed by accident.
--   Free: 10 units/day, plus a one-time 60-unit trial — enough to generate and grade a
--   whole ten-question set, because a learner who meets a paywall before ever seeing
--   the feature work will not buy it.
-- ============================================================================

BEGIN;

-- ── 1) Job kinds and the quiz columns on the job row ────────────────────────
ALTER TABLE public.ai_generation_jobs DROP CONSTRAINT IF EXISTS ai_generation_jobs_job_kind_check;
ALTER TABLE public.ai_generation_jobs ADD CONSTRAINT ai_generation_jobs_job_kind_check
  CHECK (job_kind IN ('legacy_generation', 'cards', 'template', 'deck', 'image', 'remediation',
                      'quiz_generate', 'quiz_grade'));

ALTER TABLE public.ai_generation_jobs
  ADD COLUMN IF NOT EXISTS quiz_action      text,
  ADD COLUMN IF NOT EXISTS quiz_units_held  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quiz_free_held   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quiz_trial_held  integer NOT NULL DEFAULT 0,
  -- NULL until settled. This is the delivery marker the hold sweeper needs: without
  -- it there is no way to tell an in-flight job from an abandoned one.
  ADD COLUMN IF NOT EXISTS quiz_units_done  integer,
  -- The unit price quoted to the learner, frozen at reserve. An owner changing the
  -- price mid-flight must not change what an approved job costs.
  ADD COLUMN IF NOT EXISTS quiz_unit_price  bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quiz_set_id      uuid REFERENCES quiz_sets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quiz_run_item_id uuid REFERENCES quiz_run_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS client_ref       uuid;

-- Idempotency key. One user gesture = one client_ref = at most one job, so a retried
-- request after a dropped response reserves nothing new.
CREATE UNIQUE INDEX IF NOT EXISTS ai_generation_jobs_client_ref
  ON public.ai_generation_jobs (user_id, client_ref) WHERE client_ref IS NOT NULL;

-- Outstanding holds are scanned on every reserve.
CREATE INDEX IF NOT EXISTS idx_ai_jobs_open_quiz_holds
  ON public.ai_generation_jobs (user_id)
  WHERE quiz_units_done IS NULL AND quiz_units_held > 0 AND NOT charged AND NOT refunded;

-- ── 2) The ledger learns one new reason ─────────────────────────────────────
ALTER TABLE public.ai_credit_ledger DROP CONSTRAINT IF EXISTS ai_credit_ledger_reason_check;
ALTER TABLE public.ai_credit_ledger ADD CONSTRAINT ai_credit_ledger_reason_check
  CHECK (reason IN ('purchase', 'spend', 'refund', 'admin_grant', 'spend_cards', 'spend_image',
                    'admin_adjustment', 'spend_quiz'));

-- ── 3) Pricing knobs ────────────────────────────────────────────────────────
ALTER TABLE public.ai_pricing_settings
  ADD COLUMN IF NOT EXISTS quiz_unit_price_micro   bigint  NOT NULL DEFAULT 5000,
  ADD COLUMN IF NOT EXISTS free_quiz_units_per_day integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS quiz_trial_units        integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS quiz_max_units_per_call integer NOT NULL DEFAULT 40;

COMMENT ON COLUMN public.ai_pricing_settings.quiz_unit_price_micro IS
  'micro-USD per quiz unit. A LIST price, owner-set. refresh_ai_est_price() must never touch it: quiz grading costs ~$0.0002, so cost-following pricing drives this feature revenue to zero at every usage level.';

ALTER TABLE public.ai_generation_usage
  ADD COLUMN IF NOT EXISTS free_quiz_units_used integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_quiz_units_used integer NOT NULL DEFAULT 0;

-- ── 4) The closed price list ────────────────────────────────────────────────
--
-- reserve JOINs this, so an action absent from the table cannot be reserved at all.
-- That is the mechanism that makes free operations structurally free rather than
-- free-by-convention.
CREATE TABLE public.ai_quiz_price_units (
  action     text PRIMARY KEY CHECK (action IN
               ('generate_mcq', 'generate_short', 'generate_essay', 'grade_short', 'grade_essay')),
  units      smallint NOT NULL CHECK (units BETWEEN 1 AND 20),
  job_kind   text NOT NULL CHECK (job_kind IN ('quiz_generate', 'quiz_grade')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_quiz_price_units ENABLE ROW LEVEL SECURITY;  -- no policy: deny all

INSERT INTO public.ai_quiz_price_units (action, units, job_kind) VALUES
  ('generate_mcq',   2, 'quiz_generate'),
  ('generate_short', 2, 'quiz_generate'),
  ('generate_essay', 3, 'quiz_generate'),
  ('grade_short',    2, 'quiz_grade'),
  ('grade_essay',    8, 'quiz_grade');

COMMENT ON TABLE public.ai_quiz_price_units IS
  'Closed price list. grade_mcq is deliberately absent — index comparison has no marginal cost, and an action with no row here cannot be reserved, so it cannot be charged by mistake.';

-- ── 5) One-time trial units ─────────────────────────────────────────────────
CREATE TABLE public.ai_quiz_trial (
  user_id         uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  units_remaining integer NOT NULL DEFAULT 0 CHECK (units_remaining >= 0),
  granted_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_quiz_trial ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner can read own trial" ON public.ai_quiz_trial
  FOR SELECT USING (auth.uid() = user_id);
GRANT SELECT ON public.ai_quiz_trial TO authenticated;
GRANT ALL ON public.ai_quiz_trial, public.ai_quiz_price_units TO service_role;

-- ── 6) Allocation, shared by the quote and the reserve ──────────────────────
--
-- Trial first, then today's free allowance, then paid. One implementation so a quote
-- and the charge that follows it cannot disagree — the learner is shown a price and
-- then billed by the same arithmetic.
CREATE OR REPLACE FUNCTION public._ai_quiz_allocate(
  p_units integer, p_trial_left integer, p_free_left integer,
  OUT trial_units integer, OUT free_units integer, OUT paid_units integer
) RETURNS record
  LANGUAGE sql IMMUTABLE
AS $$
  SELECT t, f, GREATEST(0, p_units - t - f)
  FROM (SELECT LEAST(GREATEST(p_units, 0), GREATEST(p_trial_left, 0)) AS t) a,
       LATERAL (SELECT LEAST(GREATEST(p_units, 0) - a.t, GREATEST(p_free_left, 0)) AS f) b;
$$;

-- ── 7) The quote. Moves no money; the client never multiplies a price itself. ─
CREATE OR REPLACE FUNCTION public.get_ai_quiz_quote(p_action text, p_count integer)
  RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
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
$$;
REVOKE EXECUTE ON FUNCTION public.get_ai_quiz_quote(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ai_quiz_quote(text, integer) TO authenticated;

-- ── 8) Reserve. The order of the body below IS the contract. ────────────────
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

  -- (2) Price list. An action with no row cannot be reserved, which is how grade_mcq
  -- stays free by construction rather than by remembering not to charge for it.
  SELECT units, job_kind INTO v_units_each, v_job_kind
    FROM ai_quiz_price_units WHERE action = p_action;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown quiz action' USING errcode = 'invalid_parameter_value';
  END IF;

  SELECT * INTO s FROM ai_pricing_settings WHERE id = 1;

  -- (3) Size. Grading is one submission at a time; batching answers would make a
  -- partial failure unattributable to a specific answer.
  IF p_count IS NULL OR p_count < 1 THEN
    RAISE EXCEPTION 'count must be positive' USING errcode = 'invalid_parameter_value';
  END IF;
  IF v_job_kind = 'quiz_grade' AND p_count <> 1 THEN
    RAISE EXCEPTION 'grading reserves one answer at a time' USING errcode = 'invalid_parameter_value';
  END IF;
  v_total := v_units_each * p_count;
  -- Deliberately NOT 23514. Every existing branch maps 23514 to "daily request limit
  -- exceeded", so a learner who picked too many cards would be shown a cap they are
  -- nowhere near, in their own language.
  IF v_total > s.quiz_max_units_per_call THEN
    RAISE EXCEPTION 'Quiz request too large' USING errcode = 'P0009';
  END IF;

  -- (4) Access checks BEFORE the idempotent early return. A replayed client_ref must
  -- not become a way to smuggle another tenant's card ids into a service-role read.
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
  -- Ownership checked directly, NOT via _check_activity_access: that helper treats
  -- owner_user_id IS NULL as accessible to everyone, which is exactly the shape quiz
  -- was kept out of learning_activities to avoid.
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

  -- (5) Idempotency. Serialised per (user, client_ref) so two concurrent retries of
  -- the same gesture cannot both insert.
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

  -- (6) Daily request cap, unchanged in meaning from the other reserve paths.
  INSERT INTO ai_generation_usage (user_id, usage_date) VALUES (v_uid, v_today)
    ON CONFLICT (user_id, usage_date) DO NOTHING;
  SELECT req_count, COALESCE(free_quiz_units_used, 0) INTO v_requests, v_free_used
    FROM ai_generation_usage WHERE user_id = v_uid AND usage_date = v_today FOR UPDATE;
  IF v_requests + 1 > c_max_requests THEN
    RAISE EXCEPTION 'AI generation request cap exceeded' USING errcode = 'check_violation';
  END IF;

  -- (7) Allocate trial -> free -> paid, then honour the price the learner approved.
  SELECT COALESCE(units_remaining, 0) INTO v_trial_left
    FROM ai_quiz_trial WHERE user_id = v_uid FOR UPDATE;
  v_free_left := GREATEST(0, s.free_quiz_units_per_day - v_free_used);
  SELECT * INTO v_alloc FROM _ai_quiz_allocate(v_total, COALESCE(v_trial_left, 0), v_free_left);
  v_price := v_alloc.paid_units::bigint * s.quiz_unit_price_micro;

  IF v_price > p_max_price_micro THEN
    RAISE EXCEPTION 'Price changed since the quote' USING errcode = 'P0008';
  END IF;

  -- (8) Balance gate only. No ledger write — see the header on why a debit here would
  -- consume the learner's refund right on a pack they never used.
  SELECT COALESCE(balance, 0) INTO v_balance FROM ai_credit_balance WHERE user_id = v_uid FOR UPDATE;
  SELECT COALESCE(sum((quiz_units_held - quiz_free_held - quiz_trial_held)::bigint * quiz_unit_price), 0)
    INTO v_held
    FROM ai_generation_jobs
   WHERE user_id = v_uid AND quiz_units_done IS NULL AND quiz_units_held > 0
     AND NOT charged AND NOT refunded;
  IF COALESCE(v_balance, 0) < v_held + v_price THEN
    RAISE EXCEPTION 'Insufficient AI wallet balance' USING errcode = 'P0002';
  END IF;

  -- (9) Consume the free side now; settle returns whatever is not delivered.
  IF v_alloc.trial_units > 0 THEN
    UPDATE ai_quiz_trial SET units_remaining = units_remaining - v_alloc.trial_units
     WHERE user_id = v_uid;
  END IF;
  UPDATE ai_generation_usage
     SET req_count = req_count + 1,
         free_quiz_units_used = free_quiz_units_used + v_alloc.free_units,
         paid_quiz_units_used = paid_quiz_units_used + v_alloc.paid_units
   WHERE user_id = v_uid AND usage_date = v_today;

  -- (10) The hold. Card counters stay at zero: this job bills no cards and no images,
  -- and charge_ai_generation is taught below to refuse it outright.
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
REVOKE EXECUTE ON FUNCTION public.reserve_ai_quiz(text, integer, uuid, bigint, uuid, uuid[], uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_ai_quiz(text, integer, uuid, bigint, uuid, uuid[], uuid, uuid)
  TO authenticated;

-- ── 9) Settle. Charges for delivered units only. ────────────────────────────
--
-- The allocation is re-run over what was actually delivered rather than pro-rated.
-- Pro-rating would produce prices like 933 micro-USD that correspond to no row in
-- ai_quiz_price_units, which would break the one promise this design makes to the
-- learner: the number quoted before confirming is the number charged.
CREATE OR REPLACE FUNCTION public.settle_ai_quiz(
  p_user_id   uuid,
  p_job_ref   text,
  p_delivered integer,
  p_provider  text DEFAULT NULL,
  p_model     text DEFAULT NULL,
  p_tokens_in integer DEFAULT NULL,
  p_tokens_out integer DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  j            ai_generation_jobs%ROWTYPE;
  s            ai_pricing_settings%ROWTYPE;
  v_units_each smallint;
  v_delivered_units integer;
  v_alloc      record;
  v_price      bigint := 0;
  v_bal        bigint;
  v_in bigint; v_out bigint; v_missing boolean := false;
  v_cost_usd bigint := 0; v_cost_won bigint := 0; v_margin bigint; v_bps integer;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Not authorized to settle' USING errcode = '42501';
  END IF;
  IF p_user_id IS NULL OR p_job_ref IS NULL THEN
    RETURN jsonb_build_object('settled', false);
  END IF;

  SELECT * INTO j FROM ai_generation_jobs
   WHERE id = p_job_ref AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND OR j.job_kind NOT LIKE 'quiz@_%' ESCAPE '@' THEN
    RETURN jsonb_build_object('settled', false, 'reason', 'not_a_quiz_job');
  END IF;
  IF j.quiz_units_done IS NOT NULL OR j.charged OR j.refunded THEN
    RETURN jsonb_build_object('settled', false, 'reason', 'already');
  END IF;

  SELECT * INTO s FROM ai_pricing_settings WHERE id = 1;
  SELECT units INTO v_units_each FROM ai_quiz_price_units WHERE action = j.quiz_action;
  v_delivered_units := LEAST(j.quiz_units_held,
                             GREATEST(0, COALESCE(p_delivered, 0)) * COALESCE(v_units_each, 1));

  -- Re-run the same allocation over the delivered units, using the split this job
  -- already holds. Free and trial units come off first, so an under-delivery gives
  -- back paid units before free ones — in the learner's favour.
  SELECT * INTO v_alloc FROM _ai_quiz_allocate(v_delivered_units, j.quiz_trial_held, j.quiz_free_held);
  v_price := v_alloc.paid_units::bigint * j.quiz_unit_price;

  -- Return the undelivered free side.
  IF j.quiz_trial_held - v_alloc.trial_units > 0 THEN
    UPDATE ai_quiz_trial
       SET units_remaining = units_remaining + (j.quiz_trial_held - v_alloc.trial_units)
     WHERE user_id = p_user_id;
  END IF;
  UPDATE ai_generation_usage
     SET free_quiz_units_used = GREATEST(0, free_quiz_units_used - (j.quiz_free_held - v_alloc.free_units)),
         paid_quiz_units_used = GREATEST(0, paid_quiz_units_used
                                  - ((j.quiz_units_held - j.quiz_free_held - j.quiz_trial_held)
                                     - v_alloc.paid_units))
   WHERE user_id = p_user_id AND usage_date = j.usage_date;

  -- Cost is recorded even when the price is fixed, because margin observation is the
  -- only thing that will tell us if a model change makes a unit unprofitable.
  IF p_tokens_in IS NOT NULL AND p_tokens_out IS NOT NULL
     AND p_tokens_in >= 0 AND p_tokens_out >= 0 AND (p_tokens_in + p_tokens_out) > 0 THEN
    SELECT in_rate, out_rate INTO v_in, v_out FROM _ai_resolve_rate(p_provider, p_model);
    IF NOT FOUND OR v_in IS NULL THEN
      v_in := s.fallback_in_micro_usd; v_out := s.fallback_out_micro_usd; v_missing := true;
    END IF;
    v_cost_usd := (p_tokens_in::bigint * v_in + p_tokens_out::bigint * v_out) / 1000000;
    v_cost_won := round(v_cost_usd * s.usd_won_rate)::bigint;
  END IF;
  v_margin := v_price - v_cost_won;
  v_bps := CASE WHEN v_price > 0 THEN (v_margin * 10000 / v_price)::integer END;
  INSERT INTO ai_cost_ledger (job_ref, user_id, provider, model, tokens_in, tokens_out,
      cost_usd_micros, cost_won_micros, price_won_micros, margin_won_micros, margin_bps,
      rate_missing, estimated, under_target)
    VALUES (p_job_ref, p_user_id, p_provider, p_model,
      COALESCE(p_tokens_in, 0), COALESCE(p_tokens_out, 0),
      NULLIF(v_cost_usd, 0), NULLIF(v_cost_won, 0), v_price, v_margin, v_bps,
      v_missing, p_tokens_in IS NULL, false)
    ON CONFLICT (job_ref) DO NOTHING;

  IF v_price > 0 THEN
    UPDATE ai_credit_balance SET balance = balance - v_price, updated_at = now()
      WHERE user_id = p_user_id RETURNING balance INTO v_bal;
    IF FOUND THEN
      INSERT INTO ai_credit_ledger (user_id, delta, reason, ref, balance_after)
        VALUES (p_user_id, -v_price, 'spend_quiz', p_job_ref, v_bal);
    END IF;
  END IF;

  UPDATE ai_generation_jobs
     SET quiz_units_done = v_delivered_units,
         price_micro_won = v_price,
         charged  = (v_price > 0),
         refunded = (v_delivered_units = 0)
   WHERE id = p_job_ref;

  RETURN jsonb_build_object('settled', true, 'delivered_units', v_delivered_units,
                            'paid_units', v_alloc.paid_units, 'price_micro', v_price,
                            'balance', v_bal);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.settle_ai_quiz(uuid, text, integer, text, text, integer, integer)
  FROM PUBLIC, anon, authenticated;

-- ── 10) Reclaim abandoned holds ─────────────────────────────────────────────
--
-- A hold whose request died in flight would otherwise block the learner's balance
-- forever. This is possible now only because `quiz_units_done` exists as a delivery
-- marker; the equivalent sweep for card jobs was abandoned for the lack of one.
CREATE OR REPLACE FUNCTION public.sweep_ai_quiz_holds(p_older_than interval DEFAULT '30 minutes')
  RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_n integer := 0; r record;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Not authorized' USING errcode = '42501';
  END IF;
  FOR r IN
    SELECT * FROM ai_generation_jobs
     WHERE job_kind IN ('quiz_generate', 'quiz_grade')
       AND quiz_units_done IS NULL AND NOT charged AND NOT refunded
       AND created_at < now() - p_older_than
     FOR UPDATE SKIP LOCKED
  LOOP
    -- Settling at zero returns the free units and writes no ledger row, which is
    -- exactly what an abandoned hold deserves.
    PERFORM public.settle_ai_quiz(r.user_id, r.id, 0, NULL, NULL, NULL, NULL);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.sweep_ai_quiz_holds(interval) FROM PUBLIC, anon, authenticated;

-- ── 11) Teach the existing money functions about quiz ───────────────────────
--
-- charge_ai_generation would otherwise compute a zero price for a quiz job (no cards,
-- so paid_share falls to 0) AND stamp charged = true, after which settle_ai_quiz
-- returns 'already' and the hold is stuck forever. Refusing is not a safety net here;
-- it is the difference between a working meter and a permanently frozen balance.
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
    INSERT INTO ai_cost_ledger (job_ref, user_id, provider, model, tokens_in, tokens_out,
        cost_usd_micros, cost_won_micros, price_won_micros, margin_won_micros, margin_bps,
        rate_missing, estimated, under_target)
      VALUES (p_job_ref, p_user_id, p_provider, p_model, 0, 0,
        NULL, NULL, 0, NULL, NULL, false, true, false)
      ON CONFLICT (job_ref) DO NOTHING;
  ELSE
    SELECT in_rate, out_rate INTO v_in, v_out FROM _ai_resolve_rate(p_provider, p_model);
    IF NOT FOUND OR v_in IS NULL THEN
      v_in := s.fallback_in_micro_usd; v_out := s.fallback_out_micro_usd; v_missing := true;
    END IF;
    v_cost_usd := (p_tokens_in::bigint * v_in + p_tokens_out::bigint * v_out) / 1000000;
    v_cost_won := round(v_cost_usd * s.usd_won_rate)::bigint;
    v_price    := round(v_cost_won * v_paid_share * v_markup)::bigint;
    v_margin   := v_price - v_cost_won;
    v_bps      := CASE WHEN v_price > 0 THEN (v_margin * 10000 / v_price)::integer END;
    INSERT INTO ai_cost_ledger (job_ref, user_id, provider, model, tokens_in, tokens_out,
        cost_usd_micros, cost_won_micros, price_won_micros, margin_won_micros, margin_bps,
        rate_missing, estimated, under_target)
      VALUES (p_job_ref, p_user_id, p_provider, p_model, p_tokens_in, p_tokens_out,
        v_cost_usd, v_cost_won, v_price, v_margin, v_bps,
        v_missing, false, (v_bps IS NOT NULL AND v_bps < s.target_margin_bps))
      ON CONFLICT (job_ref) DO NOTHING;
  END IF;

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

-- release_ai_job decremented CARD counters for any job that was not 'remediation'.
-- A released quiz job would therefore reduce free_cards_used and paid_cards_used it
-- never incremented — a silent, permanent leak of the daily free card allowance.
CREATE OR REPLACE FUNCTION public.release_ai_job(p_user_id uuid, p_job_ref text)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE j public.ai_generation_jobs%ROWTYPE;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Not authorized to release' USING errcode = '42501';
  END IF;
  IF p_user_id IS NULL OR p_job_ref IS NULL THEN RETURN; END IF;
  SELECT * INTO j FROM ai_generation_jobs WHERE id = p_job_ref AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND OR j.refunded OR j.charged THEN RETURN; END IF;

  IF j.job_kind IN ('quiz_generate', 'quiz_grade') THEN
    -- Give back the units, not card counters, and never touch the wallet: reserve
    -- took no money, so there is nothing to return there.
    IF j.quiz_trial_held > 0 THEN
      UPDATE ai_quiz_trial SET units_remaining = units_remaining + j.quiz_trial_held
       WHERE user_id = p_user_id;
    END IF;
    UPDATE ai_generation_usage
       SET free_quiz_units_used = GREATEST(0, free_quiz_units_used - j.quiz_free_held),
           paid_quiz_units_used = GREATEST(0, paid_quiz_units_used
                                    - (j.quiz_units_held - j.quiz_free_held - j.quiz_trial_held))
     WHERE user_id = p_user_id AND usage_date = j.usage_date;
    UPDATE ai_generation_jobs SET refunded = true, quiz_units_done = 0 WHERE id = p_job_ref;
    RETURN;
  END IF;

  IF j.job_kind <> 'remediation' THEN
    UPDATE ai_generation_usage
       SET free_cards_used = GREATEST(0, free_cards_used - j.free_cards),
           paid_cards_used = GREATEST(0, paid_cards_used - j.paid_cards),
           image_jobs = GREATEST(0, image_jobs - j.image_jobs)
     WHERE user_id = p_user_id AND usage_date = j.usage_date;
  END IF;
  UPDATE ai_generation_jobs SET refunded = true WHERE id = p_job_ref;
END;
$$;

-- ── 12) Owner-facing knobs ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_quiz_pricing(
  p_unit_price_micro   bigint  DEFAULT NULL,
  p_free_units_per_day integer DEFAULT NULL,
  p_trial_units        integer DEFAULT NULL,
  p_max_units_per_call integer DEFAULT NULL,
  p_action             text    DEFAULT NULL,
  p_action_units       smallint DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING errcode = '42501';
  END IF;
  IF (p_unit_price_micro IS NOT NULL AND p_unit_price_micro < 0)
     OR (p_free_units_per_day IS NOT NULL AND p_free_units_per_day < 0)
     OR (p_trial_units IS NOT NULL AND p_trial_units < 0)
     OR (p_max_units_per_call IS NOT NULL AND p_max_units_per_call < 1) THEN
    RAISE EXCEPTION 'Invalid quiz pricing value' USING errcode = 'invalid_parameter_value';
  END IF;

  UPDATE ai_pricing_settings
     SET quiz_unit_price_micro   = COALESCE(p_unit_price_micro, quiz_unit_price_micro),
         free_quiz_units_per_day = COALESCE(p_free_units_per_day, free_quiz_units_per_day),
         quiz_trial_units        = COALESCE(p_trial_units, quiz_trial_units),
         quiz_max_units_per_call = COALESCE(p_max_units_per_call, quiz_max_units_per_call),
         updated_at = now()
   WHERE id = 1;

  IF p_action IS NOT NULL AND p_action_units IS NOT NULL THEN
    UPDATE ai_quiz_price_units SET units = p_action_units, updated_at = now()
     WHERE action = p_action;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Unknown quiz action' USING errcode = 'invalid_parameter_value';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'settings', (SELECT to_jsonb(x) FROM (
        SELECT quiz_unit_price_micro, free_quiz_units_per_day, quiz_trial_units,
               quiz_max_units_per_call FROM ai_pricing_settings WHERE id = 1) x),
    'actions', (SELECT jsonb_object_agg(action, units) FROM ai_quiz_price_units));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_set_quiz_pricing(bigint, integer, integer, integer, text, smallint)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_quiz_pricing(bigint, integer, integer, integer, text, smallint)
  TO authenticated;

-- ── 13) The trial grant ─────────────────────────────────────────────────────
--
-- Called the first time a learner opens quiz. Not on signup: a grant that expires
-- unseen buys nothing, and `reserve_ai_remediation` already demonstrates what a
-- balance-gated feature looks like to someone with an empty wallet.
CREATE OR REPLACE FUNCTION public.grant_ai_quiz_trial()
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_units integer;
  v_row   ai_quiz_trial%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;
  SELECT quiz_trial_units INTO v_units FROM ai_pricing_settings WHERE id = 1;

  -- Once per account, ever. ON CONFLICT DO NOTHING is the whole enforcement: a second
  -- call finds the row and returns what is left rather than topping it up.
  INSERT INTO ai_quiz_trial (user_id, units_remaining)
    VALUES (v_uid, COALESCE(v_units, 0))
    ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_row FROM ai_quiz_trial WHERE user_id = v_uid;
  RETURN jsonb_build_object('units_remaining', v_row.units_remaining, 'granted_at', v_row.granted_at);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.grant_ai_quiz_trial() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_ai_quiz_trial() TO authenticated;

COMMIT;

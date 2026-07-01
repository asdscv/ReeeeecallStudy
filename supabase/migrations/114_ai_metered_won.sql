-- ============================================================================
-- 114: Metered micro-WON billing — replace fixed credits with post-generation
-- actual-cost deduction (price = real provider cost x markup, 80% margin).
--
-- Owner-confirmed model:
--   * SELL fixed WON packs (IAP/PortOne) → top up a micro-WON wallet (add_ai_credits).
--   * FREE first 10 cards/day → charge 0 (absorbed).
--   * PAID (cards 11+, all images) → charge POST-generation: price = (real cost of
--     the paid share) x markup, markup = 10000/(10000 - target_margin_bps) = 5 at 80%.
--   * PRE-gen: gate only (reject 402 if paid work & wallet <= 0); NO amount reserved
--     (tokens unknown until the call returns). The last batch may dip slightly
--     negative — accepted; the gate blocks the next call.
--   * FAILURE: charge never runs → nothing deducted → net-zero automatically.
--
-- Flow split:  reserve_ai_generation (pre-gen gate, race-safe free accounting)
--            + charge_ai_generation  (post-gen, prices from tokens, deducts)
--            + release_ai_job         (failure → reverse counters, no wallet touch)
-- This PROMOTES the 112/113 cost layer from observation to the live pricing engine
-- (finalize_ai_cost folded into charge_ai_generation). Supersedes 108-111 charging.
--
-- Design of record: DOCS/TODO/AI-METERED-BILLING-DESIGN.md. develop-only (empty
-- wallet, prod unserved). All money math micro-unit bigint. Depends on 108-113.
-- ============================================================================
BEGIN;

-- ── 1) Wallet tables → micro-WON (1 unit = 1e-6 KRW). Widen int→bigint (a ₩5000
--       pack = 5e9 micro-WON overflows int). Allow slight negative. ──
TRUNCATE public.ai_credit_balance, public.ai_credit_ledger;  -- develop/CI reset ONLY (no real balances exist)

ALTER TABLE public.ai_credit_balance DROP CONSTRAINT IF EXISTS ai_credit_balance_balance_check;  -- allow one-batch negative
ALTER TABLE public.ai_credit_balance ALTER COLUMN balance TYPE bigint;
ALTER TABLE public.ai_credit_balance ALTER COLUMN balance SET DEFAULT 0;
COMMENT ON COLUMN public.ai_credit_balance.balance IS 'micro-WON (1e-6 KRW); may dip one-batch negative post-charge';

ALTER TABLE public.ai_credit_ledger ALTER COLUMN delta TYPE bigint;
ALTER TABLE public.ai_credit_ledger ALTER COLUMN balance_after TYPE bigint;
ALTER TABLE public.ai_credit_ledger DROP CONSTRAINT IF EXISTS ai_credit_ledger_reason_check;
ALTER TABLE public.ai_credit_ledger ADD CONSTRAINT ai_credit_ledger_reason_check
  CHECK (reason IN ('purchase','spend','refund','admin_grant','spend_cards','spend_image'));  -- new writes use 'spend'; old kept for history
COMMENT ON COLUMN public.ai_credit_ledger.delta IS 'micro-WON (1e-6 KRW)';

-- ── 2) Job row: charged amount + once-only latch ──
ALTER TABLE public.ai_generation_jobs
  ADD COLUMN IF NOT EXISTS price_micro_won bigint,
  ADD COLUMN IF NOT EXISTS charged boolean NOT NULL DEFAULT false;

-- ── 3) UI-quote seam: an estimated price/card (tunable via set_ai_pricing_settings-style, no migration) ──
ALTER TABLE public.ai_pricing_settings
  ADD COLUMN IF NOT EXISTS est_price_per_card_micro bigint NOT NULL DEFAULT 2000000;  -- ₩2 seed (refine from ai_cost_ledger avg)
CREATE OR REPLACE FUNCTION public._ai_est_price_per_card() RETURNS bigint
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT est_price_per_card_micro FROM ai_pricing_settings WHERE id = 1 $$;
REVOKE EXECUTE ON FUNCTION public._ai_est_price_per_card() FROM PUBLIC, anon, authenticated;

-- ── 4) add_ai_credits → grants micro-WON (widen p_credits int→bigint). Body/idempotency unchanged. ──
DROP FUNCTION IF EXISTS public.add_ai_credits(uuid, integer, text, text);
CREATE OR REPLACE FUNCTION public.add_ai_credits(
    p_user_id uuid, p_micro_won bigint, p_reason text, p_ref text DEFAULT NULL)
  RETURNS bigint  -- balance after (micro-WON), or current balance if duplicate ref
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_bal bigint;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Not authorized to grant balance' USING errcode = '42501';
  END IF;
  IF p_user_id IS NULL OR p_micro_won IS NULL OR p_micro_won <= 0 THEN
    RAISE EXCEPTION 'Invalid balance grant' USING errcode = 'invalid_parameter_value';
  END IF;
  -- idempotent: a positive grant with this ref already landed → no-op
  IF p_ref IS NOT NULL AND EXISTS (SELECT 1 FROM ai_credit_ledger WHERE ref = p_ref AND delta > 0) THEN
    RETURN COALESCE((SELECT balance FROM ai_credit_balance WHERE user_id = p_user_id), 0);
  END IF;
  INSERT INTO ai_credit_balance (user_id, balance) VALUES (p_user_id, p_micro_won)
    ON CONFLICT (user_id) DO UPDATE
      SET balance = ai_credit_balance.balance + EXCLUDED.balance, updated_at = now()
    RETURNING balance INTO v_bal;
  INSERT INTO ai_credit_ledger (user_id, delta, reason, ref, balance_after)
    VALUES (p_user_id, p_micro_won, COALESCE(p_reason, 'admin_grant'), p_ref, v_bal);
  RETURN v_bal;
EXCEPTION WHEN unique_violation THEN
  RETURN COALESCE((SELECT balance FROM ai_credit_balance WHERE user_id = p_user_id), 0);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.add_ai_credits(uuid, bigint, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.add_ai_credits(uuid, bigint, text, text) TO service_role;

-- ── 5) PRE-GEN GATE — reserve_ai_generation (authenticated). Free/paid split +
--       empty-wallet gate + job row, all under the FOR UPDATE lock. NO money moved. ──
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

  -- GATE (no deduct): never do paid provider work for an empty wallet.
  IF v_paid > 0 THEN
    SELECT balance INTO v_bal FROM ai_credit_balance WHERE user_id = v_uid;
    IF COALESCE(v_bal, 0) <= 0 THEN
      RAISE EXCEPTION 'Insufficient AI wallet balance' USING errcode = 'P0002';
    END IF;
  END IF;

  UPDATE ai_generation_usage
     SET free_cards_used = free_cards_used + v_free,
         paid_cards_used = paid_cards_used + v_paid,
         req_count       = req_count + 1
   WHERE user_id = v_uid AND usage_date = v_today;

  INSERT INTO ai_generation_jobs (id, user_id, usage_date, free_cards, paid_cards, image_jobs)
    VALUES (v_ref, v_uid, v_today, v_free, v_paid, 0);

  RETURN jsonb_build_object(
    'remaining_free', GREATEST(0, c_free - (v_used + v_free)),
    'free_now', v_free, 'paid_now', v_paid, 'job_ref', v_ref
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.reserve_ai_generation(text, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.reserve_ai_generation(text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.reserve_ai_image()
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid  uuid   := auth.uid();
  v_today date  := (now() AT TIME ZONE 'UTC')::date;
  v_reqs integer; v_bal bigint;
  v_ref  text   := gen_random_uuid()::text;
  c_max_reqs constant integer := 300;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  INSERT INTO ai_generation_usage (user_id, usage_date) VALUES (v_uid, v_today)
    ON CONFLICT (user_id, usage_date) DO NOTHING;
  SELECT req_count INTO v_reqs
    FROM ai_generation_usage WHERE user_id = v_uid AND usage_date = v_today FOR UPDATE;
  IF v_reqs + 1 > c_max_reqs THEN
    RAISE EXCEPTION 'AI generation request cap exceeded' USING errcode = 'check_violation';
  END IF;
  -- always paid → gate on empty wallet
  SELECT balance INTO v_bal FROM ai_credit_balance WHERE user_id = v_uid;
  IF COALESCE(v_bal, 0) <= 0 THEN
    RAISE EXCEPTION 'Insufficient AI wallet balance' USING errcode = 'P0002';
  END IF;
  UPDATE ai_generation_usage SET image_jobs = image_jobs + 1, req_count = req_count + 1
   WHERE user_id = v_uid AND usage_date = v_today;
  INSERT INTO ai_generation_jobs (id, user_id, usage_date, free_cards, paid_cards, image_jobs)
    VALUES (v_ref, v_uid, v_today, 0, 0, 1);
  RETURN jsonb_build_object('job_ref', v_ref);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.reserve_ai_image() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.reserve_ai_image() TO authenticated;

-- ── 6) POST-GEN CHARGE — charge_ai_generation (service_role/admin). Prices from
--       real tokens, deducts the paid share x markup. Idempotent (charged latch +
--       ai_cost_ledger.job_ref UNIQUE). Records cost (folds in finalize_ai_cost). ──
CREATE OR REPLACE FUNCTION public.charge_ai_generation(
    p_user_id uuid, p_job_ref text, p_provider text, p_model text,
    p_tokens_in integer, p_tokens_out integer)
  RETURNS jsonb
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
  -- once-only, race-safe; refunded = a released (failed) job must never be charged
  IF NOT FOUND OR j.charged OR j.refunded THEN RETURN jsonb_build_object('charged', false); END IF;

  SELECT * INTO s FROM ai_pricing_settings WHERE id = 1;
  v_markup := 10000.0 / GREATEST(1, 10000 - s.target_margin_bps);                 -- 5.0 at 8000 bps
  v_paid_share := CASE
    WHEN j.image_jobs > 0 THEN 1.0                                     -- image = fully paid
    WHEN (j.free_cards + j.paid_cards) = 0 THEN 0                       -- template / deck
    ELSE j.paid_cards::numeric / (j.free_cards + j.paid_cards)         -- cards: pro-rata paid share
  END;

  IF p_tokens_in IS NULL OR p_tokens_out IS NULL OR p_tokens_in < 0 OR p_tokens_out < 0
     OR (p_tokens_in + p_tokens_out) = 0 THEN
    -- unpriceable (provider omitted usage) → charge 0, record honestly (absorb the rare loss)
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
    v_cost_usd := (p_tokens_in::bigint * v_in + p_tokens_out::bigint * v_out) / 1000000;  -- micro-USD (full call)
    v_cost_won := round(v_cost_usd * s.usd_won_rate)::bigint;                             -- micro-WON (full call)
    v_price    := round(v_cost_won * v_paid_share * v_markup)::bigint;                    -- charged (paid share x markup)
    v_margin   := v_price - v_cost_won;                                                   -- vs FULL cost (free = CAC drag)
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
      WHERE user_id = p_user_id RETURNING balance INTO v_bal;    -- NO balance>= guard → may dip negative
    IF FOUND THEN
      INSERT INTO ai_credit_ledger (user_id, delta, reason, ref, balance_after)
        VALUES (p_user_id, -v_price, 'spend', p_job_ref, v_bal);
    END IF;
  END IF;

  UPDATE ai_generation_jobs SET price_micro_won = v_price, charged = true WHERE id = p_job_ref;
  RETURN jsonb_build_object('charged', true, 'price_micro_won', v_price, 'estimated', v_estimated, 'balance', v_bal);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.charge_ai_generation(uuid, text, text, text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.charge_ai_generation(uuid, text, text, text, integer, integer)
  TO service_role;

-- ── 7) FAILURE — release_ai_job (service_role/admin). Reverse the free/paid/image
--       counters (a failed gen shouldn't burn the daily free allowance). NO wallet
--       touch (nothing was deducted pre-gen). Idempotent via `refunded` latch. ──
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
  IF NOT FOUND OR j.refunded OR j.charged THEN RETURN; END IF;   -- charged = succeeded → never release
  UPDATE ai_generation_usage
     SET free_cards_used = GREATEST(0, free_cards_used - j.free_cards),
         paid_cards_used = GREATEST(0, paid_cards_used - j.paid_cards),
         image_jobs      = GREATEST(0, image_jobs - j.image_jobs)
   WHERE user_id = p_user_id AND usage_date = j.usage_date;
  UPDATE ai_generation_jobs SET refunded = true WHERE id = p_job_ref;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.release_ai_job(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.release_ai_job(uuid, text) TO service_role;

-- ── 8) get_ai_wallet → micro-WON balance + the UI est-price. Signature change → DROP+CREATE ──
DROP FUNCTION IF EXISTS public.get_ai_wallet();
CREATE FUNCTION public.get_ai_wallet()
  RETURNS TABLE (balance_micro_won bigint, est_price_per_card_micro bigint)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  RETURN QUERY SELECT
    COALESCE((SELECT b.balance FROM ai_credit_balance b WHERE b.user_id = v_uid), 0)::bigint,
    public._ai_est_price_per_card();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_ai_wallet() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_ai_wallet() TO authenticated;

-- ── 9) preview_ai_cost → metered dry-run (price = cost x markup, no credits). Signature change → DROP+CREATE ──
DROP FUNCTION IF EXISTS public.preview_ai_cost(text, text, integer, integer, integer);
CREATE FUNCTION public.preview_ai_cost(
    p_provider text, p_model text, p_tokens_in integer, p_tokens_out integer)
  RETURNS TABLE (
    cost_usd_micros bigint, cost_won_micros bigint, price_won_micros bigint,
    margin_won_micros bigint, margin_bps integer,
    rate_missing boolean, estimated boolean)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  s public.ai_pricing_settings%ROWTYPE;
  v_in bigint; v_out bigint; v_missing boolean := false;
  v_cost_usd bigint; v_cost_won bigint; v_markup numeric; v_price bigint; v_margin bigint; v_bps integer;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Not authorized' USING errcode = '42501';
  END IF;
  SELECT * INTO s FROM ai_pricing_settings WHERE id = 1;
  IF p_tokens_in IS NULL OR p_tokens_out IS NULL OR p_tokens_in < 0 OR p_tokens_out < 0
     OR (p_tokens_in + p_tokens_out) = 0 THEN
    RETURN QUERY SELECT NULL::bigint, NULL::bigint, 0::bigint, NULL::bigint, NULL::integer, false, true;
    RETURN;
  END IF;
  SELECT in_rate, out_rate INTO v_in, v_out FROM _ai_resolve_rate(p_provider, p_model);
  IF NOT FOUND OR v_in IS NULL THEN
    v_in := s.fallback_in_micro_usd; v_out := s.fallback_out_micro_usd; v_missing := true;
  END IF;
  v_markup   := 10000.0 / GREATEST(1, 10000 - s.target_margin_bps);
  v_cost_usd := (p_tokens_in::bigint * v_in + p_tokens_out::bigint * v_out) / 1000000;
  v_cost_won := round(v_cost_usd * s.usd_won_rate)::bigint;
  v_price    := round(v_cost_won * v_markup)::bigint;   -- fully-paid price (paid_share = 1)
  v_margin   := v_price - v_cost_won;
  v_bps      := CASE WHEN v_price > 0 THEN (v_margin * 10000 / v_price)::integer END;
  RETURN QUERY SELECT v_cost_usd, v_cost_won, v_price, v_margin, v_bps, v_missing, false;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.preview_ai_cost(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.preview_ai_cost(text, text, integer, integer) TO service_role;

-- ── 9b) Harden set_ai_pricing_settings: target_margin_bps is now a live DIVISOR
--        (markup = 10000/(10000-bps)), so 100% (10000) must be rejected — it would
--        divide by zero → silent no-charge. Tighten the 112 bound `>10000` → `>=10000`. ──
CREATE OR REPLACE FUNCTION public.set_ai_pricing_settings(
    p_won_per_credit integer DEFAULT NULL, p_target_margin_bps integer DEFAULT NULL,
    p_usd_won_rate numeric DEFAULT NULL)
  RETURNS public.ai_pricing_settings
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r public.ai_pricing_settings;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Not authorized' USING errcode = '42501';
  END IF;
  IF (p_won_per_credit IS NOT NULL AND (p_won_per_credit <= 0 OR p_won_per_credit > 1000000))
     OR (p_target_margin_bps IS NOT NULL AND (p_target_margin_bps < 0 OR p_target_margin_bps >= 10000))  -- margin < 100%
     OR (p_usd_won_rate IS NOT NULL AND (p_usd_won_rate <= 0 OR p_usd_won_rate > 100000)) THEN
    RAISE EXCEPTION 'Invalid setting' USING errcode = 'invalid_parameter_value';
  END IF;
  UPDATE ai_pricing_settings SET
    won_per_credit    = COALESCE(p_won_per_credit, won_per_credit),
    target_margin_bps = COALESCE(p_target_margin_bps, target_margin_bps),
    usd_won_rate      = COALESCE(p_usd_won_rate, usd_won_rate),
    updated_at        = now()
  WHERE id = 1 RETURNING * INTO r;
  RETURN r;
END;
$$;

-- ── 10) Retire the fixed-credit charging path (superseded by reserve/charge/release) ──
DROP FUNCTION IF EXISTS public.record_ai_generation(text, integer);
DROP FUNCTION IF EXISTS public.record_ai_image();
DROP FUNCTION IF EXISTS public.finalize_ai_cost(uuid, text, text, text, integer, integer);  -- folded into charge_ai_generation
DROP FUNCTION IF EXISTS public.refund_ai_job(uuid, text);                                    -- → release_ai_job
DROP FUNCTION IF EXISTS public._ai_credits_per_card();
DROP FUNCTION IF EXISTS public._ai_credits_per_image();

COMMIT;

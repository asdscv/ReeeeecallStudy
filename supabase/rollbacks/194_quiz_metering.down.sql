-- Rollback for 194 (Quiz metering).
--
-- ── What this deliberately does NOT do ──────────────────────────────────────
--
-- It does not narrow `ai_credit_ledger.reason` back to the seven values it had, and it does not
-- narrow `ai_generation_jobs.job_kind`. Both CHECKs are DROPPED instead.
--
-- A ledger row is money that moved. Once a learner has been charged for a quiz there is a
-- `spend_quiz` row in the ledger, and re-adding the narrower CHECK would fail with 23514 —
-- correctly, because the alternative is deleting a record of a real charge. Same for job rows:
-- `ai_cost_ledger.job_ref` is NOT NULL with ON DELETE CASCADE, so removing a quiz job would take
-- its cost, price and margin history with it and leave the ledger's negative row pointing at a
-- job that no longer exists.
--
-- The consequence is stated plainly: after this rollback the two columns are unconstrained until
-- a later migration re-establishes a domain that includes whatever history exists. That is the
-- correct trade. A CHECK is a guard on new writes; it is not worth destroying settled accounts to
-- restore one.
--
-- The tables and columns added by 194 hold no money history of their own — the money lives in
-- ai_credit_ledger and ai_cost_ledger, which are untouched — so they are dropped.

BEGIN;

-- 1) Functions first, so nothing can call into half-removed state.
DROP FUNCTION IF EXISTS public.grant_ai_quiz_trial();
DROP FUNCTION IF EXISTS public.admin_set_quiz_pricing(bigint, integer, integer, integer, text, smallint);
DROP FUNCTION IF EXISTS public.sweep_ai_quiz_holds(interval);
DROP FUNCTION IF EXISTS public.settle_ai_quiz(uuid, text, integer, text, text, integer, integer);
DROP FUNCTION IF EXISTS public.reserve_ai_quiz(text, integer, uuid, bigint, uuid, uuid[], uuid, uuid);
DROP FUNCTION IF EXISTS public.get_ai_quiz_quote(text, integer);
DROP FUNCTION IF EXISTS public._ai_quiz_allocate(integer, integer, integer);

-- 2) Restore the two money functions to their pre-194 bodies.
--
-- charge_ai_generation loses the quiz guard; with quiz gone there is no job_kind it would fire
-- on. release_ai_job loses the quiz branch and returns to the single `<> 'remediation'` test.
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

-- 3) Drop the CHECKs rather than narrowing them. See the header.
ALTER TABLE public.ai_credit_ledger    DROP CONSTRAINT IF EXISTS ai_credit_ledger_reason_check;
ALTER TABLE public.ai_generation_jobs  DROP CONSTRAINT IF EXISTS ai_generation_jobs_job_kind_check;

-- 4) Tables and columns added by 194.
DROP TABLE IF EXISTS public.ai_quiz_trial;
DROP TABLE IF EXISTS public.ai_quiz_price_units;

DROP INDEX IF EXISTS public.idx_ai_jobs_open_quiz_holds;
DROP INDEX IF EXISTS public.ai_generation_jobs_client_ref;
ALTER TABLE public.ai_generation_jobs
  DROP COLUMN IF EXISTS quiz_action,
  DROP COLUMN IF EXISTS quiz_units_held,
  DROP COLUMN IF EXISTS quiz_free_held,
  DROP COLUMN IF EXISTS quiz_trial_held,
  DROP COLUMN IF EXISTS quiz_units_done,
  DROP COLUMN IF EXISTS quiz_unit_price,
  DROP COLUMN IF EXISTS quiz_set_id,
  DROP COLUMN IF EXISTS quiz_run_item_id,
  DROP COLUMN IF EXISTS client_ref;

ALTER TABLE public.ai_pricing_settings
  DROP COLUMN IF EXISTS quiz_unit_price_micro,
  DROP COLUMN IF EXISTS free_quiz_units_per_day,
  DROP COLUMN IF EXISTS quiz_trial_units,
  DROP COLUMN IF EXISTS quiz_max_units_per_call;

ALTER TABLE public.ai_generation_usage
  DROP COLUMN IF EXISTS free_quiz_units_used,
  DROP COLUMN IF EXISTS paid_quiz_units_used;

COMMIT;

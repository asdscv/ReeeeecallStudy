-- 250 되돌리기: 원장이 다시 무엇을 팔았는지 말하지 않게 됩니다.
--
-- 되돌리면 카드 생성·카드 설명·이미지·진단이 전부 `reason = 'spend'` 한 줄로 들어가고,
-- 화면은 그 넷을 같은 문구로 그립니다. 이미 기록된 종류별 행은 그대로 둡니다 — 원장은
-- 소급해서 고쳐 쓰는 것이 아닙니다.
BEGIN;

-- 함수를 먼저 되돌린 뒤에 CHECK 를 좁힙니다. 순서가 반대면 그 사이에 들어온 청구가 거부됩니다.
CREATE OR REPLACE FUNCTION public.charge_ai_generation(p_user_id uuid, p_job_ref text, p_provider text, p_model text, p_tokens_in integer, p_tokens_out integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      cost_usd_micros, cost_micro_usd, price_micro_usd, margin_micro_usd, margin_bps,
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

  UPDATE ai_generation_jobs SET price_micro_usd = v_price, charged = true WHERE id = p_job_ref;
  RETURN jsonb_build_object('charged', true, 'price_micro_usd', v_price, 'estimated', v_estimated, 'balance', v_bal);
END;
$function$;

-- 이미 기록된 spend_remediation / spend_diagnosis 행은 남겨야 하므로 CHECK 도 그 둘을
-- 계속 허용합니다. 좁히면 옛 행 때문에 ALTER 자체가 실패합니다.

COMMIT;

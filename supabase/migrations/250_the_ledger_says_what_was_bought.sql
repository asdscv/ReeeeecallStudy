-- 250: 사용 내역이 산 것을 말하지 않았습니다.
--
-- 화면에 이렇게 떴습니다:
--
--       AI 카드 생성   −$0.0012   8월 12일
--       AI 카드 생성   −$0.0014   8월 6일
--
-- 둘 다 카드 생성이 아닙니다. `ai_generation_jobs` 를 조회하면 `job_kind = 'remediation'`,
-- 즉 **카드 설명**을 산 것입니다. 소유자가 자기 사용 내역을 보고 "이거 왜 안 떠?"를 물었을 때
-- 정작 떠 있던 두 줄이 다른 물건이었습니다.
--
-- 원인은 `charge_ai_generation` 이 무엇을 팔았든 `reason = 'spend'` 하나만 쓰기 때문입니다.
-- 카드 생성·카드 설명·이미지·진단이 전부 그 한 줄로 들어가고, 화면은 그것을 문자열 하나
-- (`reason.spend = "AI 카드 생성"`)로 그립니다.
--
-- 로케일 파일에는 `spend_cards`, `spend_image` 키가 **이미 있습니다.** 처음부터 종류별로
-- 쓰려던 설계였는데 서버가 한 번도 그 값을 쓴 적이 없습니다.
--
-- 퀴즈는 이미 제대로 하고 있습니다 — `settle_ai_quiz` 는 `spend_quiz` 를 씁니다. 다만 그
-- 문자열의 번역이 어느 로케일에도 없어서, 화면이 `defaultValue` 로 **`spend_quiz`** 라는 날
-- 문자열을 그대로 보여주고 있었습니다(프로덕션에 52건). 그쪽은 같은 변경의 i18n 절반에서
-- 고칩니다.
--
-- 지난 행은 `spend` 그대로 둡니다. 그것들이 실제로 무엇이었는지는 `ref` 로 잡을 수 있지만,
-- 원장을 소급해 고쳐 쓰는 것은 원장이 하는 일이 아닙니다. 대신 `reason.spend` 문구를 종류를
-- 특정하지 않는 말로 바꿔, 옛 줄이 거짓말을 하지 않게 합니다.
--
-- 본문은 배포된 정의 그대로이고 INSERT 한 줄만 다릅니다.
BEGIN;

-- CHECK 가 곧 시행입니다. 이 목록에 없는 이유는 INSERT 가 거부되고, 그러면 청구 트랜잭션
-- 전체가 실패합니다 — 잔액은 안 빠지고 작업은 charged 로 못 넘어가는, 조용하지 않은 고장.
-- `spend_cards`/`spend_image`/`spend_quiz` 는 이미 허용돼 있었고(그래서 로케일 키도 있었고),
-- 설명과 진단만 없었습니다. 로컬에서 테스트가 먼저 이걸로 실패했습니다.
ALTER TABLE public.ai_credit_ledger DROP CONSTRAINT IF EXISTS ai_credit_ledger_reason_check;
ALTER TABLE public.ai_credit_ledger ADD CONSTRAINT ai_credit_ledger_reason_check
  CHECK (reason IN ('purchase','refund','admin_grant','admin_adjustment',
                    'spend','spend_cards','spend_image','spend_quiz',
                    'spend_remediation','spend_diagnosis'));

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
        VALUES (p_user_id, -v_price, CASE
                  WHEN j.image_jobs > 0 THEN 'spend_image'
                  WHEN j.job_kind = 'remediation' AND j.remediation_goal_id IS NOT NULL
                    THEN 'spend_diagnosis'
                  WHEN j.job_kind = 'remediation' THEN 'spend_remediation'
                  ELSE 'spend_cards'
                END, p_job_ref, v_bal);
    END IF;
  END IF;

  UPDATE ai_generation_jobs SET price_micro_usd = v_price, charged = true WHERE id = p_job_ref;
  RETURN jsonb_build_object('charged', true, 'price_micro_usd', v_price, 'estimated', v_estimated, 'balance', v_bal);
END;
$function$;

COMMIT;

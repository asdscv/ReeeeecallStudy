-- Down for 239: 무료 정책을 다시 `ai_pricing_settings`의 숫자 두 개와 코드 안의 하드코딩으로.
--
-- 되돌리는 것은 정책의 출처와 배분 단위입니다. 컬럼(`free_quiz_items_used`,
-- `quiz_free_items_held`, `quiz_trial_items_held`)과 테이블(`ai_free_allowances`)은 **남깁니다**:
-- 지우면 이 마이그레이션이 적용된 동안 예약된 작업들이 정산 시점에 홀드 정보를 잃습니다.
-- 읽는 코드가 없어지므로 남아 있어도 동작에는 영향이 없습니다.
--
-- 239가 적용된 동안 소비된 무료분은 `free_quiz_items_used`에만 기록됐을 수 있으므로, 되돌린
-- 직후 하루치 무료 유닛이 다시 열릴 수 있습니다. 학습자에게 유리한 방향이고, 반대로 하면
-- 이미 쓴 적 없는 무료분을 뺏는 것이 됩니다.
BEGIN;

CREATE OR REPLACE FUNCTION public._ai_free_cards_per_day()
  RETURNS integer
  LANGUAGE sql STABLE
  SET search_path TO 'public'
AS $$
  SELECT COALESCE((SELECT free_cards_per_day FROM public.ai_pricing_settings WHERE id = 1), 10)
$$;

CREATE OR REPLACE FUNCTION public.admin_set_ai_free_quota(p_free_cards_per_day integer)
  RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Admin only' USING errcode = '42501';
  END IF;
  IF p_free_cards_per_day IS NULL OR p_free_cards_per_day < 0 OR p_free_cards_per_day > 100000 THEN
    RAISE EXCEPTION 'free_cards_per_day out of range (0..100000)' USING errcode = 'invalid_parameter_value';
  END IF;
  UPDATE public.ai_pricing_settings SET free_cards_per_day = p_free_cards_per_day, updated_at = now() WHERE id = 1;
  RETURN p_free_cards_per_day;
END;
$$;

COMMIT;

-- reserve / quote / settle 는 233 시점의 본문으로 되돌립니다. 세 함수 모두 유닛 배분이고,
-- 채점이 무료가 아닌 것은 다시 `IF p_action LIKE 'grade\_%'` 하드코딩입니다.
--
-- 239 이후에 예약된 작업은 `quiz_free_items_held`를 갖고 있지만 유닛 홀드
-- (`quiz_free_held`)도 함께 기록돼 있으므로, 유닛 기준 정산이 그대로 성립합니다.
BEGIN;

CREATE OR REPLACE FUNCTION public.settle_ai_quiz(p_user_id uuid, p_job_ref text, p_delivered integer, p_provider text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_tokens_in integer DEFAULT NULL::integer, p_tokens_out integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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

  SELECT * INTO v_alloc FROM _ai_quiz_allocate(v_delivered_units, j.quiz_trial_held, j.quiz_free_held);
  v_price := v_alloc.paid_units::bigint * j.quiz_unit_price;

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
      cost_usd_micros, cost_micro_usd, price_micro_usd, margin_micro_usd, margin_bps,
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
         price_micro_usd = v_price,
         charged  = (v_price > 0),
         refunded = (v_delivered_units = 0)
   WHERE id = p_job_ref;

  RETURN jsonb_build_object('settled', true, 'delivered_units', v_delivered_units,
                            'paid_units', v_alloc.paid_units, 'price_micro', v_price,
                            'balance', v_bal);
END;
$function$;

COMMIT;

BEGIN;

-- ── get_ai_wallet_summary 도 되돌린다 ──────────────────────────────────────
--
-- 이걸 빼먹으면 롤백 후 지갑이 **영원히 "무료 문항 5개 남음"**이라고 말합니다. 되돌린 엔진은
-- `free_quiz_items_used`를 다시는 증가시키지 않으므로 그 숫자가 얼어붙습니다 — 그날 무료를
-- 다 쓴 학습자에게도 5/5로 보입니다. 233을 다시 실행해도 안 됩니다: 233은 이 함수를 정의하지
-- 않습니다.
CREATE OR REPLACE FUNCTION public.get_ai_wallet_summary()
 RETURNS json
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid        uuid    := auth.uid();
  v_today      date    := (now() AT TIME ZONE 'UTC')::date;
  v_free_limit integer := public._ai_free_cards_per_day();
  v_free_used  integer;
  s            ai_pricing_settings%ROWTYPE;
  v_quiz_used  integer;
  v_trial      integer;
  result       json;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT free_cards_used, COALESCE(free_quiz_units_used, 0)
    INTO v_free_used, v_quiz_used
    FROM ai_generation_usage
   WHERE user_id = v_uid AND usage_date = v_today;
  v_free_used := COALESCE(v_free_used, 0);
  v_quiz_used := COALESCE(v_quiz_used, 0);

  SELECT * INTO s FROM ai_pricing_settings WHERE id = 1;
  SELECT COALESCE(units_remaining, 0) INTO v_trial FROM ai_quiz_trial WHERE user_id = v_uid;

  SELECT json_build_object(
    'balance_micro_usd',        COALESCE((SELECT b.balance FROM ai_credit_balance b WHERE b.user_id = v_uid), 0),
    'est_price_per_card_micro', public._ai_est_price_per_card(),
    'free_limit',               v_free_limit,
    'free_used_today',          v_free_used,
    'free_remaining_today',     GREATEST(0, v_free_limit - v_free_used),
    'quiz_unit_price_micro',      s.quiz_unit_price_micro,
    'quiz_free_limit',            s.free_quiz_units_per_day,
    'quiz_free_used_today',       v_quiz_used,
    'quiz_free_remaining_today',  GREATEST(0, s.free_quiz_units_per_day - v_quiz_used),
    -- 클라이언트는 이 키를 선택적으로 읽습니다. 유닛 시절로 돌아갔다고 정직하게 말합니다.
    'quiz_free_unit_kind',        'unit',
    'quiz_trial_remaining',       COALESCE(v_trial, 0),
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
$function$;

COMMIT;

-- reserve_ai_quiz 와 get_ai_quiz_quote 의 233 본문은 마이그레이션 233 파일에 그대로 있습니다.
-- 여기서 복사해 두면 두 벌이 되고, 다음에 하나만 고쳐집니다:
--
--     psql -f supabase/migrations/233_grading_is_paid_and_deepseek_rates.sql
--
-- 를 이 롤백 다음에 실행하세요. (233은 두 함수를 통째로 CREATE OR REPLACE 합니다.)

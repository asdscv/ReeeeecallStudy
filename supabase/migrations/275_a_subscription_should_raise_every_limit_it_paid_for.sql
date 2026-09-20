-- 275: 구독은 자기가 값을 치른 모든 한도를 올려야 한다.
--
-- 출시 전 실사격 검증(L1)에서 재현된 두 결함을 닫는다. 둘 다 "지금 당장 증상이 없다"는
-- 공통점이 있고, 그래서 더 위험하다 — 다음 변경이 조용히 무효가 되는 형태다.
--
-- ── F-1. 결제가 AI 무료 배분 티어에 전파되지 않는다 ────────────────────────────
--
-- 결제 경로(`grant_subscription`, `sync_subscription_by_user`, `confirm_payment`)는 전부
-- `billing_subscriptions` 에만 쓴다. 그런데 `_ai_free_allowance` 는 레거시 `subscriptions`
-- 테이블만 읽었다. 그 테이블에 쓰는 것은 가입 트리거(`handle_new_user_subscription`, `free`
-- 1회)와 관리자 수동(`admin_set_subscription`) 둘뿐이라, **결제로는 영원히 갱신되지 않는다.**
--
-- 프로덕션 실측(2026-09-18): `subscriptions` 44행이 전부 `tier='free'` 였고, 그중에는 실제로
-- 결제했던 계정 2개가 포함돼 있었다. 같은 계정이 `billing_subscriptions` 에서는 `plan_5k` 다.
--
-- 오늘은 증상이 없다. `ai_free_allowances` 에 `plan_5k` 행이 없어 `_ai_free_allowance_for_tier`
-- 가 `free` 로 폴백하기 때문이다. 문제는 **"구독하면 AI 를 더 준다"를 켜려고 그 행을 추가하는
-- 순간** — 카드 한도는 오르고 AI 만 안 오르는, 돈 받고 일부만 주는 상태가 된다.
--
-- 고치는 방식: 한도 계산의 단일 출처를 `billing_subscriptions` 로 통일한다. 자격 판정
-- 술어(predicate)는 `_owned_card_limit` 의 것을 **그대로 복사**한다. 문구를 새로 쓰면 두
-- 권한이 다시 갈라질 수 있고, 그게 정확히 이 결함의 발생 경위다.
--
-- 동작 변화: **오늘 기준 없음.** `plan_5k` 에 배분 행이 없어 결과는 여전히 `free` 행이다.
-- 이 마이그레이션은 증상을 고치는 게 아니라 **레버를 연결한다.**
--
-- ── F-2. `ai_cost_ledger` 만 `auth.users` 로 가는 외래키가 없다 ──────────────────
--
-- 형제 테이블(`ai_credit_ledger`·`billing_subscriptions`·`subscriptions`·`decks`·`cards`·
-- `user_card_progress`)은 전부 CASCADE 인데 이것만 없다. 따라서 `delete_user_account()` 로
-- 계정을 지우면 **원가 원장 행이 고아로 남는다** — 존재하지 않는 유저의 비용을 마진
-- 대시보드가 계속 집계한다. L1 에서 실증됐다: AI 호출 1건이 남긴 1행이 유저 삭제 후에도
-- 그대로 있었다.
--
-- CASCADE 가 아니라 SET NULL 을 고른 이유: 이것은 **우리가 제공자에게 실제로 지불한 원가**의
-- 기록이다. 학습자가 계정을 지워도 그 지출은 일어났고 우리 청구서에 남는다. CASCADE 는 과거
-- 마진 집계를 소급해 바꾼다. SET NULL 은 금액을 보존하고 사람만 떼어낸다.
--
-- 안전성 확인(프로덕션 실측): `user_id` 를 읽는 함수는 `charge_ai_generation` 과
-- `settle_ai_quiz` 둘뿐이고 **둘 다 쓰기** 경로라 항상 실제 uuid 를 넣는다. 읽기·집계
-- (`get_ai_margin_daily`, `ai_unpriced_models`, `refresh_ai_est_price`)는 `user_id` 를 보지
-- 않는다. 따라서 NULL 허용은 어떤 소비자도 깨뜨리지 않는다. 현재 고아 행은 0개다.

-- ── F-1 ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._ai_free_allowance(p_user uuid, p_action_group text)
  RETURNS TABLE(per_day integer, unit_kind text, trial_applies boolean)
  LANGUAGE plpgsql
  STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE v_tier text;
BEGIN
  -- 술어는 _owned_card_limit 과 동일해야 한다. 한 구독이 카드 한도는 올리는데 AI 배분은
  -- 못 올리는 상태가 다시 생기지 않도록, 조건을 새로 쓰지 말고 저쪽을 따라간다.
  SELECT s.tier INTO v_tier
    FROM billing_subscriptions s
   WHERE s.user_id = p_user
     AND s.status IN ('active','canceled','grace','past_due')
     AND s.tier IS NOT NULL
     AND (
       (s.status = 'active'
          AND (s.current_period_end IS NULL OR s.current_period_end > now()))
       OR (s.status <> 'active'
          AND s.current_period_end IS NOT NULL
          AND s.current_period_end > now())
     )
   ORDER BY s.current_period_end DESC NULLS FIRST, s.created_at DESC
   LIMIT 1;

  -- 행이 없으면 'free'. _ai_free_allowance_for_tier 자체도 tier 행이 없으면 'free' 로,
  -- 그것도 없으면 0(=유료)으로 떨어진다 — 안전 방향 폴백 2단은 그대로 둔다.
  RETURN QUERY SELECT * FROM public._ai_free_allowance_for_tier(COALESCE(v_tier, 'free'), p_action_group);
END;
$function$;

-- ── F-2 ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.ai_cost_ledger
  ALTER COLUMN user_id DROP NOT NULL;

-- 삭제된 유저의 행을 찾을 때 순차 스캔하지 않도록. FK 자체가 요구하진 않지만,
-- 참조되는 쪽(auth.users)의 DELETE 는 이 인덱스가 없으면 전체를 훑는다.
CREATE INDEX IF NOT EXISTS ai_cost_ledger_user_id_idx
  ON public.ai_cost_ledger (user_id);

ALTER TABLE public.ai_cost_ledger
  ADD CONSTRAINT ai_cost_ledger_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- 277: 티어 조회가 관리자 경로를 떨어뜨리면 안 된다.
--
-- 275 가 `_ai_free_allowance` 의 티어 출처를 레거시 `subscriptions` 에서
-- `billing_subscriptions` 로 **옮겼다**. 결제가 AI 배분에 닿지 않던 F-1 을 고친 것은
-- 맞지만, 옮기면서 레거시 경로를 통째로 끊었다. CI 가 그것을 잡았다:
--
--   ai_free_allowance_test.sql:153
--   ERROR: FAIL: pro 티어가 무료 12문항을 못 받음 (free=5)
--
-- 그 테스트는 `UPDATE subscriptions SET tier='pro'` 로 티어를 세우고 배분이 따라오는지
-- 본다. 헤더가 요구사항을 이렇게 적어 뒀다: *"요구사항은 '무료 문항이 5개다'가 아닙니다.
-- 5를 8로 바꾸거나, **유료 티어에 20을 주거나**, 채점에 하루 한 건을 열어주는 데 배포가
-- 필요 없어야 한다는 것입니다."*
--
-- 그리고 그것은 테스트만의 사정이 아니다. **`admin_set_subscription` 이 실제로
-- `subscriptions` 에 쓴다.** 275 이후 관리자가 손으로 세운 티어는 카드 한도에는 반영되지
-- 않고(원래 그랬다) AI 배분에서도 사라졌다 — 고치려던 것과 같은 모양의 구멍을 반대편에
-- 새로 낸 셈이다.
--
-- 그래서 어느 한쪽을 고르지 않고 **우선순위를 명시한다**:
--
--   1) `billing_subscriptions` — 결제가 실제로 쓰는 곳. 돈을 낸 사람이 이긴다.
--   2) `subscriptions`         — 관리자 수동 경로와 레거시. 결제 기록이 없을 때만 본다.
--   3) 'free'                  — 둘 다 없으면.
--
-- 이것은 F-1 을 만든 "두 개의 진실"로 되돌아가는 것이 아니다. 그때의 문제는 두 테이블이
-- 있다는 것이 아니라 **한쪽만 읽고 다른 쪽에만 쓰면서 아무도 그 사실을 몰랐다**는 것이다.
-- 여기서는 순서가 코드에 적혀 있고, 왜 그 순서인지도 적혀 있다.
--
-- 술어는 계속 `_owned_card_limit` 의 것을 따른다(275 의 이유 그대로). 레거시 쪽은 그
-- 테이블이 쓰는 컬럼(`expires_at`/`started_at`)을 쓴다.

CREATE OR REPLACE FUNCTION public._ai_free_allowance(p_user uuid, p_action_group text)
  RETURNS TABLE(per_day integer, unit_kind text, trial_applies boolean)
  LANGUAGE plpgsql
  STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE v_tier text;
BEGIN
  -- 1) 결제가 쓰는 곳. 술어는 _owned_card_limit 과 동일하게 유지한다 — 한 구독이 카드
  --    한도는 올리는데 AI 배분은 못 올리는 상태가 다시 생기지 않도록.
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

  -- 2) 결제 기록이 없을 때만 레거시/관리자 경로를 본다.
  IF v_tier IS NULL THEN
    SELECT s.tier INTO v_tier
      FROM subscriptions s
     WHERE s.user_id = p_user
       AND s.status = 'active'
       AND (s.expires_at IS NULL OR s.expires_at > now())
     ORDER BY s.started_at DESC
     LIMIT 1;
  END IF;

  -- 3) 폴백. _ai_free_allowance_for_tier 안에도 'free' → 0 의 2단 폴백이 더 있다.
  RETURN QUERY SELECT * FROM public._ai_free_allowance_for_tier(COALESCE(v_tier, 'free'), p_action_group);
END;
$function$;

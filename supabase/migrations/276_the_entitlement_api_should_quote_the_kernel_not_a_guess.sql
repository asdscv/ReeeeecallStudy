-- 276: 엔타이틀먼트 API 는 커널을 인용해야지, 짐작을 인용하면 안 된다.
--
-- 275 가 F-1 의 본체(_ai_free_allowance 가 레거시 테이블을 읽던 것)를 닫았는데, 같은 가족의
-- 결함이 하나 더 있었다. 275 를 적용하고 하네스를 다시 돌려 확인한 것이다.
--
-- `get_my_entitlements` 는 `free_ai_cards_per_day` 를 이렇게 읽고 있었다:
--
--     (SELECT per_day FROM ai_free_allowances WHERE tier = 'free' AND action_group = 'card')
--                                                   ^^^^^^^^^^^^^^
--
-- 티어가 **하드코딩**돼 있다. 호출자가 유료 구독자여도 무료 티어의 숫자를 돌려준다.
-- 같은 함수의 다른 필드들은 전부 커널을 거친다 — `_effective_tier`, `_owned_card_limit`,
-- `_entitlement`. 이 한 줄만 표를 직접 찔렀고, 그래서 혼자 뒤처졌다.
--
-- 증상이 보이는 곳: 구독한 유저의 클라이언트가 받는 응답이
--   {"tier":"plan_5k","is_paid":true,"cards_total":100000, ... ,"free_ai_cards_per_day":10}
-- 으로, tier 와 cards_total 은 유료를 말하는데 AI 만 무료 티어 값을 말한다.
--
-- 지금은 두 값이 우연히 같다(`ai_free_allowances` 에 `plan_5k` 행이 없어 커널도 free 로
-- 폴백한다). 275 와 똑같은 함정이다 — **행을 추가하는 순간 이 한 줄만 조용히 뒤처진다.**
-- 275 로 플러그를 연결해 놓고 이걸 두면, 서버는 제대로 계산하는데 화면은 옛 숫자를 광고하는
-- 더 나쁜 상태가 된다.
--
-- 고치는 방식: 다른 필드와 똑같이 커널(`_ai_free_allowance`)을 부른다. 티어 판정은 한 군데
-- (`billing_subscriptions` 를 읽는 275 의 술어)에서만 일어나야 한다.
--
-- 동작 변화: 없음. 오늘은 커널도 free 행으로 떨어진다. 연결만 바로잡는다.

CREATE OR REPLACE FUNCTION public.get_my_entitlements()
  RETURNS jsonb
  LANGUAGE sql
  STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'tier',                  public._effective_tier(auth.uid()),
    'is_paid',               public._effective_tier(auth.uid()) <> 'free',
    -- 광고 없음 = 유료. 지금은 광고가 없지만, 붙일 때 클라이언트가 읽을 자리를 미리 둡니다.
    'ads_free',              public._effective_tier(auth.uid()) <> 'free',
    -- 카드는 구독 스냅샷이라 표가 아니라 그쪽에서 옵니다(위 헤더 참고).
    'cards_total',           public._owned_card_limit(auth.uid()),
    'decks_total',           public._entitlement(auth.uid(), 'decks_total'),
    'templates_total',       public._entitlement(auth.uid(), 'templates_total'),
    'study_sessions_daily',  public._entitlement(auth.uid(), 'study_sessions_daily'),
    -- 276: 표를 직접 찌르지 않는다. 티어 판정은 커널 한 군데에서만 일어난다.
    'free_ai_cards_per_day', (SELECT per_day FROM public._ai_free_allowance(auth.uid(), 'card'))
  ) WHERE auth.uid() IS NOT NULL;
$function$;

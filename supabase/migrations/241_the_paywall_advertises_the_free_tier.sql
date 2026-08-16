-- 241: 유료 요금제를 추가하는 순간 결제 안내가 거짓말을 하게 되어 있었습니다.
--
-- `get_plan_limits()`는 비로그인 사용자도 부르는 결제 안내용 엔드포인트입니다. "무료 요금제는
-- 하루 카드 몇 장까지" — 즉 **아직 가입하지 않은 사람에게 무료 티어가 무엇인지** 알려주는
-- 함수입니다. 그런데 239가 `_ai_free_cards_per_day()`를 `auth.uid()`의 티어를 읽도록 바꾸면서,
-- 이 함수도 **부르는 사람의 티어**를 읽게 됐습니다.
--
-- 오늘은 아무 차이가 없습니다. 정책 테이블에 'free' 행만 있으므로 모든 티어가 폴백으로 같은
-- 숫자를 받습니다 — 리뷰어가 anon/free/pro 세 경우를 실제로 확인했고 셋 다 10이었습니다.
--
-- 문제는 **그게 바뀌는 시점이 정확히 이 커널이 광고하는 그 순간**이라는 것입니다:
--
--     INSERT INTO ai_free_allowances VALUES ('pro', 'card', 200, 'item', false);
--
-- 이 한 줄을 넣는 순간, pro 사용자가 보는 결제 안내는 "무료 요금제: 하루 200장"이 됩니다.
-- 자기 한도를 무료 티어의 설명으로 읽는 것입니다. 그리고 그 한 줄은 이 커널을 만든 이유
-- 그 자체라, 언젠가 반드시 들어옵니다.
--
-- 그래서 조회를 둘로 나눕니다. "이 티어의 한도"와 "이 사용자의 한도"는 다른 질문이고,
-- 결제 안내가 묻고 싶은 것은 앞의 것입니다.
--
--   _ai_free_allowance_for_tier(tier, action)  ← 티어를 이름으로 묻는다
--   _ai_free_allowance(user, action)           ← 사용자의 티어를 찾아 위를 부른다 (동작 동일)
--
-- 생성기(`get_ai_generation_quota`, `reserve_ai_generation`)는 그대로 사용자 기준입니다 —
-- 거기서는 부르는 사람의 한도가 맞는 답입니다.
BEGIN;

/**
 * 이 티어에게 이 행동이 하루 몇 개까지 공짜인가.
 *
 * 폴백은 239와 같습니다: 정확히 일치하는 행 → 'free' 행 → (0, 'item'). 마지막이 0인 이유도
 * 같습니다 — 테이블에 없는 행동은 무료가 아닙니다.
 */
CREATE OR REPLACE FUNCTION public._ai_free_allowance_for_tier(p_tier text, p_action_group text)
  RETURNS TABLE (per_day integer, unit_kind text, trial_applies boolean)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_tier text := COALESCE(NULLIF(btrim(p_tier), ''), 'free');
BEGIN
  RETURN QUERY
    SELECT a.per_day, a.unit_kind, a.trial_applies
      FROM ai_free_allowances a
     WHERE a.action_group = p_action_group AND a.tier = v_tier;
  IF FOUND THEN RETURN; END IF;

  RETURN QUERY
    SELECT a.per_day, a.unit_kind, a.trial_applies
      FROM ai_free_allowances a
     WHERE a.action_group = p_action_group AND a.tier = 'free';
  IF FOUND THEN RETURN; END IF;

  RETURN QUERY SELECT 0, 'item'::text, false;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._ai_free_allowance_for_tier(text, text) FROM PUBLIC, anon, authenticated;

-- 사용자용은 티어를 찾아 위를 부릅니다. 밖에서 본 동작은 239와 같습니다.
CREATE OR REPLACE FUNCTION public._ai_free_allowance(p_user uuid, p_action_group text)
  RETURNS TABLE (per_day integer, unit_kind text, trial_applies boolean)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_tier text;
BEGIN
  SELECT s.tier INTO v_tier
    FROM subscriptions s
   WHERE s.user_id = p_user
     AND s.status = 'active'
     AND (s.expires_at IS NULL OR s.expires_at > now())
   ORDER BY s.started_at DESC
   LIMIT 1;

  RETURN QUERY SELECT * FROM public._ai_free_allowance_for_tier(COALESCE(v_tier, 'free'), p_action_group);
END;
$$;
REVOKE EXECUTE ON FUNCTION public._ai_free_allowance(uuid, text) FROM PUBLIC, anon, authenticated;

/**
 * 결제 안내는 **무료 요금제**를 광고합니다, 부르는 사람의 요금제가 아니라.
 *
 * `_ai_free_cards_per_day()`는 그대로 둡니다 — 생성기가 읽는 "나에게 오늘 몇 장 남았나"는
 * 여전히 사용자 기준이 맞습니다. 달라지는 것은 이 함수가 무엇을 묻느냐뿐입니다.
 */
CREATE OR REPLACE FUNCTION public.get_plan_limits()
  RETURNS json
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT json_build_object(
    -- The free-tier owned-card cap. Not COALESCEd to a literal on purpose: a
    -- fallback constant here would be one more hand copy of the number this
    -- function exists to stop copying, hidden where nobody would look for it.
    -- mig 116 seeds the id = 1 row, so NULL means the config row was deleted —
    -- the caller should say nothing rather than say something invented.
    'free_card_limit',       (SELECT max_owned_cards FROM card_limit_settings WHERE id = 1),
    -- THE FREE TIER'S NUMBER, BY NAME. Still delegated rather than reimplemented — the paywall
    -- and the generator read the same table — but asked as "what does the free plan give?"
    -- rather than "what do I get?", which is the question this endpoint is answering for
    -- someone who has not signed up yet.
    'free_ai_cards_per_day', (SELECT per_day FROM public._ai_free_allowance_for_tier('free', 'card'))
  );
$function$;

COMMIT;

-- Down for 241: 결제 안내를 다시 "부르는 사람의 티어" 기준으로.
--
-- 되돌리면 유료 티어 행(`('pro','card',N)`)이 존재하는 순간 pro 사용자가 자기 한도를
-- "무료 요금제" 설명으로 보게 됩니다. 그게 이 롤백이 되돌아가는 상태입니다.
--
-- `_ai_free_allowance_for_tier`는 남깁니다: 지우면 `_ai_free_allowance`가 깨지고, 남아 있어도
-- 부르는 곳이 없으면 아무 일도 하지 않습니다.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_plan_limits()
  RETURNS json
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT json_build_object(
    'free_card_limit',       (SELECT max_owned_cards FROM card_limit_settings WHERE id = 1),
    'free_ai_cards_per_day', public._ai_free_cards_per_day()
  );
$function$;

COMMIT;

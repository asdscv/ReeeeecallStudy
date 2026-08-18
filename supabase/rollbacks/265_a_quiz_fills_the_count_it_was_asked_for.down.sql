-- 265 되돌리기: 대체 카드 조회 함수를 지웁니다.
--
-- 되돌리면 문항을 못 만든 카드 자리가 빈 채로 남습니다 — 3문항을 요청해도 2문항이 옵니다.
-- 엣지의 채우기 루프는 이 함수가 없으면 조회 오류를 로그로 남기고 조용히 멈추므로(break),
-- 함수만 지워도 500 이 나가지는 않습니다.
BEGIN;

DROP FUNCTION IF EXISTS public.quiz_substitute_cards(uuid, uuid[], integer);

COMMIT;

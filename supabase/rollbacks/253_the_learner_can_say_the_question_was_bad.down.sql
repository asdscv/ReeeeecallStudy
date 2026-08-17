-- 253 되돌리기: 문항 평가를 없앱니다.
--
-- 표를 지우면 이미 받은 평가도 함께 사라집니다. 그게 이 되돌리기의 값입니다 — 되돌릴 이유가
-- "이 기능을 안 쓴다"이면 그 데이터도 쓰지 않는 것이고, 남겨둘 이유가 있으면 표만 남기고
-- 함수만 지우면 됩니다(아래 DROP TABLE 한 줄을 빼면 그렇게 됩니다).
BEGIN;

DROP FUNCTION IF EXISTS public.rate_quiz_item(uuid, text, text);
DROP TABLE IF EXISTS public.quiz_item_feedback;

COMMIT;

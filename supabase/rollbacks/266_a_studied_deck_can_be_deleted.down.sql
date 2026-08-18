-- 266 되돌리기: 트리거를 떼면 공부한 덱이 다시 안 지워집니다(23514).
BEGIN;
DROP TRIGGER IF EXISTS trg_drop_card_only_attempts ON public.cards;
DROP FUNCTION IF EXISTS public._drop_card_only_attempts();
COMMIT;

-- 249 되돌리기: 카드 한 장을 다시 $0.10 으로.
--
-- 되돌리면 무료 10장을 넘긴 학습자가 장당 10센트를 냅니다(원가 $0.00028 의 350배).
BEGIN;

UPDATE public.ai_action_prices
   SET price_micro = 100000, updated_at = now()
 WHERE action = 'card' AND price_micro = 10000;

COMMIT;

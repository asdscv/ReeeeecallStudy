-- 248 되돌리기: 진단 값을 $1.00 으로 되돌립니다.
--
-- 되돌리면 사다리에서 혼자 꼭대기의 두 배가 됩니다($0.05~$0.50 안에 나머지 전부).
-- 값을 옛 값으로 가드해 두 번 실행해도 두 배가 되지 않습니다.
BEGIN;

UPDATE public.ai_action_prices
   SET price_micro = 1000000, updated_at = now()
 WHERE action = 'diagnosis' AND price_micro = 300000;

COMMIT;

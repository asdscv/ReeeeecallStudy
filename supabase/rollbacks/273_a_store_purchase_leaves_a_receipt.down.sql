-- 273 되돌리기: 스토어 결제가 다시 영수증을 남기지 않는 상태로.
-- 이미 기록된 payment_intents 행은 지우지 않는다 — 실제로 받은 돈이다.
BEGIN;
DROP FUNCTION IF EXISTS public.record_store_payment(uuid, text, text, integer, text, text);
COMMIT;

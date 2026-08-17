-- 251 되돌리기: 통합 사용 내역을 없앱니다.
--
-- 되돌리면 화면은 다시 `get_ai_credit_ledger` 만 읽고, 무료로 쓴 것은 어디에도 보이지
-- 않습니다 — 카드를 만들고 사용 내역을 열면 비어 있는 그 상태로 돌아갑니다.
BEGIN;

DROP FUNCTION IF EXISTS public.get_ai_usage_history(int, timestamptz);

COMMIT;

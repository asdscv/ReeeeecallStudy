-- 263 되돌리기: 조정 항목을 지웁니다.
--
-- 되돌리면 원장 합이 다시 잔액과 어긋납니다(asdscv +1, simquiz -$501.88). 잔액은 이 마이그
-- 레이션이 건드리지 않았으므로 되돌려도 학습자가 쓸 수 있는 돈은 그대로입니다.
BEGIN;

DELETE FROM public.ai_credit_ledger
 WHERE reason = 'admin_adjustment'
   AND ref LIKE 'reconcile:263:%';

COMMIT;

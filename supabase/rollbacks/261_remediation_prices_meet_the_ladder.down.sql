-- 261 되돌리기: 해설·힌트·비교를 한 값($0.50)으로 되돌리고 진단을 $0.30 으로.
--
-- 되돌리면 셋이 다시 원가의 588~858배가 됩니다. 코드 쪽 진단 프롬프트 상한(16장 x 200자)은
-- 이 파일이 건드리지 않습니다 — 상한은 값과 무관하게 남겨 두는 편이 안전합니다.
BEGIN;

UPDATE public.ai_action_prices
   SET price_micro = 500000, note = '50 credits per explanation', updated_at = now()
 WHERE action = 'remediation_explain';

UPDATE public.ai_action_prices
   SET price_micro = 300000, updated_at = now()
 WHERE action = 'diagnosis';

-- 힌트·비교 행을 지우면 `_ai_remediation_price` 가 해설 값으로 떨어져 예전과 같아집니다.
DELETE FROM public.ai_action_prices WHERE action IN ('remediation_hint','remediation_compare');

COMMIT;

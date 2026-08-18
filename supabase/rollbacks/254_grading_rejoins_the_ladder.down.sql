-- 254 되돌리기: 채점 값을 다시 올립니다(서술형 $0.40, 주관식 $0.10).
--
-- 되돌리면 서술형 답안 하나가 카드 마흔 장 값이 됩니다.
BEGIN;

UPDATE public.ai_quiz_price_units SET units = 8, updated_at = now()
 WHERE action = 'grade_essay' AND units = 2;
UPDATE public.ai_quiz_price_units SET units = 2, updated_at = now()
 WHERE action = 'grade_short' AND units = 1;

COMMIT;

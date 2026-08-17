-- 245 되돌리기: 객관식 AI 해설을 없앱니다.
--
-- 가격 행부터 지웁니다 — CHECK 를 먼저 좁히면 그 행 때문에 실패합니다. 행이 사라지면
-- `reserve_ai_quiz` 가 'Unknown quiz action' 으로 거절하므로, 배포된 엣지 함수가 남아 있어도
-- 요금이 새지 않습니다.
--
-- 이미 붙은 해설(`answer_attempts.feedback`)은 지우지 않습니다. 학습자가 값을 치른 것이고,
-- 점수에는 영향을 준 적이 없습니다.
BEGIN;

DELETE FROM public.ai_quiz_price_units WHERE action = 'grade_mcq';

ALTER TABLE public.ai_quiz_price_units
  DROP CONSTRAINT IF EXISTS ai_quiz_price_units_action_check;
ALTER TABLE public.ai_quiz_price_units
  ADD CONSTRAINT ai_quiz_price_units_action_check
  CHECK (action IN ('generate_mcq','generate_short','generate_essay',
                    'grade_short','grade_essay'));

COMMENT ON TABLE public.ai_quiz_price_units IS
  'Quiz actions and what each costs, in units of ai_pricing_settings.quiz_unit_price_micro. Generation is per item, grading is per submitted answer. Multiple-choice grading is deliberately absent: it is decided by index comparison in SQL and must stay free.';

DROP FUNCTION IF EXISTS public.apply_quiz_explanation(uuid, jsonb, jsonb, text);

COMMIT;

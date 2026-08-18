-- 262 되돌리기: 모범답안 열을 떼고 힌트를 되살립니다.
--
-- 열을 지우면 이미 만들어진 모범답안이 사라집니다 — 되돌릴 이유가 데이터 손상이 아니라면
-- 열은 두고 클라이언트만 되돌리는 편이 낫습니다.
BEGIN;

ALTER TABLE public.quiz_questions DROP CONSTRAINT IF EXISTS quiz_questions_model_answer_len;
ALTER TABLE public.quiz_questions DROP COLUMN IF EXISTS model_answer;

INSERT INTO public.ai_action_prices (action, price_micro, note)
VALUES ('remediation_hint', 20000, '힌트 1건. 262 롤백으로 되살림.')
ON CONFLICT (action) DO NOTHING;

COMMIT;

-- 남은 두 가지는 함수 본문이라 수동입니다:
--   1) `persist_quiz_questions` — 207 을 재실행하면 model_answer 없이 돌아갑니다.
--   2) `get_quiz_run_items` — 252 를 재실행합니다.
--   3) `reserve_ai_remediation` — 261 을 재실행하면 hint 를 다시 받습니다.

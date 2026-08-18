-- 256 되돌리기: 길이 상한을 없앱니다.
--
-- 되돌리면 퀴즈 답안에 1,000만 자를 제출할 수 있고 한 건에 28.6MB 가 저장됩니다. 반복 제한도
-- 없습니다 — 되돌리기 전에 그 사실을 알고 하십시오.
--
-- 함수는 226 의 본문(길이 검사 없음)으로 돌아갑니다. 제약은 지웁니다.
BEGIN;

ALTER TABLE public.answer_attempts DROP CONSTRAINT IF EXISTS answer_attempts_response_size_check;
ALTER TABLE public.decks           DROP CONSTRAINT IF EXISTS decks_name_length_check;
ALTER TABLE public.decks           DROP CONSTRAINT IF EXISTS decks_description_length_check;
ALTER TABLE public.card_templates  DROP CONSTRAINT IF EXISTS card_templates_name_length_check;

COMMIT;

-- `submit_quiz_answer` 는 226 을 다시 적용해 되돌립니다:
--   supabase db query --file supabase/migrations/226_quiz_answers_feed_the_goal.sql --linked

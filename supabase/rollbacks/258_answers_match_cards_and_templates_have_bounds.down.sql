-- 258 되돌리기: 서술형 답안을 2,000자로 되돌리고 템플릿 한도를 없앱니다.
--
-- 되돌리면 4,000자짜리 카드에 대한 답이 2,000자에서 막힙니다 — 학습자가 납득할 수 없는
-- 규칙으로 돌아갑니다. 그 사이에 2,000자를 넘는 답안이 저장돼 있어도 표 제약이 아니라
-- 함수 검사이므로 기존 행은 그대로 남습니다.
--
-- 함수는 256 을 다시 적용해 되돌립니다:
--   supabase db query --file supabase/migrations/256_length_limits_where_the_writing_happens.sql --linked
BEGIN;

ALTER TABLE public.card_templates DROP CONSTRAINT IF EXISTS card_templates_field_count_check;
ALTER TABLE public.card_templates DROP CONSTRAINT IF EXISTS card_templates_html_length_check;
ALTER TABLE public.card_templates DROP CONSTRAINT IF EXISTS card_templates_layout_size_check;

COMMIT;

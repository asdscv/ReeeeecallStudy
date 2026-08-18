-- 259 되돌리기: 퀴즈 값을 유형 무관 $0.10 으로 되돌리고 카드 한도를 4,000자로.
--
-- 되돌리면 주관식 문항이 다시 객관식과 같은 값을 받습니다 — 출력이 3분의 1인데도.
BEGIN;

UPDATE public.ai_pricing_settings SET quiz_unit_price_micro = 50000, updated_at = now()
 WHERE id = 1 AND quiz_unit_price_micro = 5000;

UPDATE public.ai_quiz_price_units SET units = 2, updated_at = now()
 WHERE action = 'generate_short' AND units = 1;
UPDATE public.ai_quiz_price_units SET units = 1, updated_at = now()
 WHERE action = 'grade_short' AND units = 2;
UPDATE public.ai_quiz_price_units SET units = 2, updated_at = now()
 WHERE action = 'grade_essay' AND units = 4;

ALTER TABLE public.cards DROP CONSTRAINT IF EXISTS cards_field_values_chars_check;
ALTER TABLE public.cards
  ADD CONSTRAINT cards_field_values_chars_check
  CHECK (public._card_text_chars(field_values) <= 4000) NOT VALID;

COMMIT;

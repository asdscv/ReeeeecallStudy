-- 257 되돌리기: 글자수 한도를 없애고 바이트 한도를 255 값(8,000)으로 되돌립니다.
--
-- 되돌리면 한도가 다시 언어마다 다른 뜻이 됩니다 — 한국어 카드는 2,666자, 영어 카드는
-- 8,000자에서 막히고, 화면은 그 숫자를 보여줄 수 없습니다.
--
-- 8,000 바이트를 넘는 카드가 그 사이에 생겼다면 이 되돌리기는 실패합니다. 그때는 그 카드들을
-- 먼저 줄여야 합니다 — 데이터를 조용히 버리는 되돌리기보다 실패하는 되돌리기가 낫습니다.
BEGIN;

ALTER TABLE public.cards DROP CONSTRAINT IF EXISTS cards_field_values_chars_check;
DROP FUNCTION IF EXISTS public._card_text_chars(jsonb);

ALTER TABLE public.cards DROP CONSTRAINT IF EXISTS cards_field_values_size_check;
ALTER TABLE public.cards
  ADD CONSTRAINT cards_field_values_size_check
  CHECK (octet_length(field_values::text) <= 8000) NOT VALID;

COMMIT;

ALTER TABLE public.cards VALIDATE CONSTRAINT cards_field_values_size_check;

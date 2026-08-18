-- 255 되돌리기: 카드 크기 한도를 없앱니다.
--
-- 되돌리면 카드 한 장의 크기에 상한이 없어지고, 생성 한 번에 그 열 장이 프롬프트로 들어갑니다.
BEGIN;

ALTER TABLE public.cards DROP CONSTRAINT IF EXISTS cards_field_values_size_check;

COMMIT;

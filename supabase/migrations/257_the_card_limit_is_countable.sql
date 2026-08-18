-- 257: 카드 한도를 사람이 셀 수 있는 단위로.
--
-- 255 는 카드에 8,000 **바이트** 상한을 걸었습니다. 저장을 지키는 데는 맞는 단위인데 화면에
-- 보여줄 수 있는 단위가 아닙니다 — 한글은 한 글자가 3바이트라 같은 "8,000" 이 한국어
-- 학습자에게는 2,666자, 영어 학습자에게는 8,000자입니다. 같은 숫자가 사람마다 다른 뜻이면
-- 그건 보여줄 수 없는 숫자이고, 보여줄 수 없는 한도는 저장을 누른 뒤에야 알게 되는 한도입니다.
--
-- 그래서 **글자수**를 학습자가 보는 한도로 삼고(4,000자), 바이트 제약은 그 뒤에 서서 절대
-- 먼저 걸리지 않도록 넉넉히 올립니다(4,000자 × 최악 4바이트 = 16,000).
--
-- 프로덕션 377,099장: 평균 140자 · p99 331자 · **최대 2,188자**. 4,000 은 현존 최대의 1.8배라
-- 오늘 아무도 걸리지 않습니다. 255 의 8,000바이트는 그 2,188자 카드가 한글이었다면 6,564
-- 바이트로 아슬아슬했을 값이라, 이 변경은 한도를 **넓히면서** 동시에 셀 수 있게 만듭니다.
--
-- 이미지 필드는 데이터 URL 이라 혼자 수만 자입니다. 그건 학습자가 쓴 글이 아니므로 글자수
-- CHECK 는 `text`/`data:` 로 시작하지 않는 값만 셉니다 — 아니면 이미지 한 장이 카드를
-- 통째로 막습니다.
BEGIN;

ALTER TABLE public.cards DROP CONSTRAINT IF EXISTS cards_field_values_size_check;
ALTER TABLE public.cards
  ADD CONSTRAINT cards_field_values_size_check
  CHECK (octet_length(field_values::text) <= 16000) NOT VALID;

-- 사람이 보는 한도. 이미지 데이터 URL 은 세지 않습니다.
--
-- CHECK 안에는 서브쿼리를 쓸 수 없어(로컬에서 확인) IMMUTABLE 함수로 뺍니다. 이 함수는 인자
-- 하나만 보고 같은 입력에 늘 같은 값을 돌려주므로 IMMUTABLE 이 정직합니다.
CREATE OR REPLACE FUNCTION public._card_text_chars(p_fields jsonb)
  RETURNS integer LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT coalesce(sum(char_length(value)), 0)::integer
    FROM jsonb_each_text(coalesce(p_fields, '{}'::jsonb))
   WHERE value NOT LIKE 'data:%'
$$;

COMMENT ON FUNCTION public._card_text_chars(jsonb) IS
  'Characters a learner actually typed into a card: every text field, minus image data URLs (which are tens of thousands of characters and are not writing). The unit the card limit is expressed in, because bytes mean different things in different scripts.';

ALTER TABLE public.cards DROP CONSTRAINT IF EXISTS cards_field_values_chars_check;
ALTER TABLE public.cards
  ADD CONSTRAINT cards_field_values_chars_check
  CHECK (public._card_text_chars(field_values) <= 4000) NOT VALID;

COMMIT;

ALTER TABLE public.cards VALIDATE CONSTRAINT cards_field_values_size_check;
ALTER TABLE public.cards VALIDATE CONSTRAINT cards_field_values_chars_check;

-- 286: 글이 이어 주는 공식 덱 «계열» 을 남깁니다 (예: 'toeic:800', 'ielts:6.5', 'conversation:여행').
--
-- 덱 id 가 아니라 계열을 저장하는 이유: 같은 TOEIC 800 이라도 읽는 사람의 모국어마다 덱이 따로
-- 있습니다(영어 → 한국어, 영어 → 베트남어 …). 화면이 읽는 사람 언어로 marketplace_listings 태그를
-- 찾아 연결합니다. 형식은 packages/shared/lib/official-deck-family.ts 가 정합니다.
--
-- 확장만 합니다(nullable 컬럼 하나).

BEGIN;

ALTER TABLE contents ADD COLUMN IF NOT EXISTS deck_family TEXT;

COMMIT;

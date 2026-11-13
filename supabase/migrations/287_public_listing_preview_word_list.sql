-- 287: 공식 덱 공개 페이지를 «단어장 페이지» 로 — 샘플 50장(덱 전체에서 고르게) + 덱 언어·같은 계열 덱.
--
-- 왜: 공식 덱 페이지 650개가 16개월 동안 구글 노출 0회였다. 크롤러가 받는 본문은 약 300단어
-- (샘플 10장, 그것도 알파벳 앞쪽 A 단어들뿐)였다. «토익 800점 단어» 같은 검색어는 실제 단어
-- 목록 페이지가 상위를 차지한다 — 우리는 1,500장을 갖고도 10장만 보여 주고 있었다.
-- 대표 결정(2026-11-12): 공식 덱은 50장을 공개한다.
--
-- 바뀌는 것 (반환 JSON 에 칸 추가, 기존 칸은 그대로):
--   sample_fields : 공식 덱 = 정렬 순서 기준으로 덱 전체에서 고르게 50장, 그 외 = 앞 10장(종전).
--   native_language / learning_language / study_level : 페이지 언어·제목을 정하는 데 쓴다.
--   siblings : 같은 계열(같은 카테고리·레벨·방향)의 다른 모국어 공식 덱 [{id, native_language}]
--              — 페이지의 hreflang 묶음. 영어→X 덱끼리, X→영어 덱끼리 묶는다.

BEGIN;

CREATE OR REPLACE FUNCTION get_public_listing_preview(p_listing_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'id', ml.id,
    'title', ml.title,
    'description', ml.description,
    'tags', ml.tags,
    'category', ml.category,
    'card_count', ml.card_count,
    'acquire_count', ml.acquire_count,
    'share_mode', ml.share_mode,
    'created_at', ml.created_at,
    'owner_name', p.display_name,
    'owner_is_official', p.is_official,
    'native_language', ml.native_language,
    'learning_language', ml.learning_language,
    'study_level', ml.study_level,
    'sample_fields', (
      SELECT COALESCE(json_agg(
        json_build_object('field_values', s.field_values)
        ORDER BY s.sort_position, s.id
      ), '[]'::json)
      FROM (
        SELECT r.field_values, r.sort_position, r.id
        FROM (
          SELECT c2.field_values, c2.sort_position, c2.id,
                 row_number() OVER (ORDER BY c2.sort_position, c2.id) - 1 AS rn,
                 count(*) OVER () AS total
          FROM cards c2
          WHERE c2.deck_id = ml.deck_id
        ) r
        WHERE CASE
          WHEN p.is_official THEN
            r.rn % GREATEST(1, r.total / 50) = 0
            AND r.rn / GREATEST(1, r.total / 50) < 50
          ELSE r.rn < 10
        END
      ) s
    ),
    'siblings', (
      SELECT COALESCE(json_agg(
        json_build_object('id', sib.id, 'native_language', sib.native_language)
        ORDER BY sib.native_language
      ), '[]'::json)
      FROM marketplace_listings sib
      WHERE p.is_official
        AND sib.id <> ml.id
        AND sib.is_active = true
        AND sib.owner_is_official = true
        AND sib.category = ml.category
        AND (SELECT t FROM unnest(ml.tags) t WHERE t LIKE 'level:%' LIMIT 1) IS NOT NULL
        AND sib.tags @> ARRAY[
          (SELECT t FROM unnest(ml.tags) t WHERE t LIKE 'level:%' LIMIT 1),
          CASE WHEN ml.tags @> ARRAY['source:en'] THEN 'source:en' ELSE 'target:en' END
        ]
        AND (ml.tags @> ARRAY['source:en'] OR ml.tags @> ARRAY['target:en'])
    )
  ) INTO result
  FROM marketplace_listings ml
  JOIN profiles p ON p.id = ml.owner_id
  WHERE ml.id = p_listing_id
    AND ml.is_active = true;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_public_listing_preview(UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

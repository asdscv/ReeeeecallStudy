-- 284: 글마다 «어떤 검색어를 노리고 썼는가» 를 남깁니다.
--
-- 일일 파이프라인이 주제를 AI 상상 대신 서치콘솔 실측(노출은 많고 클릭은 0 인 검색어)에서 고르게
-- 되었습니다. 같은 검색어로 이튿날 또 쓰지 않으려면 이미 노린 검색어를 기억해야 하고, 나중에
-- «그 글이 그 검색어에서 클릭을 가져왔나» 를 재려면 글과 검색어가 묶여 있어야 합니다.
--
-- 확장만 합니다(nullable 컬럼 + 부분 인덱스). 기존 글과 AI 주제로 쓴 글은 NULL 입니다.

BEGIN;

ALTER TABLE contents ADD COLUMN IF NOT EXISTS target_query TEXT;

CREATE INDEX IF NOT EXISTS idx_contents_target_query
  ON contents (lower(target_query))
  WHERE target_query IS NOT NULL;

COMMIT;

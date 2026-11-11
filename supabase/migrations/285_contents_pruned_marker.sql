-- 285: 정리(비공개 전환)한 글에 «언제·왜» 를 남깁니다.
--
-- 2026-11-11 얇은 AI 글 정리: 구글 노출 0 · 사람 조회 0 · 14일 넘은 글을 삭제하지 않고
-- is_published = false 로 내립니다. 이 표시가 있으면 한 줄로 되돌릴 수 있습니다:
--
--   UPDATE contents SET is_published = true, pruned_at = NULL, pruned_reason = NULL
--   WHERE pruned_at IS NOT NULL;
--
-- 확장만 합니다(nullable 컬럼 두 개).

BEGIN;

ALTER TABLE contents ADD COLUMN IF NOT EXISTS pruned_at TIMESTAMPTZ;
ALTER TABLE contents ADD COLUMN IF NOT EXISTS pruned_reason TEXT;

COMMIT;

-- ========================================
-- 덱별 SRS 간격 설정 (again/hard/good/easy 일 수)
-- ========================================

ALTER TABLE decks
ADD COLUMN IF NOT EXISTS srs_settings jsonb
DEFAULT '{"again_days": 0, "hard_days": 1, "good_days": 1, "easy_days": 4}'::jsonb;

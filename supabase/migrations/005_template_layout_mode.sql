-- ========================================
-- 005: Add layout_mode, front_html, back_html to card_templates
-- Allows users to switch between default layout and custom HTML
-- ========================================

ALTER TABLE card_templates
  ADD COLUMN layout_mode TEXT NOT NULL DEFAULT 'default'
    CHECK (layout_mode IN ('default', 'custom')),
  ADD COLUMN front_html TEXT NOT NULL DEFAULT '',
  ADD COLUMN back_html TEXT NOT NULL DEFAULT '';

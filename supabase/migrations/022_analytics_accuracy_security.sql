-- ═══════════════════════════════════════════════════════════════════
-- 022 – Analytics Accuracy & Security
--
-- Phase 1: Data Accuracy
--   • Unique index on (session_id, content_id) to deduplicate views
--   • record_content_view: ON CONFLICT handling + content validation
--   • update_content_view_duration: minimum 2s duration filter
--
-- Phase 2: Security
--   • update_content_view_duration: ownership check (viewer_id)
--   • record_content_view: input validation (session_id, referrer length)
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1B. Clean up existing duplicates before creating unique index ─

DELETE FROM content_views
WHERE id NOT IN (
  SELECT DISTINCT ON (session_id, content_id) id
  FROM content_views
  WHERE session_id IS NOT NULL
  ORDER BY session_id, content_id, created_at ASC
)
AND session_id IS NOT NULL;

-- ─── 1B. Dedup index ──────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS idx_content_views_session_content
  ON content_views (session_id, content_id)
  WHERE session_id IS NOT NULL;


-- ─── 1B + 2C. record_content_view (with dedup + validation) ──────

CREATE OR REPLACE FUNCTION record_content_view(
  p_content_id UUID,
  p_session_id TEXT DEFAULT NULL,
  p_referrer   TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_session TEXT;
  v_referrer TEXT;
BEGIN
  -- 2C: Validate content exists and is published
  IF NOT EXISTS (
    SELECT 1 FROM contents
    WHERE id = p_content_id AND is_published = true
  ) THEN
    RETURN NULL;
  END IF;

  -- 2C: Truncate session_id to 100 chars
  v_session := LEFT(p_session_id, 100);

  -- 2C: Truncate referrer to 2048 chars
  v_referrer := LEFT(p_referrer, 2048);

  -- 1B: Dedup — if same session+content already exists, return existing id
  INSERT INTO content_views (content_id, viewer_id, session_id, referrer)
  VALUES (p_content_id, auth.uid(), v_session, v_referrer)
  ON CONFLICT (session_id, content_id) WHERE session_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_id;

  -- If INSERT was skipped (duplicate), fetch existing view id
  IF v_id IS NULL AND v_session IS NOT NULL THEN
    SELECT id INTO v_id
    FROM content_views
    WHERE session_id = v_session AND content_id = p_content_id
    LIMIT 1;
  END IF;

  RETURN v_id;
END;
$$;


-- ─── 1D + 2A + 2C. update_content_view_duration ─────────────────

CREATE OR REPLACE FUNCTION update_content_view_duration(
  p_view_id     UUID,
  p_duration_ms INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 1D: Minimum 2s duration filter
  IF p_duration_ms < 2000 THEN
    RETURN;
  END IF;

  -- 2C: Duration range check (cap at 1 hour)
  -- 2A: Ownership check — authenticated users can only update their own views,
  --      anonymous users rely on viewId (UUID) as implicit token
  UPDATE content_views
  SET view_duration_ms = LEAST(p_duration_ms, 3600000)
  WHERE id = p_view_id
    AND (viewer_id = auth.uid() OR viewer_id IS NULL);
END;
$$;

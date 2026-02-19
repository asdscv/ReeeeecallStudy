-- ═══════════════════════════════════════════════════════════════════
-- 025 – Page & Event Tracking
--
-- Phase 5: Data Collection Completeness
--   • page_views table + record_page_view() RPC
--   • analytics_events table + record_analytics_event() RPC
-- ═══════════════════════════════════════════════════════════════════

-- ─── 5A. Page Views Table ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS page_views (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_path       TEXT NOT NULL,
  viewer_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id      TEXT,
  referrer        TEXT,
  utm_source      TEXT,
  utm_medium      TEXT,
  utm_campaign    TEXT,
  device_type     TEXT,
  viewport_width  INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_page_views_path_date ON page_views (page_path, created_at DESC);
CREATE INDEX idx_page_views_date      ON page_views (created_at DESC);
CREATE INDEX idx_page_views_session   ON page_views (session_id, page_path);

ALTER TABLE page_views ENABLE ROW LEVEL SECURITY;

-- Anyone can insert (page tracking on public pages)
CREATE POLICY "Anyone can insert page views"
  ON page_views FOR INSERT
  WITH CHECK (true);

-- Only admins can read
CREATE POLICY "Admins can read page views"
  ON page_views FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
  );


-- ─── 5A. record_page_view() ─────────────────────────────────────

CREATE OR REPLACE FUNCTION record_page_view(
  p_page_path      TEXT,
  p_session_id     TEXT DEFAULT NULL,
  p_referrer       TEXT DEFAULT NULL,
  p_utm_source     TEXT DEFAULT NULL,
  p_utm_medium     TEXT DEFAULT NULL,
  p_utm_campaign   TEXT DEFAULT NULL,
  p_device_type    TEXT DEFAULT NULL,
  p_viewport_width INTEGER DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO page_views (
    page_path, viewer_id, session_id, referrer,
    utm_source, utm_medium, utm_campaign,
    device_type, viewport_width
  )
  VALUES (
    LEFT(p_page_path, 500),
    auth.uid(),
    LEFT(p_session_id, 100),
    LEFT(p_referrer, 2048),
    LEFT(p_utm_source, 200),
    LEFT(p_utm_medium, 200),
    LEFT(p_utm_campaign, 200),
    p_device_type,
    p_viewport_width
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;


-- ─── 5B. Analytics Events Table ──────────────────────────────────

CREATE TABLE IF NOT EXISTS analytics_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id  TEXT,
  category    TEXT NOT NULL,
  action      TEXT NOT NULL,
  label       TEXT,
  value       NUMERIC,
  page_path   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_analytics_events_cat_date ON analytics_events (category, created_at DESC);
CREATE INDEX idx_analytics_events_date     ON analytics_events (created_at DESC);

ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

-- Anyone can insert
CREATE POLICY "Anyone can insert analytics events"
  ON analytics_events FOR INSERT
  WITH CHECK (true);

-- Only admins can read
CREATE POLICY "Admins can read analytics events"
  ON analytics_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
  );


-- ─── 5B. record_analytics_event() ───────────────────────────────

CREATE OR REPLACE FUNCTION record_analytics_event(
  p_category   TEXT,
  p_action     TEXT,
  p_label      TEXT DEFAULT NULL,
  p_value      NUMERIC DEFAULT NULL,
  p_page_path  TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  -- Validate required fields
  IF p_category IS NULL OR p_category = '' OR p_action IS NULL OR p_action = '' THEN
    RETURN NULL;
  END IF;

  INSERT INTO analytics_events (
    user_id, category, action, label, value, page_path
  )
  VALUES (
    auth.uid(),
    LEFT(p_category, 100),
    LEFT(p_action, 100),
    LEFT(p_label, 200),
    p_value,
    LEFT(p_page_path, 500)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ============================================================
-- 056_marketplace_views.sql
-- Marketplace view tracking + publisher stats RPCs
-- ============================================================

-- ─── 1. marketplace_views table ─────────────────────────────

CREATE TABLE marketplace_views (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  UUID NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  viewer_id   UUID REFERENCES auth.users(id),  -- NULL for anonymous views
  session_id  TEXT,                             -- for anonymous dedup
  referrer    TEXT,                             -- where they came from
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_mv_listing ON marketplace_views(listing_id, created_at DESC);
CREATE INDEX idx_mv_listing_day ON marketplace_views(listing_id, created_at);
CREATE INDEX idx_mv_viewer ON marketplace_views(viewer_id) WHERE viewer_id IS NOT NULL;
CREATE INDEX idx_mv_session ON marketplace_views(listing_id, session_id) WHERE session_id IS NOT NULL;

ALTER TABLE marketplace_views ENABLE ROW LEVEL SECURITY;

-- Anyone can insert (view tracking)
CREATE POLICY "Anyone can insert marketplace views"
  ON marketplace_views FOR INSERT
  WITH CHECK (true);

-- Listing owners can read views on their listings
CREATE POLICY "Owners read own listing views"
  ON marketplace_views FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM marketplace_listings ml
      WHERE ml.id = marketplace_views.listing_id
        AND ml.owner_id = auth.uid()
    )
  );

-- Admins can read all
CREATE POLICY "Admins read all marketplace views"
  ON marketplace_views FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
  );


-- ─── 2. Add view_count to marketplace_listings ──────────────

ALTER TABLE marketplace_listings
  ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0;


-- ─── 3. RPC: record_marketplace_view ────────────────────────
-- Rate-limited: max 1 view per listing per session per hour

CREATE OR REPLACE FUNCTION record_marketplace_view(
  p_listing_id UUID,
  p_session_id TEXT DEFAULT NULL,
  p_referrer   TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_viewer_id UUID;
  v_dedup_key TEXT;
  v_recent_exists BOOLEAN;
BEGIN
  v_viewer_id := auth.uid();

  -- Build dedup key: prefer viewer_id, fallback to session_id
  v_dedup_key := COALESCE(v_viewer_id::text, p_session_id);

  -- Rate limit: check if a view exists for this listing+key in the last hour
  IF v_dedup_key IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM marketplace_views
      WHERE listing_id = p_listing_id
        AND (
          (viewer_id IS NOT NULL AND viewer_id::text = v_dedup_key)
          OR (session_id IS NOT NULL AND session_id = v_dedup_key)
        )
        AND created_at > now() - interval '1 hour'
    ) INTO v_recent_exists;

    IF v_recent_exists THEN
      RETURN; -- Already viewed within the hour, skip
    END IF;
  END IF;

  -- Insert the view
  INSERT INTO marketplace_views (listing_id, viewer_id, session_id, referrer)
  VALUES (p_listing_id, v_viewer_id, p_session_id, p_referrer);

  -- Increment denormalized view_count
  UPDATE marketplace_listings
  SET view_count = view_count + 1
  WHERE id = p_listing_id;
END;
$$;


-- ─── 4. RPC: get_listing_stats ──────────────────────────────
-- Returns daily views, total views, acquire_count, conversion rate
-- Available to listing owners only

CREATE OR REPLACE FUNCTION get_listing_stats(p_listing_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_result JSON;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Check ownership
  IF NOT EXISTS (
    SELECT 1 FROM marketplace_listings
    WHERE id = p_listing_id AND owner_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Not the owner of this listing';
  END IF;

  SELECT json_build_object(
    'total_views',
      (SELECT COALESCE(view_count, 0) FROM marketplace_listings WHERE id = p_listing_id),
    'total_acquires',
      (SELECT COALESCE(acquire_count, 0) FROM marketplace_listings WHERE id = p_listing_id),
    'conversion_rate',
      (SELECT CASE
        WHEN COALESCE(view_count, 0) = 0 THEN 0
        ELSE ROUND((COALESCE(acquire_count, 0)::numeric / view_count * 100), 2)
      END FROM marketplace_listings WHERE id = p_listing_id),
    'daily_views',
      COALESCE((
        SELECT json_agg(row_to_json(t) ORDER BY t.date)
        FROM (
          SELECT
            created_at::date::text AS date,
            count(*)::int AS views,
            count(DISTINCT COALESCE(viewer_id::text, session_id))::int AS unique_viewers
          FROM marketplace_views
          WHERE listing_id = p_listing_id
            AND created_at >= now() - interval '30 days'
          GROUP BY created_at::date
        ) t
      ), '[]'::json),
    'avg_rating',
      COALESCE((SELECT avg_rating FROM marketplace_listings WHERE id = p_listing_id), 0),
    'review_count',
      COALESCE((SELECT review_count FROM marketplace_listings WHERE id = p_listing_id), 0)
  ) INTO v_result;

  RETURN v_result;
END;
$$;


-- ─── 5. RPC: get_publisher_stats ────────────────────────────
-- Aggregate stats for all listings owned by the current user

CREATE OR REPLACE FUNCTION get_publisher_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_result JSON;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT json_build_object(
    'total_listings',
      (SELECT count(*)::int FROM marketplace_listings WHERE owner_id = v_user_id AND is_active = true),
    'total_views',
      (SELECT COALESCE(sum(view_count), 0)::int FROM marketplace_listings WHERE owner_id = v_user_id),
    'total_acquires',
      (SELECT COALESCE(sum(acquire_count), 0)::int FROM marketplace_listings WHERE owner_id = v_user_id),
    'avg_conversion_rate',
      (SELECT CASE
        WHEN COALESCE(sum(view_count), 0) = 0 THEN 0
        ELSE ROUND((COALESCE(sum(acquire_count), 0)::numeric / sum(view_count) * 100), 2)
      END FROM marketplace_listings WHERE owner_id = v_user_id),
    'listings',
      COALESCE((
        SELECT json_agg(row_to_json(t) ORDER BY t.created_at DESC)
        FROM (
          SELECT
            ml.id,
            ml.title,
            ml.is_active,
            ml.view_count,
            ml.acquire_count,
            ml.card_count,
            ml.share_mode,
            ml.category,
            COALESCE(ml.avg_rating, 0) AS avg_rating,
            COALESCE(ml.review_count, 0) AS review_count,
            ml.created_at,
            CASE
              WHEN COALESCE(ml.view_count, 0) = 0 THEN 0
              ELSE ROUND((COALESCE(ml.acquire_count, 0)::numeric / ml.view_count * 100), 2)
            END AS conversion_rate
          FROM marketplace_listings ml
          WHERE ml.owner_id = v_user_id
        ) t
      ), '[]'::json),
    'daily_views',
      COALESCE((
        SELECT json_agg(row_to_json(t) ORDER BY t.date)
        FROM (
          SELECT
            mv.created_at::date::text AS date,
            count(*)::int AS views,
            count(DISTINCT COALESCE(mv.viewer_id::text, mv.session_id))::int AS unique_viewers
          FROM marketplace_views mv
          JOIN marketplace_listings ml ON ml.id = mv.listing_id
          WHERE ml.owner_id = v_user_id
            AND mv.created_at >= now() - interval '30 days'
          GROUP BY mv.created_at::date
        ) t
      ), '[]'::json),
    'daily_acquires',
      COALESCE((
        SELECT json_agg(row_to_json(t) ORDER BY t.date)
        FROM (
          SELECT
            ds.accepted_at::date::text AS date,
            count(*)::int AS acquires
          FROM deck_shares ds
          JOIN marketplace_listings ml ON ml.deck_id = ds.deck_id
          WHERE ml.owner_id = v_user_id
            AND ds.status = 'active'
            AND ds.accepted_at IS NOT NULL
            AND ds.accepted_at >= now() - interval '30 days'
          GROUP BY ds.accepted_at::date
        ) t
      ), '[]'::json),
    'top_listings',
      COALESCE((
        SELECT json_agg(row_to_json(t))
        FROM (
          SELECT
            ml.id,
            ml.title,
            COALESCE(ml.view_count, 0) AS view_count
          FROM marketplace_listings ml
          WHERE ml.owner_id = v_user_id AND ml.is_active = true
          ORDER BY ml.view_count DESC NULLS LAST
          LIMIT 5
        ) t
      ), '[]'::json),
    'recent_acquires',
      COALESCE((
        SELECT json_agg(row_to_json(t))
        FROM (
          SELECT
            ds.id,
            ml.title AS deck_title,
            p.display_name AS user_name,
            ds.accepted_at
          FROM deck_shares ds
          JOIN marketplace_listings ml ON ml.deck_id = ds.deck_id
          LEFT JOIN profiles p ON p.id = ds.recipient_id
          WHERE ml.owner_id = v_user_id
            AND ds.status = 'active'
            AND ds.accepted_at IS NOT NULL
          ORDER BY ds.accepted_at DESC
          LIMIT 10
        ) t
      ), '[]'::json),
    'recent_reviews',
      COALESCE((
        SELECT json_agg(row_to_json(t))
        FROM (
          SELECT
            mr.id,
            mr.rating,
            mr.title,
            mr.body,
            mr.created_at,
            ml.title AS deck_title,
            p.display_name AS user_name
          FROM marketplace_reviews mr
          JOIN marketplace_listings ml ON ml.id = mr.listing_id
          LEFT JOIN profiles p ON p.id = mr.user_id
          WHERE ml.owner_id = v_user_id
          ORDER BY mr.created_at DESC
          LIMIT 10
        ) t
      ), '[]'::json)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

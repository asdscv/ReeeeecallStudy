-- ============================================================
-- 057_official_accounts.sql
-- Enterprise-grade official/verified account system
-- Extends the is_official flag from 039 with settings, badge types,
-- and featured listing support.
-- ============================================================

-- ─── 1. official_account_settings table ─────────────────────
CREATE TABLE IF NOT EXISTS official_account_settings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  display_badge       TEXT DEFAULT 'verified'
                      CHECK (display_badge IN ('verified', 'official', 'educator', 'publisher', 'partner')),
  badge_color         TEXT DEFAULT '#3B82F6',
  organization_name   TEXT,
  organization_url    TEXT,
  verified_at         TIMESTAMPTZ DEFAULT now(),
  verified_by         UUID REFERENCES auth.users(id),
  featured_priority   INTEGER DEFAULT 0,
  max_listings        INTEGER DEFAULT 100,
  can_feature_listings BOOLEAN DEFAULT false,
  metadata            JSONB DEFAULT '{}',
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oas_user ON official_account_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_oas_featured ON official_account_settings(featured_priority DESC)
  WHERE featured_priority > 0;

-- ─── 2. RLS policies ────────────────────────────────────────
ALTER TABLE official_account_settings ENABLE ROW LEVEL SECURITY;

-- Anyone can read official account settings (public info)
CREATE POLICY "Anyone reads official account settings"
  ON official_account_settings
  FOR SELECT
  USING (true);

-- Only admins can insert/update/delete
CREATE POLICY "Admins manage official account settings"
  ON official_account_settings
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ─── 3. RPC: admin_set_official ─────────────────────────────
CREATE OR REPLACE FUNCTION admin_set_official(
  p_user_id     UUID,
  p_is_official BOOLEAN,
  p_badge_type  TEXT DEFAULT 'verified',
  p_org_name    TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID;
  v_result JSON;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Admin check
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = v_admin_id AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- Validate badge type
  IF p_badge_type NOT IN ('verified', 'official', 'educator', 'publisher', 'partner') THEN
    RAISE EXCEPTION 'Invalid badge type: %', p_badge_type;
  END IF;

  -- Update profiles.is_official
  UPDATE profiles
  SET is_official = p_is_official,
      updated_at = now()
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  IF p_is_official THEN
    -- Upsert official_account_settings
    INSERT INTO official_account_settings (
      user_id, display_badge, organization_name, verified_by, verified_at
    )
    VALUES (
      p_user_id, p_badge_type, p_org_name, v_admin_id, now()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      display_badge = EXCLUDED.display_badge,
      organization_name = COALESCE(EXCLUDED.organization_name, official_account_settings.organization_name),
      verified_by = EXCLUDED.verified_by,
      updated_at = now();
  ELSE
    -- Remove settings when revoking official status
    DELETE FROM official_account_settings WHERE user_id = p_user_id;
  END IF;

  SELECT json_build_object(
    'user_id', p_user_id,
    'is_official', p_is_official,
    'badge_type', p_badge_type,
    'organization_name', p_org_name
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ─── 4. RPC: get_official_accounts ──────────────────────────
CREATE OR REPLACE FUNCTION get_official_accounts()
RETURNS TABLE (
  user_id UUID,
  display_name TEXT,
  is_official BOOLEAN,
  display_badge TEXT,
  badge_color TEXT,
  organization_name TEXT,
  organization_url TEXT,
  featured_priority INTEGER,
  max_listings INTEGER,
  can_feature_listings BOOLEAN,
  verified_at TIMESTAMPTZ,
  listing_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id AS user_id,
    p.display_name,
    p.is_official,
    COALESCE(oas.display_badge, 'verified') AS display_badge,
    COALESCE(oas.badge_color, '#3B82F6') AS badge_color,
    oas.organization_name,
    oas.organization_url,
    COALESCE(oas.featured_priority, 0) AS featured_priority,
    COALESCE(oas.max_listings, 100) AS max_listings,
    COALESCE(oas.can_feature_listings, false) AS can_feature_listings,
    oas.verified_at,
    (SELECT COUNT(*) FROM marketplace_listings ml
     WHERE ml.owner_id = p.id AND ml.is_active = true) AS listing_count
  FROM profiles p
  LEFT JOIN official_account_settings oas ON oas.user_id = p.id
  WHERE p.is_official = true
  ORDER BY COALESCE(oas.featured_priority, 0) DESC, p.display_name ASC;
END;
$$;

-- ─── 5. RPC: get_official_listings ──────────────────────────
CREATE OR REPLACE FUNCTION get_official_listings(
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  deck_id UUID,
  owner_id UUID,
  title TEXT,
  description TEXT,
  tags TEXT[],
  category TEXT,
  share_mode TEXT,
  card_count INTEGER,
  acquire_count INTEGER,
  view_count INTEGER,
  avg_rating NUMERIC,
  review_count INTEGER,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ,
  owner_display_name TEXT,
  owner_is_official BOOLEAN,
  badge_type TEXT,
  badge_color TEXT,
  organization_name TEXT,
  featured_priority INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ml.id,
    ml.deck_id,
    ml.owner_id,
    ml.title,
    ml.description,
    ml.tags,
    ml.category,
    ml.share_mode::TEXT,
    ml.card_count,
    ml.acquire_count,
    ml.view_count,
    ml.avg_rating,
    ml.review_count,
    ml.is_active,
    ml.created_at,
    p.display_name AS owner_display_name,
    p.is_official AS owner_is_official,
    COALESCE(oas.display_badge, 'verified') AS badge_type,
    COALESCE(oas.badge_color, '#3B82F6') AS badge_color,
    oas.organization_name,
    COALESCE(oas.featured_priority, 0) AS featured_priority
  FROM marketplace_listings ml
  JOIN profiles p ON p.id = ml.owner_id
  LEFT JOIN official_account_settings oas ON oas.user_id = ml.owner_id
  WHERE ml.is_active = true
    AND p.is_official = true
  ORDER BY COALESCE(oas.featured_priority, 0) DESC, ml.acquire_count DESC
  LIMIT p_limit;
END;
$$;

-- ─── 6. RPC: update_official_account_settings ───────────────
CREATE OR REPLACE FUNCTION admin_update_official_settings(
  p_user_id             UUID,
  p_badge_type          TEXT DEFAULT NULL,
  p_badge_color         TEXT DEFAULT NULL,
  p_organization_name   TEXT DEFAULT NULL,
  p_organization_url    TEXT DEFAULT NULL,
  p_featured_priority   INTEGER DEFAULT NULL,
  p_max_listings        INTEGER DEFAULT NULL,
  p_can_feature_listings BOOLEAN DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSON;
BEGIN
  -- Admin check
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  UPDATE official_account_settings SET
    display_badge = COALESCE(p_badge_type, display_badge),
    badge_color = COALESCE(p_badge_color, badge_color),
    organization_name = COALESCE(p_organization_name, organization_name),
    organization_url = COALESCE(p_organization_url, organization_url),
    featured_priority = COALESCE(p_featured_priority, featured_priority),
    max_listings = COALESCE(p_max_listings, max_listings),
    can_feature_listings = COALESCE(p_can_feature_listings, can_feature_listings),
    updated_at = now()
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Official account settings not found for user';
  END IF;

  SELECT json_build_object('user_id', p_user_id, 'updated', true) INTO v_result;
  RETURN v_result;
END;
$$;

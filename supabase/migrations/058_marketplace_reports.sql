-- ============================================================
-- 054_marketplace_reports.sql
-- Marketplace reporting/moderation system + paid listing placeholder
-- ============================================================

-- ─── 1. Add is_paid placeholder to marketplace_listings ────
ALTER TABLE marketplace_listings ADD COLUMN IF NOT EXISTS is_paid BOOLEAN NOT NULL DEFAULT false;

-- ─── 2. marketplace_reports table ──────────────────────────
CREATE TABLE IF NOT EXISTS marketplace_reports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  UUID NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  reporter_id UUID NOT NULL REFERENCES auth.users(id),
  category    TEXT NOT NULL CHECK (category IN ('inappropriate', 'copyright', 'spam', 'misleading', 'other')),
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewing', 'resolved', 'dismissed')),
  admin_note  TEXT,
  resolved_by UUID REFERENCES auth.users(id),
  resolved_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(listing_id, reporter_id)  -- one report per user per listing
);

CREATE INDEX IF NOT EXISTS idx_mr_listing ON marketplace_reports(listing_id);
CREATE INDEX IF NOT EXISTS idx_mr_status  ON marketplace_reports(status) WHERE status IN ('pending', 'reviewing');
CREATE INDEX IF NOT EXISTS idx_mr_reporter ON marketplace_reports(reporter_id);

-- ─── 3. RLS policies ──────────────────────────────────────
ALTER TABLE marketplace_reports ENABLE ROW LEVEL SECURITY;

-- Reporters can read their own reports
CREATE POLICY "Reporters read own reports" ON marketplace_reports
  FOR SELECT USING (auth.uid() = reporter_id);

-- Admins can read all reports
CREATE POLICY "Admins read all reports" ON marketplace_reports
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Admins can update reports (resolve/dismiss)
CREATE POLICY "Admins update reports" ON marketplace_reports
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ─── 4. RPC: submit_report ────────────────────────────────
CREATE OR REPLACE FUNCTION submit_report(
  p_listing_id UUID,
  p_category   TEXT,
  p_description TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_report_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Validate category
  IF p_category NOT IN ('inappropriate', 'copyright', 'spam', 'misleading', 'other') THEN
    RAISE EXCEPTION 'Invalid report category: %', p_category;
  END IF;

  -- Verify listing exists and is active
  IF NOT EXISTS (SELECT 1 FROM marketplace_listings WHERE id = p_listing_id AND is_active = true) THEN
    RAISE EXCEPTION 'Listing not found or inactive';
  END IF;

  -- Cannot report own listing
  IF EXISTS (SELECT 1 FROM marketplace_listings WHERE id = p_listing_id AND owner_id = v_user_id) THEN
    RAISE EXCEPTION 'Cannot report your own listing';
  END IF;

  INSERT INTO marketplace_reports (listing_id, reporter_id, category, description)
  VALUES (p_listing_id, v_user_id, p_category, p_description)
  RETURNING id INTO v_report_id;

  RETURN v_report_id;
END;
$$;

-- ─── 5. RPC: admin_resolve_report ─────────────────────────
CREATE OR REPLACE FUNCTION admin_resolve_report(
  p_report_id UUID,
  p_status    TEXT,
  p_admin_note TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Verify admin role
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_admin_id AND role = 'admin') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- Validate status transition
  IF p_status NOT IN ('reviewing', 'resolved', 'dismissed') THEN
    RAISE EXCEPTION 'Invalid status: %', p_status;
  END IF;

  UPDATE marketplace_reports
  SET status = p_status,
      admin_note = COALESCE(p_admin_note, admin_note),
      resolved_by = CASE WHEN p_status IN ('resolved', 'dismissed') THEN v_admin_id ELSE resolved_by END,
      resolved_at = CASE WHEN p_status IN ('resolved', 'dismissed') THEN now() ELSE resolved_at END
  WHERE id = p_report_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report not found';
  END IF;
END;
$$;

-- ─── 6. RPC: admin_get_reports ────────────────────────────
CREATE OR REPLACE FUNCTION admin_get_reports(
  p_status TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  listing_id UUID,
  listing_title TEXT,
  reporter_id UUID,
  reporter_name TEXT,
  category TEXT,
  description TEXT,
  status TEXT,
  admin_note TEXT,
  resolved_by UUID,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify admin role
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    r.listing_id,
    ml.title AS listing_title,
    r.reporter_id,
    p.display_name AS reporter_name,
    r.category,
    r.description,
    r.status,
    r.admin_note,
    r.resolved_by,
    r.resolved_at,
    r.created_at
  FROM marketplace_reports r
  JOIN marketplace_listings ml ON ml.id = r.listing_id
  LEFT JOIN profiles p ON p.id = r.reporter_id
  WHERE (p_status IS NULL OR r.status = p_status)
  ORDER BY
    CASE r.status
      WHEN 'pending' THEN 0
      WHEN 'reviewing' THEN 1
      WHEN 'resolved' THEN 2
      WHEN 'dismissed' THEN 3
    END,
    r.created_at DESC;
END;
$$;

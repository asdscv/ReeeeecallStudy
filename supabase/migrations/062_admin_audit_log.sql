-- ============================================================
-- 062_admin_audit_log.sql
-- Enterprise-grade audit log system for admin actions
--
-- 1. admin_audit_logs table
-- 2. RLS + admin-only read policy
-- 3. Indexes on admin_id, created_at
-- 4. RPC: admin_log_action (insert audit entry)
-- 5. RPC: admin_get_audit_logs (paginated, filtered, with admin name)
-- 6. user_status column on profiles
-- 7. RPC: admin_set_user_status (change user status + audit)
-- 8. RPC: admin_export_data (CSV-ready JSON export)
-- ============================================================

-- ─── 1. admin_audit_logs table ────────────────────────────

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action       TEXT NOT NULL,
  target_type  TEXT NOT NULL,
  target_id    TEXT,
  details      JSONB DEFAULT '{}',
  ip_address   TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- ─── 2. RLS — admin-only read ─────────────────────────────

ALTER TABLE admin_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read audit logs"
  ON admin_audit_logs
  FOR SELECT
  USING (is_admin());

-- No INSERT/UPDATE/DELETE policies — writes go through SECURITY DEFINER RPCs only

-- ─── 3. Indexes ───────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_audit_logs_admin_id
  ON admin_audit_logs(admin_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
  ON admin_audit_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action
  ON admin_audit_logs(action);

CREATE INDEX IF NOT EXISTS idx_audit_logs_target_type
  ON admin_audit_logs(target_type);

-- ─── 4. RPC: admin_log_action ─────────────────────────────
-- Internal logging function called by other admin RPCs or frontend.
-- SECURITY DEFINER so it can bypass RLS to INSERT.

CREATE OR REPLACE FUNCTION admin_log_action(
  p_action       TEXT,
  p_target_type  TEXT,
  p_target_id    TEXT DEFAULT NULL,
  p_details      JSONB DEFAULT '{}',
  p_ip_address   TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_log_id UUID;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;

  INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, details, ip_address)
  VALUES (auth.uid(), p_action, p_target_type, p_target_id, p_details, p_ip_address)
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_log_action(TEXT, TEXT, TEXT, JSONB, TEXT) FROM anon;

-- ─── 5. RPC: admin_get_audit_logs ─────────────────────────
-- Paginated, filterable audit log reader with admin display_name.

CREATE OR REPLACE FUNCTION admin_get_audit_logs(
  p_limit       INT DEFAULT 50,
  p_offset      INT DEFAULT 0,
  p_action      TEXT DEFAULT NULL,
  p_target_type TEXT DEFAULT NULL,
  p_from_date   TIMESTAMPTZ DEFAULT NULL,
  p_to_date     TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSON;
  v_total  BIGINT;
  v_safe_limit INT;
  v_safe_offset INT;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;

  -- Clamp pagination params
  v_safe_limit  := GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
  v_safe_offset := GREATEST(0, COALESCE(p_offset, 0));

  -- Get total count with same filters
  SELECT COUNT(*) INTO v_total
  FROM admin_audit_logs a
  WHERE (p_action IS NULL      OR a.action = p_action)
    AND (p_target_type IS NULL OR a.target_type = p_target_type)
    AND (p_from_date IS NULL   OR a.created_at >= p_from_date)
    AND (p_to_date IS NULL     OR a.created_at <= p_to_date);

  -- Get paginated rows with admin display_name
  SELECT json_build_object(
    'total', v_total,
    'limit', v_safe_limit,
    'offset', v_safe_offset,
    'data', COALESCE((
      SELECT json_agg(row_to_json(t))
      FROM (
        SELECT
          a.id,
          a.admin_id,
          p.display_name AS admin_display_name,
          a.action,
          a.target_type,
          a.target_id,
          a.details,
          a.ip_address,
          a.created_at
        FROM admin_audit_logs a
        LEFT JOIN profiles p ON p.id = a.admin_id
        WHERE (p_action IS NULL      OR a.action = p_action)
          AND (p_target_type IS NULL OR a.target_type = p_target_type)
          AND (p_from_date IS NULL   OR a.created_at >= p_from_date)
          AND (p_to_date IS NULL     OR a.created_at <= p_to_date)
        ORDER BY a.created_at DESC
        LIMIT v_safe_limit
        OFFSET v_safe_offset
      ) t
    ), '[]'::JSON)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_get_audit_logs(INT, INT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM anon;

-- ─── 6. user_status column on profiles ────────────────────

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS user_status TEXT DEFAULT 'active';

-- Add CHECK constraint safely (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_valid_user_status'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_valid_user_status
      CHECK (user_status IN ('active', 'suspended', 'banned'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_profiles_user_status
  ON profiles(user_status)
  WHERE user_status != 'active';

-- ─── 7. RPC: admin_set_user_status ────────────────────────
-- Changes a user's status with audit logging.

CREATE OR REPLACE FUNCTION admin_set_user_status(
  p_user_id UUID,
  p_status  TEXT,
  p_reason  TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_status TEXT;
  v_display    TEXT;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;

  IF p_status NOT IN ('active', 'suspended', 'banned') THEN
    RAISE EXCEPTION 'Invalid status: must be active, suspended, or banned';
  END IF;

  -- Get current status
  SELECT user_status, display_name INTO v_old_status, v_display
  FROM profiles
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found: %', p_user_id;
  END IF;

  IF v_old_status = p_status THEN
    RETURN json_build_object(
      'success', true,
      'message', 'Status already set to ' || p_status,
      'changed', false
    );
  END IF;

  -- Update status
  UPDATE profiles
  SET user_status = p_status,
      updated_at = now()
  WHERE id = p_user_id;

  -- Log the action
  INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, details)
  VALUES (
    auth.uid(),
    CASE p_status
      WHEN 'banned'    THEN 'ban_user'
      WHEN 'suspended' THEN 'suspend_user'
      WHEN 'active'    THEN 'reactivate_user'
    END,
    'user',
    p_user_id::TEXT,
    jsonb_build_object(
      'old_status', v_old_status,
      'new_status', p_status,
      'reason', p_reason,
      'display_name', v_display
    )
  );

  RETURN json_build_object(
    'success', true,
    'message', 'User status changed from ' || v_old_status || ' to ' || p_status,
    'changed', true,
    'old_status', v_old_status,
    'new_status', p_status
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_set_user_status(UUID, TEXT, TEXT) FROM anon;

-- ─── 8. RPC: admin_export_data ────────────────────────────
-- Returns JSON arrays suitable for CSV export.
-- p_section: 'users' | 'study' | 'market' | 'content'

CREATE OR REPLACE FUNCTION admin_export_data(
  p_section TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;

  IF p_section NOT IN ('users', 'study', 'market', 'content') THEN
    RAISE EXCEPTION 'Invalid section: must be users, study, market, or content';
  END IF;

  CASE p_section
    -- ── Users export ──
    WHEN 'users' THEN
      SELECT COALESCE(jsonb_agg(row_to_json(t)::JSONB), '[]'::JSONB)
      FROM (
        SELECT
          p.id,
          p.display_name,
          u.email,
          p.role,
          p.user_status,
          p.locale,
          p.created_at,
          p.updated_at,
          (SELECT COUNT(*) FROM decks d WHERE d.user_id = p.id) AS deck_count,
          (SELECT COUNT(*) FROM study_sessions ss WHERE ss.user_id = p.id) AS session_count,
          (SELECT COALESCE(SUM(ss.cards_studied), 0) FROM study_sessions ss WHERE ss.user_id = p.id) AS total_cards_studied
        FROM profiles p
        LEFT JOIN auth.users u ON u.id = p.id
        ORDER BY p.created_at DESC
      ) t INTO v_result;

    -- ── Study export ──
    WHEN 'study' THEN
      SELECT COALESCE(jsonb_agg(row_to_json(t)::JSONB), '[]'::JSONB)
      FROM (
        SELECT
          ss.id,
          ss.user_id,
          p.display_name,
          ss.deck_id,
          d.name AS deck_name,
          ss.study_mode,
          ss.cards_studied,
          ss.total_cards,
          ss.total_duration_ms,
          ss.ratings,
          ss.completed_at,
          ss.started_at
        FROM study_sessions ss
        LEFT JOIN profiles p ON p.id = ss.user_id
        LEFT JOIN decks d ON d.id = ss.deck_id
        ORDER BY ss.completed_at DESC NULLS LAST
        LIMIT 10000
      ) t INTO v_result;

    -- ── Marketplace export ──
    WHEN 'market' THEN
      SELECT COALESCE(jsonb_agg(row_to_json(t)::JSONB), '[]'::JSONB)
      FROM (
        SELECT
          ml.id,
          ml.deck_id,
          d.name AS deck_name,
          ml.owner_id,
          p.display_name AS owner_name,
          ml.title,
          ml.description,
          ml.category,
          ml.share_mode,
          ml.card_count,
          ml.acquire_count,
          ml.is_active,
          ml.created_at,
          ml.updated_at,
          (SELECT COUNT(*) FROM marketplace_reviews mr WHERE mr.listing_id = ml.id) AS review_count,
          (SELECT COALESCE(AVG(mr.rating), 0) FROM marketplace_reviews mr WHERE mr.listing_id = ml.id) AS avg_rating
        FROM marketplace_listings ml
        LEFT JOIN decks d ON d.id = ml.deck_id
        LEFT JOIN profiles p ON p.id = ml.owner_id
        ORDER BY ml.created_at DESC
      ) t INTO v_result;

    -- ── Content export ──
    WHEN 'content' THEN
      SELECT COALESCE(jsonb_agg(row_to_json(t)::JSONB), '[]'::JSONB)
      FROM (
        SELECT
          c.id,
          c.title,
          c.slug,
          c.locale,
          c.is_published,
          c.reading_time_minutes,
          c.tags,
          c.created_at,
          c.updated_at
        FROM contents c
        ORDER BY c.created_at DESC
      ) t INTO v_result;

  END CASE;

  RETURN COALESCE(v_result, '[]'::JSONB);
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_export_data(TEXT) FROM anon;

-- ═══════════════════════════════════════════════════════
-- 013_admin_role.sql — Admin role system
--
-- 1. Add role column to profiles (with CHECK constraint)
-- 2. Grant admin to asdscv@gmail.com
-- 3. is_admin() VOLATILE helper (SECURITY DEFINER)
-- 4. BEFORE UPDATE trigger to prevent non-admin role escalation
-- 5. Admin SELECT policies on ALL 12 tables
-- 6. Performance indexes for admin dashboard queries
-- 7. VOLATILE RPC functions for admin dashboard stats
-- ═══════════════════════════════════════════════════════

-- ─── 1. Role column with CHECK constraint ───────────

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

-- Ensure only valid role values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_valid_role'
  ) THEN
    ALTER TABLE profiles ADD CONSTRAINT profiles_valid_role CHECK (role IN ('user', 'admin'));
  END IF;
END $$;

-- ─── 2. Seed admin user (idempotent) ────────────────

UPDATE profiles
SET role = 'admin'
WHERE id = (SELECT id FROM auth.users WHERE email = 'asdscv@gmail.com' LIMIT 1);

-- ─── 3. is_admin() helper ───────────────────────────
-- VOLATILE because auth.uid() changes per request/session.
-- SECURITY DEFINER to bypass RLS when checking role.

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE sql
VOLATILE
SECURITY DEFINER
AS $$
  SELECT COALESCE(
    (SELECT EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'admin'
    )),
    false
  );
$$;

-- ─── 4. Prevent non-admin role escalation ───────────

CREATE OR REPLACE FUNCTION prevent_role_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF NOT is_admin() THEN
      RAISE EXCEPTION 'Only admins can change user roles';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_role_escalation ON profiles;
CREATE TRIGGER trg_prevent_role_escalation
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION prevent_role_escalation();

-- ─── 5. Admin SELECT policies on all 12 tables ─────

CREATE POLICY "Admins can read all profiles"
  ON profiles FOR SELECT USING (is_admin());

CREATE POLICY "Admins can read all card_templates"
  ON card_templates FOR SELECT USING (is_admin());

CREATE POLICY "Admins can read all decks"
  ON decks FOR SELECT USING (is_admin());

CREATE POLICY "Admins can read all cards"
  ON cards FOR SELECT USING (is_admin());

CREATE POLICY "Admins can read all deck_study_state"
  ON deck_study_state FOR SELECT USING (is_admin());

CREATE POLICY "Admins can read all study_logs"
  ON study_logs FOR SELECT USING (is_admin());

CREATE POLICY "Admins can read all study_sessions"
  ON study_sessions FOR SELECT USING (is_admin());

CREATE POLICY "Admins can read all deck_shares"
  ON deck_shares FOR SELECT USING (is_admin());

CREATE POLICY "Admins can read all marketplace_listings"
  ON marketplace_listings FOR SELECT USING (is_admin());

CREATE POLICY "Admins can read all contents"
  ON contents FOR SELECT USING (is_admin());

CREATE POLICY "Admins can read all api_keys"
  ON api_keys FOR SELECT USING (is_admin());

CREATE POLICY "Admins can read all user_card_progress"
  ON user_card_progress FOR SELECT USING (is_admin());

-- ─── 6. Performance indexes for admin queries ───────

CREATE INDEX IF NOT EXISTS idx_study_sessions_completed_at
  ON study_sessions (completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_profiles_created_at
  ON profiles (created_at);

CREATE INDEX IF NOT EXISTS idx_study_sessions_study_mode
  ON study_sessions (study_mode);

CREATE INDEX IF NOT EXISTS idx_study_logs_studied_at
  ON study_logs (studied_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_keys_expires_at
  ON api_keys (expires_at);

-- ─── 7. RPC functions (all VOLATILE) ────────────────

-- 7a. Overview stats (totals)
CREATE OR REPLACE FUNCTION admin_overview_stats()
RETURNS JSON
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
AS $$
DECLARE
  result JSON;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT json_build_object(
    'total_users',    (SELECT COUNT(*) FROM profiles),
    'total_decks',    (SELECT COUNT(*) FROM decks),
    'total_cards',    (SELECT COUNT(*) FROM cards),
    'total_sessions', (SELECT COUNT(*) FROM study_sessions),
    'total_study_time_ms', (SELECT COALESCE(SUM(total_duration_ms), 0) FROM study_sessions),
    'total_cards_studied', (SELECT COALESCE(SUM(cards_studied), 0) FROM study_sessions),
    'total_templates', (SELECT COUNT(*) FROM card_templates),
    'total_shared_decks', (SELECT COUNT(*) FROM deck_shares WHERE status = 'active'),
    'total_marketplace_listings', (SELECT COUNT(*) FROM marketplace_listings WHERE is_active = true)
  ) INTO result;

  RETURN result;
END;
$$;

-- 7b. Active users (DAU/WAU/MAU)
CREATE OR REPLACE FUNCTION admin_active_users()
RETURNS JSON
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
AS $$
DECLARE
  result JSON;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT json_build_object(
    'dau', (
      SELECT COUNT(DISTINCT user_id) FROM study_sessions
      WHERE completed_at >= NOW() - INTERVAL '1 day'
    ),
    'wau', (
      SELECT COUNT(DISTINCT user_id) FROM study_sessions
      WHERE completed_at >= NOW() - INTERVAL '7 days'
    ),
    'mau', (
      SELECT COUNT(DISTINCT user_id) FROM study_sessions
      WHERE completed_at >= NOW() - INTERVAL '30 days'
    ),
    'total_users', (SELECT COUNT(*) FROM profiles)
  ) INTO result;

  RETURN result;
END;
$$;

-- 7c. User signups (daily, last N days)
CREATE OR REPLACE FUNCTION admin_user_signups(p_days INT DEFAULT 90)
RETURNS JSON
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
AS $$
DECLARE
  result JSON;
  safe_days INT;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  safe_days := GREATEST(1, LEAST(p_days, 365));

  SELECT json_agg(row_to_json(t))
  FROM (
    SELECT
      DATE(created_at) AS date,
      COUNT(*) AS count
    FROM profiles
    WHERE created_at >= NOW() - INTERVAL '1 day' * safe_days
    GROUP BY DATE(created_at)
    ORDER BY date
  ) t INTO result;

  RETURN COALESCE(result, '[]'::JSON);
END;
$$;

-- 7d. Daily study activity (sessions + cards per day)
CREATE OR REPLACE FUNCTION admin_daily_study_activity(p_days INT DEFAULT 30)
RETURNS JSON
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
AS $$
DECLARE
  result JSON;
  safe_days INT;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  safe_days := GREATEST(1, LEAST(p_days, 365));

  SELECT json_agg(row_to_json(t))
  FROM (
    SELECT
      DATE(completed_at) AS date,
      COUNT(*) AS sessions,
      COALESCE(SUM(cards_studied), 0) AS cards,
      COALESCE(SUM(total_duration_ms), 0) AS total_duration_ms
    FROM study_sessions
    WHERE completed_at >= NOW() - INTERVAL '1 day' * safe_days
    GROUP BY DATE(completed_at)
    ORDER BY date
  ) t INTO result;

  RETURN COALESCE(result, '[]'::JSON);
END;
$$;

-- 7e. Mode breakdown (study mode distribution)
CREATE OR REPLACE FUNCTION admin_mode_breakdown()
RETURNS JSON
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
AS $$
DECLARE
  result JSON;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT json_agg(row_to_json(t))
  FROM (
    SELECT
      study_mode AS mode,
      COUNT(*) AS session_count,
      COALESCE(SUM(cards_studied), 0) AS total_cards,
      COALESCE(SUM(total_duration_ms), 0) AS total_duration_ms
    FROM study_sessions
    GROUP BY study_mode
    ORDER BY session_count DESC
  ) t INTO result;

  RETURN COALESCE(result, '[]'::JSON);
END;
$$;

-- 7f. Content stats (marketplace + sharing overview)
CREATE OR REPLACE FUNCTION admin_content_stats()
RETURNS JSON
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
AS $$
DECLARE
  result JSON;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT json_build_object(
    'total_listings', (SELECT COUNT(*) FROM marketplace_listings),
    'active_listings', (SELECT COUNT(*) FROM marketplace_listings WHERE is_active = true),
    'total_acquires', (SELECT COALESCE(SUM(acquire_count), 0) FROM marketplace_listings),
    'total_shares', (SELECT COUNT(*) FROM deck_shares),
    'active_shares', (SELECT COUNT(*) FROM deck_shares WHERE status = 'active'),
    'share_by_mode', COALESCE((
      SELECT json_agg(row_to_json(t))
      FROM (
        SELECT share_mode AS mode, COUNT(*) AS count
        FROM deck_shares
        GROUP BY share_mode
      ) t
    ), '[]'::JSON),
    'top_categories', COALESCE((
      SELECT json_agg(row_to_json(t))
      FROM (
        SELECT category, COUNT(*) AS count
        FROM marketplace_listings
        WHERE is_active = true
        GROUP BY category
        ORDER BY count DESC
        LIMIT 10
      ) t
    ), '[]'::JSON)
  ) INTO result;

  RETURN COALESCE(result, '{}'::JSON);
END;
$$;

-- 7g. Rating distribution (for study analytics)
CREATE OR REPLACE FUNCTION admin_rating_distribution(p_days INT DEFAULT 30)
RETURNS JSON
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
AS $$
DECLARE
  result JSON;
  safe_days INT;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  safe_days := GREATEST(1, LEAST(p_days, 365));

  SELECT json_agg(row_to_json(t))
  FROM (
    SELECT
      rating,
      COUNT(*) AS count
    FROM study_logs
    WHERE studied_at >= NOW() - INTERVAL '1 day' * safe_days
    GROUP BY rating
    ORDER BY count DESC
  ) t INTO result;

  RETURN COALESCE(result, '[]'::JSON);
END;
$$;

-- 7h. Recent daily activity for overview (last 14 days)
CREATE OR REPLACE FUNCTION admin_recent_activity()
RETURNS JSON
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
AS $$
DECLARE
  result JSON;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT json_agg(row_to_json(t))
  FROM (
    SELECT
      DATE(completed_at) AS date,
      COUNT(*) AS sessions,
      COUNT(DISTINCT user_id) AS active_users,
      COALESCE(SUM(cards_studied), 0) AS cards
    FROM study_sessions
    WHERE completed_at >= NOW() - INTERVAL '14 days'
    GROUP BY DATE(completed_at)
    ORDER BY date
  ) t INTO result;

  RETURN COALESCE(result, '[]'::JSON);
END;
$$;

-- 7i. System stats (API keys breakdown)
CREATE OR REPLACE FUNCTION admin_system_stats()
RETURNS JSON
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
AS $$
DECLARE
  result JSON;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT json_build_object(
    'total_api_keys', (SELECT COUNT(*) FROM api_keys),
    'active_api_keys', (SELECT COUNT(*) FROM api_keys WHERE (expires_at IS NULL OR expires_at > NOW())),
    'expired_api_keys', (SELECT COUNT(*) FROM api_keys WHERE expires_at IS NOT NULL AND expires_at <= NOW()),
    'recently_used_keys', (SELECT COUNT(*) FROM api_keys WHERE last_used_at >= NOW() - INTERVAL '7 days'),
    'total_contents', (SELECT COUNT(*) FROM contents),
    'published_contents', (SELECT COUNT(*) FROM contents WHERE is_published = true),
    'total_study_logs', (SELECT COUNT(*) FROM study_logs)
  ) INTO result;

  RETURN result;
END;
$$;

-- ============================================================
-- 048: Subscriptions & Session Management
-- ============================================================
-- Adds subscription tiers and concurrent session limiting.
-- Designed for extensibility: add new tiers/features by
-- updating the CHECK constraint and client-side config.
-- ============================================================

-- 1. Subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tier        text NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'enterprise')),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'canceled', 'past_due', 'trialing')),
  started_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz,              -- NULL = no expiry (free tier)
  canceled_at timestamptz,
  metadata    jsonb DEFAULT '{}'::jsonb, -- extensible: payment provider info, etc.
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- One active subscription per user
CREATE UNIQUE INDEX idx_subscriptions_user_active
  ON subscriptions (user_id)
  WHERE status IN ('active', 'trialing');

CREATE INDEX idx_subscriptions_expires ON subscriptions (expires_at)
  WHERE expires_at IS NOT NULL;

-- RLS
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own subscription"
  ON subscriptions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admin can read all subscriptions"
  ON subscriptions FOR SELECT
  USING (is_admin());

-- Only server/RPC can INSERT/UPDATE subscriptions (no direct client writes)

-- 2. User sessions table
CREATE TABLE IF NOT EXISTS user_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id     text NOT NULL,                     -- client-generated unique device ID
  device_name   text,                              -- human-readable label
  ip_address    inet,
  last_seen_at  timestamptz NOT NULL DEFAULT now(), -- heartbeat
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_sessions_user ON user_sessions (user_id);
CREATE INDEX idx_user_sessions_last_seen ON user_sessions (last_seen_at);
CREATE UNIQUE INDEX idx_user_sessions_device ON user_sessions (user_id, device_id);

-- RLS
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own sessions"
  ON user_sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own sessions"
  ON user_sessions FOR DELETE
  USING (auth.uid() = user_id);

-- 3. Auto-create free subscription on signup
CREATE OR REPLACE FUNCTION handle_new_user_subscription()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO subscriptions (user_id, tier, status)
  VALUES (NEW.id, 'free', 'active')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created_subscription
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user_subscription();

-- 4. Backfill: create free subscriptions for existing users who don't have one
INSERT INTO subscriptions (user_id, tier, status)
SELECT id, 'free', 'active'
FROM auth.users
WHERE id NOT IN (
  SELECT user_id FROM subscriptions
  WHERE status IN ('active', 'trialing')
);

-- 5. RPC: Register / refresh a session (upsert)
-- Returns: { allowed: true } or { allowed: false, kicked_session_ids: [...] }
CREATE OR REPLACE FUNCTION register_session(
  p_device_id   text,
  p_device_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id     uuid := auth.uid();
  v_tier        text;
  v_max_sessions int;
  v_active_count int;
  v_oldest_ids   uuid[];
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'not_authenticated');
  END IF;

  -- Admin & official accounts bypass session limits
  IF EXISTS (SELECT 1 FROM profiles WHERE id = v_user_id AND (role = 'admin' OR is_official = true)) THEN
    INSERT INTO user_sessions (user_id, device_id, device_name, last_seen_at)
    VALUES (v_user_id, p_device_id, p_device_name, now())
    ON CONFLICT (user_id, device_id)
    DO UPDATE SET last_seen_at = now(), device_name = COALESCE(EXCLUDED.device_name, user_sessions.device_name);

    RETURN jsonb_build_object('allowed', true, 'tier', 'admin', 'max_sessions', 999, 'active_sessions', 1);
  END IF;

  -- Get user tier
  SELECT tier INTO v_tier
  FROM subscriptions
  WHERE user_id = v_user_id AND status IN ('active', 'trialing')
  LIMIT 1;

  v_tier := COALESCE(v_tier, 'free');

  -- Session limits per tier (easily extensible)
  v_max_sessions := CASE v_tier
    WHEN 'free' THEN 1
    WHEN 'pro' THEN 3
    WHEN 'enterprise' THEN 5
    ELSE 1
  END;

  -- Upsert this session
  INSERT INTO user_sessions (user_id, device_id, device_name, last_seen_at)
  VALUES (v_user_id, p_device_id, p_device_name, now())
  ON CONFLICT (user_id, device_id)
  DO UPDATE SET last_seen_at = now(), device_name = COALESCE(EXCLUDED.device_name, user_sessions.device_name);

  -- Clean up stale sessions (no heartbeat for > 24 hours)
  DELETE FROM user_sessions
  WHERE user_id = v_user_id
    AND last_seen_at < now() - interval '24 hours';

  -- Count active sessions
  SELECT count(*) INTO v_active_count
  FROM user_sessions
  WHERE user_id = v_user_id;

  -- If over limit, kick oldest sessions (not the current one)
  IF v_active_count > v_max_sessions THEN
    SELECT array_agg(id) INTO v_oldest_ids
    FROM (
      SELECT id
      FROM user_sessions
      WHERE user_id = v_user_id AND device_id != p_device_id
      ORDER BY last_seen_at ASC
      LIMIT (v_active_count - v_max_sessions)
    ) sub;

    DELETE FROM user_sessions WHERE id = ANY(v_oldest_ids);
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'tier', v_tier,
    'max_sessions', v_max_sessions,
    'active_sessions', LEAST(v_active_count, v_max_sessions)
  );
END;
$$;

-- 6. RPC: Heartbeat (lightweight session refresh)
CREATE OR REPLACE FUNCTION session_heartbeat(p_device_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_updated bool;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'not_authenticated');
  END IF;

  UPDATE user_sessions
  SET last_seen_at = now()
  WHERE user_id = v_user_id AND device_id = p_device_id;

  v_updated := FOUND;

  IF NOT v_updated THEN
    -- Session was kicked or expired
    RETURN jsonb_build_object('valid', false, 'reason', 'session_expired');
  END IF;

  RETURN jsonb_build_object('valid', true);
END;
$$;

-- 7. RPC: Get user subscription info
CREATE OR REPLACE FUNCTION get_user_subscription()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_result  jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('tier', 'free', 'status', 'none');
  END IF;

  SELECT jsonb_build_object(
    'id', id,
    'tier', tier,
    'status', status,
    'started_at', started_at,
    'expires_at', expires_at,
    'metadata', metadata
  ) INTO v_result
  FROM subscriptions
  WHERE user_id = v_user_id AND status IN ('active', 'trialing')
  LIMIT 1;

  RETURN COALESCE(v_result, jsonb_build_object('tier', 'free', 'status', 'none'));
END;
$$;

-- 8. RPC: List user's active sessions
CREATE OR REPLACE FUNCTION get_user_sessions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN COALESCE(
    (SELECT jsonb_agg(jsonb_build_object(
      'id', id,
      'device_id', device_id,
      'device_name', device_name,
      'last_seen_at', last_seen_at,
      'created_at', created_at
    ) ORDER BY last_seen_at DESC)
    FROM user_sessions
    WHERE user_id = v_user_id),
    '[]'::jsonb
  );
END;
$$;

-- 9. RPC: Admin — change user subscription tier
CREATE OR REPLACE FUNCTION admin_set_subscription(
  p_user_id uuid,
  p_tier    text,
  p_status  text DEFAULT 'active',
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  IF p_tier NOT IN ('free', 'pro', 'enterprise') THEN
    RAISE EXCEPTION 'Invalid tier: %', p_tier;
  END IF;

  -- Deactivate existing active subscription
  UPDATE subscriptions
  SET status = 'canceled', canceled_at = now(), updated_at = now()
  WHERE user_id = p_user_id AND status IN ('active', 'trialing');

  -- Create new subscription
  INSERT INTO subscriptions (user_id, tier, status, expires_at)
  VALUES (p_user_id, p_tier, p_status, p_expires_at);

  RETURN jsonb_build_object('success', true, 'tier', p_tier);
END;
$$;

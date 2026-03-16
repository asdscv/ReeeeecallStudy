-- ============================================================
-- 049: Extensible session limits via metadata override
-- ============================================================
-- Priority order for max_sessions:
--   1. admin/official → unlimited (bypass)
--   2. subscriptions.metadata->>'max_sessions_override' → custom per-user
--   3. tier default (free=1, pro=3, enterprise=5)
--
-- To give any user custom session limits:
--   SELECT admin_set_session_override('user-uuid', 10);
-- To remove override:
--   SELECT admin_set_session_override('user-uuid', NULL);
-- ============================================================

CREATE OR REPLACE FUNCTION register_session(
  p_device_id   text,
  p_device_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id        uuid := auth.uid();
  v_tier           text;
  v_max_sessions   int;
  v_override       int;
  v_active_count   int;
  v_oldest_ids     uuid[];
  v_is_privileged  bool;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'not_authenticated');
  END IF;

  -- 1) Admin & official accounts bypass session limits
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = v_user_id AND (role = 'admin' OR is_official = true)
  ) INTO v_is_privileged;

  IF v_is_privileged THEN
    INSERT INTO user_sessions (user_id, device_id, device_name, last_seen_at)
    VALUES (v_user_id, p_device_id, p_device_name, now())
    ON CONFLICT (user_id, device_id)
    DO UPDATE SET last_seen_at = now(), device_name = COALESCE(EXCLUDED.device_name, user_sessions.device_name);

    RETURN jsonb_build_object('allowed', true, 'tier', 'unlimited', 'max_sessions', 999, 'active_sessions', 1);
  END IF;

  -- 2) Get user tier + metadata override
  SELECT tier, (metadata->>'max_sessions_override')::int
  INTO v_tier, v_override
  FROM subscriptions
  WHERE user_id = v_user_id AND status IN ('active', 'trialing')
  LIMIT 1;

  v_tier := COALESCE(v_tier, 'free');

  -- 3) Determine max sessions: override > tier default
  IF v_override IS NOT NULL AND v_override > 0 THEN
    v_max_sessions := v_override;
  ELSE
    v_max_sessions := CASE v_tier
      WHEN 'free' THEN 1
      WHEN 'pro' THEN 3
      WHEN 'enterprise' THEN 5
      ELSE 1
    END;
  END IF;

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

  -- Kick oldest if over limit (not the current device)
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

-- Helper RPC: Admin can set per-user session override
-- Pass NULL to remove override
CREATE OR REPLACE FUNCTION admin_set_session_override(
  p_user_id      uuid,
  p_max_sessions int DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  UPDATE subscriptions
  SET metadata = CASE
    WHEN p_max_sessions IS NULL THEN metadata - 'max_sessions_override'
    ELSE jsonb_set(COALESCE(metadata, '{}'::jsonb), '{max_sessions_override}', to_jsonb(p_max_sessions))
  END,
  updated_at = now()
  WHERE user_id = p_user_id AND status IN ('active', 'trialing');

  RETURN jsonb_build_object('success', true, 'max_sessions_override', p_max_sessions);
END;
$$;

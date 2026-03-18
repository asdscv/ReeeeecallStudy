-- ============================================================
-- 051: 세션 제한 원래대로 복원 (999번 임시 해제 되돌리기)
-- ============================================================
-- 999_e2e_disable_session_limit.sql에서 모든 tier를 99로 풀었던 것을
-- 원래 값(free=1, pro=3, enterprise=5)으로 복원
-- ============================================================

CREATE OR REPLACE FUNCTION register_session(
  p_device_id   text,
  p_device_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  --    원래 값으로 복원: free=1, pro=3, enterprise=5
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

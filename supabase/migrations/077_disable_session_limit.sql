-- ============================================================
-- 077: 세션 제한 비활성화 (소규모 운영 단계)
-- 모든 tier에서 999 세션 허용. 확장 시 다시 활성화.
-- ============================================================

CREATE OR REPLACE FUNCTION register_session(
  p_device_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Upsert session
  INSERT INTO user_sessions (user_id, device_id, last_seen_at)
  VALUES (v_uid, COALESCE(p_device_id, gen_random_uuid()::text), now())
  ON CONFLICT (user_id, device_id)
  DO UPDATE SET last_seen_at = now();

  RETURN jsonb_build_object(
    'allowed', true,
    'tier', 'unlimited',
    'max_sessions', 999,
    'active_sessions', 1
  );
END;
$$;

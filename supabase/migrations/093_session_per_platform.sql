-- ============================================================================
-- Migration 093 — One session per platform (app + web independent)
--
-- Policy: a user may be logged in on ONE app device AND ONE web browser at the
-- same time, but not two apps or two webs. A new login on a platform evicts the
-- other device of THAT platform (kick-old / latest-wins); the other platform is
-- untouched. The evicted device's next session_heartbeat returns session_expired
-- → SessionKicked screen ("다른 기기에서 로그인됨"); it can reclaim manually.
--
-- 086 had turned the limit fully OFF (unlimited 2-arg register_session). This
-- re-enables a per-platform limit. The client now distinguishes a genuine kick
-- (session_expired) from transient network/auth failures, so this no longer
-- causes the false background→foreground kick (PR #137).
--
-- Overload-trap note (see register_session history): we DROP the 2-arg version
-- and create a 3-arg with defaults, so legacy 2-arg callers resolve to the same
-- function (platform='unknown', left unlimited during rollout).
-- ============================================================================

BEGIN;

-- ─── 1. user_sessions.platform ─────────────────────────────────────────────
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS platform TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_user_sessions_platform') THEN
    ALTER TABLE user_sessions ADD CONSTRAINT chk_user_sessions_platform
      CHECK (platform IS NULL OR platform IN ('app', 'web', 'unknown'));
  END IF;
END $$;

-- ─── 2. register_session — per-platform single session ─────────────────────
DROP FUNCTION IF EXISTS public.register_session(text, text);
CREATE OR REPLACE FUNCTION public.register_session(
  p_device_id   text,
  p_device_name text DEFAULT NULL,
  p_platform    text DEFAULT 'unknown'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'not_authenticated');
  END IF;

  -- Upsert the current device, recording its platform.
  INSERT INTO user_sessions (user_id, device_id, device_name, platform, last_seen_at)
  VALUES (v_user_id, p_device_id, p_device_name, p_platform, now())
  ON CONFLICT (user_id, device_id)
  DO UPDATE SET
    last_seen_at = now(),
    device_name  = COALESCE(EXCLUDED.device_name, user_sessions.device_name),
    platform     = EXCLUDED.platform;

  -- One session per platform: evict other devices of THIS platform. The other
  -- platform (e.g. web when registering app) is left alone. Only enforced for
  -- known platforms — legacy 'unknown' (pre-update clients) stays unlimited so
  -- app↔web aren't kicked during the client rollout.
  IF p_platform IN ('app', 'web') THEN
    DELETE FROM user_sessions
    WHERE user_id = v_user_id
      AND platform = p_platform
      AND device_id <> p_device_id;
  END IF;

  -- Hygiene: drop sessions with no heartbeat for 30 days.
  DELETE FROM user_sessions
  WHERE user_id = v_user_id
    AND last_seen_at < now() - interval '30 days';

  RETURN jsonb_build_object('allowed', true, 'platform', p_platform);
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_session(text, text, text)
  TO authenticated, anon, service_role;

COMMIT;

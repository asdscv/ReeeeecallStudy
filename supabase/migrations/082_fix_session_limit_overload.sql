-- ============================================================
-- 082: 세션 제한 오버로드 트랩 수정
-- ============================================================
-- 077은 register_session(text) — 인자 1개 — 를 새로 만들어 제한을 풀려 했으나,
-- 클라이언트는 항상 register_session(text, text) — 인자 2개 — 로 호출한다.
-- Postgres의 CREATE OR REPLACE는 시그니처가 다르면 기존 함수를 덮지 않으므로
-- 075의 2-인자 버전(free=1 제한)이 그대로 살아 있어 077이 무효였다.
--
-- 이 마이그레이션은:
--   1) 실제로 호출되는 2-인자 함수를 제한 없는 버전으로 덮는다.
--   2) 호출되지 않는 죽은 1-인자 오버로드를 제거한다.
-- 향후 제한을 재도입하려면 반드시 "2-인자" 시그니처를 수정할 것.
-- ============================================================

-- 1) 죽은 1-인자 오버로드 제거 (077이 만든 것)
DROP FUNCTION IF EXISTS public.register_session(text);

-- 2) 실제 호출되는 2-인자 함수 — 세션 제한 없이 upsert만 수행
CREATE OR REPLACE FUNCTION public.register_session(
  p_device_id   text,
  p_device_name text DEFAULT NULL
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

  -- 현재 기기 세션 upsert
  INSERT INTO user_sessions (user_id, device_id, device_name, last_seen_at)
  VALUES (v_user_id, p_device_id, p_device_name, now())
  ON CONFLICT (user_id, device_id)
  DO UPDATE SET
    last_seen_at = now(),
    device_name  = COALESCE(EXCLUDED.device_name, user_sessions.device_name);

  -- 위생: 30일 이상 heartbeat 없는 죽은 세션 정리 (활성 세션은 60초마다 갱신되어 영향 없음)
  DELETE FROM user_sessions
  WHERE user_id = v_user_id
    AND last_seen_at < now() - interval '30 days';

  RETURN jsonb_build_object(
    'allowed', true,
    'tier', 'unlimited',
    'max_sessions', 999,
    'active_sessions', 1
  );
END;
$$;

-- 3) 누적된 유령 세션 정리 (영구 device_id 도입 전, 앱 실행마다 쌓인 행)
DELETE FROM user_sessions
WHERE last_seen_at < now() - interval '7 days';

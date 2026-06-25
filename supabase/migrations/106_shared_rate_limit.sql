-- ============================================================================
-- 106: shared API rate limiter (M1).
--
-- 문제: api Edge fn의 레이트리미터가 isolate별 in-memory Map → Supabase가
-- 요청을 여러 isolate로 fan-out하면 유저당 실효 한도가 N×60/min 으로 우회됨.
--
-- 해결: Postgres 원자 카운터(fixed-window)로 모든 isolate가 공유. INSERT ...
-- ON CONFLICT DO UPDATE count+1 RETURNING count 가 행을 잠가 원자 증가. RLS
-- deny-all + SECURITY DEFINER RPC(service_role 전용)로만 접근.
--
-- fixed-window는 경계에서 최대 2×limit 버스트가 가능하나(허용 가능), isolate
-- fan-out 우회보다 훨씬 강함.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.api_rate_limits (
  key           text        NOT NULL,
  window_start  timestamptz NOT NULL,
  count         integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

-- 직접 접근 차단: RLS deny-all(정책 없음). owner로 도는 SECURITY DEFINER RPC만 통과.
ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.api_rate_limits FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_key text, p_limit integer, p_window_seconds integer)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_now          timestamptz := now();
  v_window_start timestamptz;
  v_count        integer;
BEGIN
  IF p_key IS NULL OR p_limit <= 0 OR p_window_seconds <= 0 THEN
    RAISE EXCEPTION 'invalid args';
  END IF;

  -- 현재 fixed-window 버킷 시작 시각
  v_window_start := to_timestamp(
    floor(extract(epoch FROM v_now) / p_window_seconds) * p_window_seconds);

  -- 원자 증가 (행 잠금). count는 limit+1에서 상한 → INTEGER 오버플로(→ fail-open)
  -- 와 무한 증가 방지. limit+1 > limit 이므로 거부 판정은 그대로 유지.
  INSERT INTO api_rate_limits (key, window_start, count)
  VALUES (p_key, v_window_start, 1)
  ON CONFLICT (key, window_start)
  DO UPDATE SET count = LEAST(api_rate_limits.count + 1, p_limit + 1)
  RETURNING count INTO v_count;

  -- 정리는 새 윈도의 첫 요청에서만(요청당 쓰기증폭/락경합 방지 — 키·윈도당 1회).
  IF v_count = 1 THEN
    DELETE FROM api_rate_limits WHERE key = p_key AND window_start < v_window_start;
    -- 가끔 전역 정리(비활성 키 잔존 행 제거; pg_cron 미설치 환경 대비).
    IF random() < 0.05 THEN
      DELETE FROM api_rate_limits
       WHERE window_start < v_window_start - make_interval(secs => p_window_seconds * 10);
    END IF;
  END IF;

  IF v_count > p_limit THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'retry_after', GREATEST(1, ceil(extract(epoch FROM
        (v_window_start + make_interval(secs => p_window_seconds) - v_now)))::int)
    );
  END IF;

  RETURN jsonb_build_object('allowed', true, 'remaining', GREATEST(0, p_limit - v_count));
END;
$$;

-- service_role(Edge fn) 전용
REVOKE EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer) TO service_role;

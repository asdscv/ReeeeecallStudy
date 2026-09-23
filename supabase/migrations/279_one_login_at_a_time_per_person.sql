-- 279: 한 사람의 로그인은 한 번에 하나씩.
--
-- 정책은 "플랫폼당 1세션"이다(mig 093). `register_session` 은 그것을 이렇게 지킨다:
--
--   1) 내 세션을 INSERT (또는 갱신)
--   2) 같은 플랫폼의 **다른** device_id 를 DELETE
--
-- 두 기기가 **정확히 같은 순간**에 이걸 하면 무너진다. 서로의 INSERT 가 아직 커밋되지
-- 않아 상대 행이 보이지 않고, 그래서 2) 의 DELETE 가 아무것도 지우지 못한다. 각자 자기
-- 행만 남기고 끝나므로 세션이 여러 개 살아남는다.
--
-- ── 왜 지금까지 안 보였나 ────────────────────────────────────────────────────
--
-- 프로덕션에서는 **엣지 스로틀(~6 rps)이 동시 요청을 사실상 직렬화**해 왔다. 32개 기기가
-- 동시에 등록해도 실제로는 줄을 서서 하나씩 처리되니 충돌 자체가 일어나지 않았다.
-- `session-stress-test.mjs` 의 시나리오 C 가 프로덕션에서 통과한 것은 코드가 옳아서가
-- 아니라 그 때문이었다. 스로틀이 없는 로컬 스택에서 같은 테스트를 돌리면:
--
--   프로덕션  32개 동시 등록 → 1행 생존 ✅
--   로컬      32개 동시 등록 → **9행 생존** ❌
--
-- ── 고치는 방법 ─────────────────────────────────────────────────────────────
--
-- `grant_subscription` 이 이미 쓰는 패턴을 그대로 쓴다 —
-- `pg_advisory_xact_lock` 으로 **(사용자, 플랫폼)** 단위 직렬화. 두 번째 트랜잭션은
-- 첫 번째가 커밋될 때까지 기다리고, 그 다음 DELETE 는 커밋된 행을 볼 수 있다.
--
-- 락 키에 플랫폼을 넣는 이유: 앱과 웹은 서로 다른 슬롯이라 **서로를 기다릴 이유가 없다.**
-- 같은 사람의 같은 플랫폼 기기들끼리만 줄을 선다.
--
-- salt 를 93 으로 둔 것은 `grant_subscription` 의 77 과 충돌하지 않게 하기 위해서다
-- (93 = 세션 정책을 만든 마이그레이션 번호).
--
-- `unknown` 플랫폼은 애초에 DELETE 단계가 없어 경쟁이 없다. 불필요한 대기를 만들지
-- 않도록 app/web 일 때만 잠근다.
--
-- ── 위험 ────────────────────────────────────────────────────────────────────
--
-- 이 함수는 앱을 켤 때마다 지나가는 길목이다. 락을 새로 다는 것은 공짜가 아니다.
-- 다만 락 범위가 **한 사람의 한 플랫폼**이라 서로 다른 사용자끼리는 전혀 만나지 않고,
-- 같은 사람의 기기가 동시에 등록하는 일 자체가 드물다. 트랜잭션 종료와 함께 자동으로
-- 풀리므로(`_xact_`) 해제를 잊을 경로도 없다.

CREATE OR REPLACE FUNCTION public.register_session(
  p_device_id text,
  p_device_name text DEFAULT NULL::text,
  p_platform text DEFAULT 'unknown'::text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'not_authenticated');
  END IF;

  -- Ban enforcement (mig 153): a banned/suspended account cannot hold a session.
  IF public.is_user_banned(v_user_id) THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'banned');
  END IF;

  -- 279: 같은 사람의 같은 플랫폼 등록을 직렬화한다. 이게 없으면 동시 등록이 서로의
  -- 미커밋 INSERT 를 못 봐서 아래 DELETE 가 아무도 쫓아내지 못한다.
  IF p_platform IN ('app', 'web') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_platform, 93));
  END IF;

  INSERT INTO user_sessions (user_id, device_id, device_name, platform, last_seen_at)
  VALUES (v_user_id, p_device_id, p_device_name, p_platform, now())
  ON CONFLICT (user_id, device_id)
  DO UPDATE SET
    last_seen_at = now(),
    device_name  = COALESCE(EXCLUDED.device_name, user_sessions.device_name),
    platform     = EXCLUDED.platform;

  IF p_platform IN ('app', 'web') THEN
    DELETE FROM user_sessions
    WHERE user_id = v_user_id
      AND platform = p_platform
      AND device_id <> p_device_id;
  END IF;

  DELETE FROM user_sessions
  WHERE user_id = v_user_id
    AND last_seen_at < now() - interval '30 days';

  RETURN jsonb_build_object('allowed', true, 'platform', p_platform);
END;
$function$;

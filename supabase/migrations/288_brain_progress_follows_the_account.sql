-- 288: 두뇌 트레이닝 기록이 기기가 아니라 계정을 따라다닙니다.
--
-- 지금 기록은 기기에만 있습니다 — 웹 localStorage `reeeeecall-brain:<uid>`(+`:history`, `:meta`), 앱 SecureStore
-- `brain-progress.<uid>`·`brain-history.<uid>`·`brain-meta.<uid>`. 그래서 새 폰, 앱 재설치, 다른 브라우저,
-- 웹↔앱 전환, 사파리가 오래 안 연 사이트의 저장소를 비우는 경우마다 9개 게임이 전부 레벨 1에서 다시 시작합니다.
-- 대표 지적(2026-11-13): «지금 할 때마다 계속 레벨 1부터 시작?».
--
-- ── 모양 ────────────────────────────────────────────────────────────────────
-- 계정당 한 행. 엔진이 이미 직렬화하는 JSON 세 덩이를 그대로 담습니다.
--   progress — 게임별 레벨·라운드, 오늘의 훈련 기록 (progress.ts)
--   history  — 게임별 최근 8라운드 추세선 (history.ts)
--   meta     — 게임별 실력 추정·티어·소개한 규칙·업적·연습 진행 (meta.ts). 앱 SecureStore 한 값이 ~2KB 라
--              progress 옆에 따로 둔 값이고, 서버에서도 같은 이유로 칼럼을 나눕니다.
-- 게임별 칼럼으로 쪼개지 않는 이유: 병합 규칙은 클라이언트의 순수 함수 하나
-- (packages/shared/lib/brain-games/sync.ts)에 있고, 앱 OTA 가 웹 배포(develop 머지)보다 늦게 나가므로
-- 서버가 필드 의미를 알면 두 버전이 서버에서 다툽니다. 서버는 크기·모양·포맷 버전·rev 만 봅니다.
--
-- ── 동시성 ──────────────────────────────────────────────────────────────────
-- rev 낙관적 잠금. p_base_rev 가 현재 rev 와 같을 때만 쓰고(rev+1), 다르면 쓰지 않고 현재 행을
-- 돌려줍니다(status='conflict'). 클라이언트가 병합해서 새 rev 로 다시 보냅니다(최대 3번). 첫 저장은 base 0.
-- 첫 저장 두 개가 동시에 오면 ON CONFLICT DO NOTHING 으로 하나만 들어가고, 진 쪽은 conflict 를 받습니다.
-- 응답이 유실된 재시도는 conflict 로 돌아오고, 병합 결과가 서버 것과 같으므로 다시 쓰지 않습니다.
--
-- ── p_user_id 는 권한이 아니라 단언입니다 ─────────────────────────────────────
-- 행은 언제나 auth.uid() 의 것입니다. p_user_id 가 auth.uid() 와 다르면 거절합니다 — 계정 A 로 예약된
-- 저장이 B 로 바뀐 세션 토큰에 실려 나가 B 의 행을 A 의 기록으로 덮는 경쟁을 서버가 막습니다.
-- 그래서 04_DATABASE §2 의 is_admin()/service_role 우회를 두지 않습니다: 쓰는 행이 호출자 자신의 것이라
-- 우회는 관리자의 묵은 저장이 관리자 자신의 행을 덮게 할 뿐이고, service_role 은 auth.uid() 가 없어 못 씁니다.
--
-- ── 포맷 버전 ───────────────────────────────────────────────────────────────
-- progress·history·meta 의 "v" 가 저장된 것보다 낮으면 쓰지 않습니다(status='client_outdated').
-- 새 포맷을 모르는 옛 앱(parseProgress 는 모르는 v 를 빈 기록으로 읽는다)이 새 기록을 옛 모양으로
-- 덮어 지우는 사고를 막는 서버 쪽 백스톱입니다. 클라이언트도 같은 검사를 먼저 하고, 그 뒤로는 올리지 않습니다.
-- p_history·p_meta 가 NULL 이면 저장된 값을 그대로 둡니다(그 덩이를 모르는 클라이언트가 지우지 못하게).
--
-- ── 크기 ────────────────────────────────────────────────────────────────────
-- 실측: 9게임 × 5,000 라운드를 돌린 최악의 기록이 progress 1,798B · history 1,152B(병합 후도 같음),
-- meta 409B(설계 최악치). 덩이마다 16KB 상한은 앞으로 붙을 필드를 위한 여유이면서 한 행이 무한히 부풀 수
-- 없게 하는 천장입니다. octet_length(jsonb::text) 기준 — jsonb 출력은 «, »·«: » 공백이 붙어 압축 JSON 보다
-- 조금 깁니다(클라이언트도 같은 길이로 미리 잽니다).
--
-- ── 쓰기 경로 ───────────────────────────────────────────────────────────────
-- mig 103 의 기본 권한이 새 표에 anon/authenticated DML 을 자동으로 줍니다. 쓰기 권한을 회수해
-- save_brain_progress 하나로만 쓰게 합니다(rev·크기·버전 검사를 건너뛰는 PostgREST 직접 POST 차단 —
-- 04_DATABASE §7). 읽기는 «자기 행만» RLS 로 열어 둡니다. mig 253 과 같은 모양.
--
-- ── 개인정보 ────────────────────────────────────────────────────────────────
-- 게임 기록 원본만 담습니다. 서버에서 레벨·역치로 '인지 상태'를 추론하거나 파생 칼럼·관리자 화면·
-- 저하 알림을 만들지 않습니다(DOCS/BRAIN_TRAINING/EVIDENCE.md #27, 개인정보보호법 제23조).
-- 그래서 관리자 읽기 경로도 두지 않습니다. 계정 삭제(delete_user_account → auth.users 삭제) 때
-- ON DELETE CASCADE 로 함께 지워집니다.
--
-- ── 배포 순서 ───────────────────────────────────────────────────────────────
-- 웹은 develop 머지가 곧 운영 배포이므로 이 파일을 먼저 운영에 적용합니다. 빠뜨려도 사고는 아닙니다 —
-- 클라이언트는 함수가 없으면(PGRST202/42883/42P01/404) 조용히 기기 전용으로 돕니다.
BEGIN;

CREATE TABLE IF NOT EXISTS public.brain_saves (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  progress   jsonb NOT NULL,
  history    jsonb NOT NULL DEFAULT '{"v":1,"rounds":{}}'::jsonb,
  meta       jsonb NOT NULL DEFAULT '{"v":1}'::jsonb,
  rev        integer NOT NULL DEFAULT 1 CHECK (rev >= 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- RPC 가 먼저 거르지만, 표 자체도 같은 천장을 갖습니다(service_role 경로·향후 다른 함수 대비).
  CONSTRAINT brain_saves_progress_shape CHECK (jsonb_typeof(progress) = 'object' AND octet_length(progress::text) <= 16384),
  CONSTRAINT brain_saves_history_shape  CHECK (jsonb_typeof(history)  = 'object' AND octet_length(history::text)  <= 16384),
  CONSTRAINT brain_saves_meta_shape     CHECK (jsonb_typeof(meta)     = 'object' AND octet_length(meta::text)     <= 16384)
);

COMMENT ON TABLE public.brain_saves IS
  'Brain-training progress + recent-round history + game meta (skill estimates, tiers, seen rules), one row per account, as the client engine serialises it. Opaque to the server: no derived columns, no admin read path (no cognitive inference, EVIDENCE.md #27). Written only by save_brain_progress (rev optimistic concurrency).';

ALTER TABLE public.brain_saves ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner reads own brain save" ON public.brain_saves;
CREATE POLICY "Owner reads own brain save" ON public.brain_saves
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- 쓰기 정책도 «자기 행만» 으로 둡니다. 아래에서 쓰기 권한을 회수하므로 지금은 효력이 없습니다 —
-- 권한이 어떤 이유로(기본 권한 재부여, 누군가의 GRANT) 되살아나는 날의 두 번째 벽입니다.
DROP POLICY IF EXISTS "Owner inserts own brain save" ON public.brain_saves;
CREATE POLICY "Owner inserts own brain save" ON public.brain_saves
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Owner updates own brain save" ON public.brain_saves;
CREATE POLICY "Owner updates own brain save" ON public.brain_saves
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

REVOKE ALL ON public.brain_saves FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.brain_saves TO authenticated;
GRANT ALL ON public.brain_saves TO service_role;

/**
 * 내 기록 한 벌. 저장한 적이 없으면 NULL.
 * user_id 를 함께 돌려줍니다 — 계정 전환 직전에 나간 요청의 응답을 클라이언트가 걸러낼 수 있게.
 */
CREATE OR REPLACE FUNCTION public.get_my_brain_save()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING errcode = '42501';
  END IF;
  SELECT jsonb_build_object(
           'user_id', s.user_id, 'progress', s.progress, 'history', s.history, 'meta', s.meta,
           'rev', s.rev, 'updated_at', s.updated_at)
    INTO v_out
    FROM brain_saves s
   WHERE s.user_id = v_uid;
  RETURN v_out;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_brain_save() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_my_brain_save() TO authenticated;
COMMENT ON FUNCTION public.get_my_brain_save() IS
  'The caller''s brain save {user_id, progress, history, meta, rev, updated_at}, or NULL if never saved.';

-- 설계 초안의 4인자판이 어디엔가 남아 있으면 PostgREST 가 오버로드를 잘못 고릅니다(04_DATABASE §2).
DROP FUNCTION IF EXISTS public.save_brain_progress(uuid, integer, jsonb, jsonb);

/**
 * 병합을 마친 기록을 씁니다. p_base_rev = 클라이언트가 병합의 기준으로 삼은 rev(행이 없었으면 0).
 *   {status:'saved', rev, updated_at}
 *   {status:'conflict', user_id, rev, progress, history, meta, updated_at}   -- 쓰지 않음. 병합 후 재시도
 *   {status:'client_outdated', rev}                                          -- 저장된 포맷이 더 새로움. 쓰지 않음
 * p_history·p_meta NULL = 저장된 값 유지.
 */
CREATE OR REPLACE FUNCTION public.save_brain_progress(
  p_user_id  uuid,
  p_base_rev integer,
  p_progress jsonb,
  p_history  jsonb DEFAULT NULL,
  p_meta     jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row brain_saves%ROWTYPE;
  v_stored_pv integer;
  v_stored_hv integer;
  v_stored_mv integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING errcode = '42501';
  END IF;
  IF p_user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Signed in as a different account' USING errcode = '42501';
  END IF;
  IF p_base_rev IS NULL OR p_base_rev < 0 THEN
    RAISE EXCEPTION 'p_base_rev must be 0 or more' USING errcode = '22023';
  END IF;
  IF p_progress IS NULL OR jsonb_typeof(p_progress) <> 'object'
     OR COALESCE(p_progress->>'v', '') !~ '^[1-9][0-9]{0,3}$'
     OR octet_length(p_progress::text) > 16384 THEN
    RAISE EXCEPTION 'Invalid brain progress' USING errcode = '22023';
  END IF;
  IF p_history IS NOT NULL AND (
       jsonb_typeof(p_history) <> 'object'
       OR COALESCE(p_history->>'v', '') !~ '^[1-9][0-9]{0,3}$'
       OR octet_length(p_history::text) > 16384) THEN
    RAISE EXCEPTION 'Invalid brain history' USING errcode = '22023';
  END IF;
  IF p_meta IS NOT NULL AND (
       jsonb_typeof(p_meta) <> 'object'
       OR COALESCE(p_meta->>'v', '') !~ '^[1-9][0-9]{0,3}$'
       OR octet_length(p_meta::text) > 16384) THEN
    RAISE EXCEPTION 'Invalid brain meta' USING errcode = '22023';
  END IF;

  SELECT * INTO v_row FROM brain_saves WHERE user_id = v_uid FOR UPDATE;

  IF NOT FOUND THEN
    -- 처음 저장. base_rev 와 무관하게 넣습니다(행이 서버 쪽에서 지워졌어도 클라이언트가 병합한 것을 살린다).
    INSERT INTO brain_saves (user_id, progress, history, meta, rev, updated_at)
    VALUES (v_uid, p_progress,
            COALESCE(p_history, '{"v":1,"rounds":{}}'::jsonb),
            COALESCE(p_meta, '{"v":1}'::jsonb),
            1, now())
    ON CONFLICT (user_id) DO NOTHING
    RETURNING * INTO v_row;
    IF FOUND THEN
      RETURN jsonb_build_object('status', 'saved', 'rev', v_row.rev, 'updated_at', v_row.updated_at);
    END IF;
    -- 같은 계정의 다른 기기가 방금 첫 저장을 했습니다. 그 행을 기준으로 아래 rev 검사를 탑니다.
    SELECT * INTO v_row FROM brain_saves WHERE user_id = v_uid FOR UPDATE;
  END IF;

  IF v_row.rev <> p_base_rev THEN
    RETURN jsonb_build_object(
      'status', 'conflict', 'user_id', v_row.user_id, 'rev', v_row.rev,
      'progress', v_row.progress, 'history', v_row.history, 'meta', v_row.meta,
      'updated_at', v_row.updated_at);
  END IF;

  v_stored_pv := CASE WHEN v_row.progress->>'v' ~ '^[0-9]{1,4}$' THEN (v_row.progress->>'v')::integer ELSE 0 END;
  v_stored_hv := CASE WHEN v_row.history->>'v'  ~ '^[0-9]{1,4}$' THEN (v_row.history->>'v')::integer  ELSE 0 END;
  v_stored_mv := CASE WHEN v_row.meta->>'v'     ~ '^[0-9]{1,4}$' THEN (v_row.meta->>'v')::integer     ELSE 0 END;
  IF (p_progress->>'v')::integer < v_stored_pv
     OR (p_history IS NOT NULL AND (p_history->>'v')::integer < v_stored_hv)
     OR (p_meta    IS NOT NULL AND (p_meta->>'v')::integer    < v_stored_mv) THEN
    RETURN jsonb_build_object('status', 'client_outdated', 'rev', v_row.rev);
  END IF;

  UPDATE brain_saves
     SET progress   = p_progress,
         history    = COALESCE(p_history, history),
         meta       = COALESCE(p_meta, meta),
         rev        = rev + 1,
         updated_at = now()
   WHERE user_id = v_uid
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('status', 'saved', 'rev', v_row.rev, 'updated_at', v_row.updated_at);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_brain_progress(uuid, integer, jsonb, jsonb, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.save_brain_progress(uuid, integer, jsonb, jsonb, jsonb) TO authenticated;
COMMENT ON FUNCTION public.save_brain_progress(uuid, integer, jsonb, jsonb, jsonb) IS
  'Write the caller''s merged brain save (progress, history, meta; NULL history/meta = keep stored) iff p_base_rev matches (optimistic concurrency); otherwise return the current row as a conflict. p_user_id is an assertion (must equal auth.uid()), never an authority. Refuses a lower format version than stored (client_outdated).';

NOTIFY pgrst, 'reload schema';

COMMIT;

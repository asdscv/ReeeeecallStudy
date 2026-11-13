-- ============================================================================
-- brain_save_test.sql — mig 288: 두뇌 기록(progress·history·meta) 클라우드 저장.
--
--   1. 남의 기록은 읽을 수 없다 — RPC 로도, 직접 SELECT 로도.
--   2. 남의 기록에 쓸 수 없다 — 위조한 p_user_id 로도, 직접 INSERT/UPDATE/DELETE 로도.
--   3. 내 기록은 읽고 쓸 수 있다. 격리만 보면 «항상 NULL» 로도 통과하므로 양쪽을 함께 고정한다.
--   4. rev 낙관적 잠금: 낡은 base_rev 는 쓰지 않고 현재 행(meta 포함)을 돌려준다.
--   5. history·meta 를 NULL 로 보내면 저장된 값을 그대로 둔다(그 덩이를 모르는 클라이언트가 못 지운다).
--   6. 크기·모양·포맷 버전 하향을 거절한다. 거절된 호출은 아무것도 바꾸지 않는다(net-zero).
--   7. anon 은 함수도 표도 못 쓴다. 계정을 지우면 기록도 같이 간다.
--
-- 예외는 플래그와 SQLERRM 에 담아 블록 밖에서 단언한다 — 권한 오류(42501)가 가드 오류(42501)를
-- 가리지 않게 메시지까지 본다(04_DATABASE §4 함정 4).
-- RPC 는 SET LOCAL ROLE authenticated 로 부른다 — GRANT EXECUTE·RLS 까지 실제 경로로 검증한다.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id) VALUES
  ('b2880000-0000-4000-8000-00000000000a'),   -- A: 기록 주인
  ('b2880000-0000-4000-8000-00000000000b')    -- B: 남의 기록을 노리는 쪽
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_a  uuid  := 'b2880000-0000-4000-8000-00000000000a';
  v_b  uuid  := 'b2880000-0000-4000-8000-00000000000b';
  v_p1 jsonb := '{"v":1,"games":{"schulte":{"level":6,"bestLevel":6,"rounds":10,"wins":9}},"totalRounds":10}';
  v_p2 jsonb := '{"v":1,"games":{"schulte":{"level":7,"bestLevel":7,"rounds":14,"wins":12}},"totalRounds":14}';
  v_h1 jsonb := '{"v":1,"rounds":{"schulte":[[680,60,90]]}}';
  v_m1 jsonb := '{"v":1,"sk":{"schulte":{"mu":6.2,"sd":1.4,"n":10,"day":680}},"tier":{"schulte":1},"seen":"3","ach":""}';
  v_m2 jsonb := '{"v":1,"sk":{"schulte":{"mu":7.1,"sd":1.1,"n":14,"day":681}},"tier":{"schulte":2},"seen":"7","ach":"1"}';
  v_evil jsonb := '{"v":1,"games":{},"totalRounds":0}';
  r    jsonb;
  n    integer;
  blocked boolean;
  v_err text;
BEGIN
  -- ── 0. 로그인 없이는 둘 다 거절 ──────────────────────────────────────────
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  blocked := false;
  BEGIN PERFORM get_my_brain_save();
  EXCEPTION WHEN insufficient_privilege THEN blocked := true; v_err := SQLERRM; END;
  IF NOT blocked OR v_err NOT LIKE 'Authentication required%' THEN
    RAISE EXCEPTION 'FAIL: 로그인 없이 get_my_brain_save 가 돌았다 (%)', v_err;
  END IF;
  blocked := false;
  BEGIN PERFORM save_brain_progress(v_a, 0, v_p1, v_h1, v_m1);
  EXCEPTION WHEN insufficient_privilege THEN blocked := true; v_err := SQLERRM; END;
  IF NOT blocked OR v_err NOT LIKE 'Authentication required%' THEN
    RAISE EXCEPTION 'FAIL: 로그인 없이 save_brain_progress 가 돌았다 (%)', v_err;
  END IF;

  -- ── 1. A 의 첫 저장(base 0) → rev 1, 읽으면 세 덩이 그대로 ─────────────────
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_a::text, true);
  SET LOCAL ROLE authenticated;
  r := save_brain_progress(v_a, 0, v_p1, v_h1, v_m1);
  IF r->>'status' <> 'saved' OR (r->>'rev')::int <> 1 THEN
    RAISE EXCEPTION 'FAIL: A 의 첫 저장이 %', r;
  END IF;
  r := get_my_brain_save();
  IF r IS NULL OR (r->>'rev')::int <> 1 OR r->'progress' <> v_p1 OR r->'history' <> v_h1
     OR r->'meta' IS DISTINCT FROM v_m1 OR (r->>'user_id')::uuid <> v_a THEN
    RAISE EXCEPTION 'FAIL: A 가 읽은 자기 기록이 %', r;
  END IF;
  SELECT count(*) INTO n FROM brain_saves;          -- RLS: 자기 행은 직접 SELECT 로도 보인다
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: A 의 직접 SELECT 가 %행 (1이어야 함)', n; END IF;

  -- ── 2. 낡은 base_rev → 쓰지 않고 현재 행(meta 포함)을 돌려준다 ─────────────
  r := save_brain_progress(v_a, 0, v_evil, NULL, NULL);
  IF r->>'status' <> 'conflict' OR (r->>'rev')::int <> 1 OR r->'progress' <> v_p1
     OR r->'history' <> v_h1 OR r->'meta' IS DISTINCT FROM v_m1 OR (r->>'user_id')::uuid <> v_a THEN
    RAISE EXCEPTION 'FAIL: 낡은 rev 저장의 응답이 %', r;
  END IF;

  -- ── 3. 맞는 base_rev → rev 2. history·meta NULL 은 저장된 값 유지 ──────────
  r := save_brain_progress(v_a, 1, v_p2, NULL, NULL);
  IF r->>'status' <> 'saved' OR (r->>'rev')::int <> 2 THEN
    RAISE EXCEPTION 'FAIL: base 1 저장이 %', r;
  END IF;
  -- p_meta 를 아예 빼고 부른 옛 모양(4인자)도 같은 함수가 받는다 — 기본값 NULL = 유지
  r := save_brain_progress(v_a, 2, v_p2, NULL);
  IF r->>'status' <> 'saved' OR (r->>'rev')::int <> 3 THEN
    RAISE EXCEPTION 'FAIL: p_meta 없이 부른 저장이 %', r;
  END IF;
  RESET ROLE;
  SELECT count(*) INTO n FROM brain_saves
   WHERE user_id = v_a AND rev = 3 AND progress = v_p2 AND history = v_h1 AND meta = v_m1;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: rev 3 행이 기대와 다르다 (낡은 저장이 썼거나 history·meta 가 사라졌다)'; END IF;

  -- meta 만 바꾸는 저장: meta 는 새 값, history 는 그대로
  SET LOCAL ROLE authenticated;
  r := save_brain_progress(v_a, 3, v_p2, NULL, v_m2);
  IF r->>'status' <> 'saved' OR (r->>'rev')::int <> 4 THEN
    RAISE EXCEPTION 'FAIL: meta 저장이 %', r;
  END IF;
  r := get_my_brain_save();
  IF r->'meta' IS DISTINCT FROM v_m2 OR r->'history' <> v_h1 OR (r->>'rev')::int <> 4 THEN
    RAISE EXCEPTION 'FAIL: meta 저장 뒤 읽은 기록이 %', r;
  END IF;

  -- ── 4. B 는 A 의 기록을 읽을 수 없다 ────────────────────────────────────────
  PERFORM set_config('request.jwt.claim.sub', v_b::text, true);
  r := get_my_brain_save();
  IF r IS NOT NULL THEN RAISE EXCEPTION 'FAIL: B 의 get_my_brain_save 가 남의 기록을 돌려줬다: %', r; END IF;
  SELECT count(*) INTO n FROM brain_saves;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: B 가 직접 SELECT 로 %행을 읽었다', n; END IF;
  SELECT count(*) INTO n FROM brain_saves WHERE user_id = v_a;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: B 가 A 의 행을 user_id 로 집어 읽었다'; END IF;

  -- ── 5. B 는 A 의 기록에 쓸 수 없다 ──────────────────────────────────────────
  -- 5a. 위조한 p_user_id: 가드 메시지로 거절(권한 오류가 아니라). base 를 A 의 현재 rev 로 맞춰도.
  blocked := false; v_err := NULL;
  BEGIN r := save_brain_progress(v_a, 4, v_evil, v_evil, v_evil);
  EXCEPTION WHEN insufficient_privilege THEN blocked := true; v_err := SQLERRM; END;
  IF NOT blocked OR v_err NOT LIKE 'Signed in as a different account%' THEN
    RAISE EXCEPTION 'FAIL: B 가 p_user_id=A 로 저장했다 (blocked=%, err=%, r=%)', blocked, v_err, r;
  END IF;
  -- 5b. 직접 UPDATE / INSERT(남의 것·내 것) / DELETE — 쓰기 권한 자체가 없다
  blocked := false;
  BEGIN UPDATE brain_saves SET progress = v_evil, rev = 99 WHERE user_id = v_a;
  EXCEPTION WHEN insufficient_privilege THEN blocked := true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'FAIL: B 의 직접 UPDATE 가 거절되지 않았다'; END IF;
  blocked := false;
  BEGIN INSERT INTO brain_saves (user_id, progress) VALUES (v_a, v_evil);
  EXCEPTION WHEN insufficient_privilege THEN blocked := true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'FAIL: B 가 A 의 user_id 로 직접 INSERT 했다'; END IF;
  blocked := false;
  BEGIN INSERT INTO brain_saves (user_id, progress) VALUES (v_b, v_evil);
  EXCEPTION WHEN insufficient_privilege THEN blocked := true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'FAIL: 직접 INSERT 가 열려 있다 — rev·크기·버전 검사를 건너뛸 수 있다'; END IF;
  blocked := false;
  BEGIN DELETE FROM brain_saves WHERE user_id = v_a;
  EXCEPTION WHEN insufficient_privilege THEN blocked := true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'FAIL: B 의 직접 DELETE 가 거절되지 않았다'; END IF;

  -- ── 6. B 는 자기 기록을 따로 가진다(격리가 기능을 죽이지 않았는가) ─────────
  r := save_brain_progress(v_b, 0, v_evil, NULL, NULL);
  IF r->>'status' <> 'saved' OR (r->>'rev')::int <> 1 THEN
    RAISE EXCEPTION 'FAIL: B 의 자기 첫 저장이 %', r;
  END IF;
  r := get_my_brain_save();
  IF r->'progress' <> v_evil OR r->'history' <> '{"v":1,"rounds":{}}'::jsonb OR r->'meta' <> '{"v":1}'::jsonb THEN
    RAISE EXCEPTION 'FAIL: B 의 자기 기록(기본 history·meta)이 %', r;
  END IF;
  RESET ROLE;
  SELECT count(*) INTO n FROM brain_saves
   WHERE user_id = v_a AND rev = 4 AND progress = v_p2 AND history = v_h1 AND meta = v_m2;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: B 의 시도 뒤 A 의 행이 바뀌었다'; END IF;

  -- ── 7. 모양·크기·버전 — 거절은 net-zero ────────────────────────────────────
  PERFORM set_config('request.jwt.claim.sub', v_a::text, true);
  SET LOCAL ROLE authenticated;
  blocked := false;
  BEGIN r := save_brain_progress(v_a, 4, jsonb_build_object('v', 1, 'pad', repeat('x', 17000)), NULL, NULL);
  EXCEPTION WHEN invalid_parameter_value THEN blocked := true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'FAIL: 16KB 를 넘는 progress 를 받았다'; END IF;
  blocked := false;
  BEGIN r := save_brain_progress(v_a, 4, v_p2, jsonb_build_object('v', 1, 'pad', repeat('x', 17000)), NULL);
  EXCEPTION WHEN invalid_parameter_value THEN blocked := true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'FAIL: 16KB 를 넘는 history 를 받았다'; END IF;
  blocked := false; v_err := NULL;
  BEGIN r := save_brain_progress(v_a, 4, v_p2, NULL, jsonb_build_object('v', 1, 'pad', repeat('x', 17000)));
  EXCEPTION WHEN invalid_parameter_value THEN blocked := true; v_err := SQLERRM; END;
  IF NOT blocked OR v_err NOT LIKE 'Invalid brain meta%' THEN RAISE EXCEPTION 'FAIL: 16KB 를 넘는 meta 를 받았다 (%)', v_err; END IF;
  -- 16KB 바로 아래는 받는다 — 천장이 너무 낮게 걸리지 않았는가(경계의 다른 쪽)
  r := save_brain_progress(v_a, 4, v_p2, NULL, jsonb_build_object('v', 1, 'pad', repeat('x', 16000)));
  IF r->>'status' <> 'saved' OR (r->>'rev')::int <> 5 THEN RAISE EXCEPTION 'FAIL: 16KB 아래 meta 가 %', r; END IF;
  r := save_brain_progress(v_a, 5, v_p2, NULL, v_m2);
  IF r->>'status' <> 'saved' OR (r->>'rev')::int <> 6 THEN RAISE EXCEPTION 'FAIL: meta 되돌리기가 %', r; END IF;
  blocked := false;
  BEGIN r := save_brain_progress(v_a, 6, '[1,2,3]'::jsonb, NULL, NULL);
  EXCEPTION WHEN invalid_parameter_value THEN blocked := true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'FAIL: 배열을 progress 로 받았다'; END IF;
  blocked := false;
  BEGIN r := save_brain_progress(v_a, 6, '{"games":{}}'::jsonb, NULL, NULL);
  EXCEPTION WHEN invalid_parameter_value THEN blocked := true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'FAIL: 포맷 버전(v) 없는 progress 를 받았다'; END IF;
  blocked := false;
  BEGIN r := save_brain_progress(v_a, 6, v_p2, NULL, '{"sk":{}}'::jsonb);
  EXCEPTION WHEN invalid_parameter_value THEN blocked := true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'FAIL: 포맷 버전(v) 없는 meta 를 받았다'; END IF;
  blocked := false;
  BEGIN r := save_brain_progress(v_a, 6, v_p2, NULL, '[{"v":1}]'::jsonb);
  EXCEPTION WHEN invalid_parameter_value THEN blocked := true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'FAIL: 배열을 meta 로 받았다'; END IF;
  blocked := false;
  BEGIN r := save_brain_progress(v_a, -1, v_p2, NULL, NULL);
  EXCEPTION WHEN invalid_parameter_value THEN blocked := true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'FAIL: 음수 base_rev 를 받았다'; END IF;

  -- 새 포맷(v 2)을 쓴 뒤, 옛 포맷(v 1)이 덮으려 하면 쓰지 않는다 — progress
  r := save_brain_progress(v_a, 6, '{"v":2,"games":{}}'::jsonb, NULL, NULL);
  IF r->>'status' <> 'saved' OR (r->>'rev')::int <> 7 THEN RAISE EXCEPTION 'FAIL: v2 저장이 %', r; END IF;
  r := save_brain_progress(v_a, 7, v_p2, NULL, NULL);
  IF r->>'status' <> 'client_outdated' OR (r->>'rev')::int <> 7 THEN
    RAISE EXCEPTION 'FAIL: 옛 포맷 progress 가 새 포맷을 덮으려 했는데 %', r;
  END IF;
  -- … meta 도 같다
  r := save_brain_progress(v_a, 7, '{"v":2,"games":{}}'::jsonb, NULL, '{"v":2}'::jsonb);
  IF r->>'status' <> 'saved' OR (r->>'rev')::int <> 8 THEN RAISE EXCEPTION 'FAIL: meta v2 저장이 %', r; END IF;
  r := save_brain_progress(v_a, 8, '{"v":2,"games":{}}'::jsonb, NULL, v_m1);
  IF r->>'status' <> 'client_outdated' OR (r->>'rev')::int <> 8 THEN
    RAISE EXCEPTION 'FAIL: 옛 포맷 meta 가 새 포맷을 덮으려 했는데 %', r;
  END IF;
  RESET ROLE;
  SELECT count(*) INTO n FROM brain_saves
   WHERE user_id = v_a AND rev = 8 AND progress = '{"v":2,"games":{}}'::jsonb AND history = v_h1 AND meta = '{"v":2}'::jsonb;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: 거절된 호출들이 A 의 행을 바꿨다'; END IF;

  -- ── 8. anon: 표도 못 읽는다(권한이 아니라 효과로 검사 — 04_DATABASE §3) ───
  SET LOCAL ROLE anon;
  blocked := false;
  BEGIN SELECT count(*) INTO n FROM brain_saves;
  EXCEPTION WHEN insufficient_privilege THEN blocked := true; END;
  RESET ROLE;
  IF NOT blocked THEN RAISE EXCEPTION 'FAIL: anon 이 brain_saves 를 SELECT 했다 (%행)', n; END IF;

  -- ── 9. 계정을 지우면 기록도 간다(delete_user_account → auth.users 삭제) ────
  DELETE FROM auth.users WHERE id = v_b;
  SELECT count(*) INTO n FROM brain_saves WHERE user_id = v_b;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: 지운 계정의 brain_saves 행이 남았다'; END IF;

  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RAISE NOTICE 'brain_save_test: all assertions passed';
END $$;

-- ── 10. 함수 권한: anon 은 못 부르고 authenticated 는 부른다. 옛 4인자 오버로드는 없다 ──
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.get_my_brain_save()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.save_brain_progress(uuid, integer, jsonb, jsonb, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: anon 이 두뇌 기록 함수를 부를 수 있다';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.get_my_brain_save()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.save_brain_progress(uuid, integer, jsonb, jsonb, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: authenticated 가 두뇌 기록 함수를 못 부른다 — 회수가 너무 넓게 갔다';
  END IF;
  IF to_regprocedure('public.save_brain_progress(uuid, integer, jsonb, jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: 4인자 save_brain_progress 오버로드가 남아 있다 — PostgREST 가 엉뚱한 쪽을 고를 수 있다';
  END IF;
  RAISE NOTICE 'brain_save_test: function grants ok';
END $$;

ROLLBACK;

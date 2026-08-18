-- ============================================================================
-- 진단은 **저장까지** 가야 성공이다.
--
-- 246 이 진단을 붙였고, 그 테스트는 근거 수집(`get_learning_diagnosis_evidence`)만 봤습니다.
-- 근거는 잘 모였습니다. 그 다음 줄에서 `persist_ai_remediation` 이 허용 목록에 `diagnose` 가
-- 없다며 거절했고, 진단은 프로덕션에서 **한 번도 성공한 적이 없습니다**(user_enrichments 에
-- action='diagnose' 인 행이 0개였습니다). CI 는 내내 초록이었습니다.
--
-- 이 파일은 그 마지막 한 줄을 봅니다 — 값을 매기고 홀드를 잡는 동작이 아니라, **결과가
-- 남는지**를.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id) VALUES ('dc000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_uid  uuid := 'dc000000-0000-4000-8000-000000000001';
  v_goal uuid;
  v_id   uuid;
  v_n    integer;
BEGIN
  INSERT INTO learning_goals (user_id, domain_id, title, daily_minutes, status)
    VALUES (v_uid, 'language', '진단 저장 확인', 20, 'active') RETURNING id INTO v_goal;

  -- 엣지 함수는 service_role 로 이 함수를 부릅니다.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  -- ══ 1. 진단 결과가 저장된다 ══════════════════════════════════════════════
  v_id := public.persist_ai_remediation(
    p_user_id := v_uid,
    p_action  := 'diagnose',
    p_content := '{"findings":[{"theme":"meaning","cardIds":[]}],"steps":[],"evidence":{}}'::jsonb,
    p_goal_id := v_goal,
    p_request_fingerprint := 'diagnose|' || v_goal::text,
    p_model_version := 'test', p_provider := 'test', p_prompt_version := 'diagnosis-v1');

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'FAIL: 진단이 저장되지 않았다 — 엣지는 이것을 PERSISTENCE 로 받아 502 를 낸다';
  END IF;

  SELECT count(*) INTO v_n
    FROM user_enrichments WHERE id = v_id AND action = 'diagnose' AND user_id = v_uid;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FAIL: 저장된 행을 diagnose 로 읽을 수 없다'; END IF;

  -- ══ 2. 다른 액션들은 그대로 살아 있다 ════════════════════════════════════
  --
  -- 목록에 한 줄을 더한 변경이라, 더하면서 지우지 않았는지를 같이 봅니다.
  FOR v_n IN 1..1 LOOP
    PERFORM public.persist_ai_remediation(
      p_user_id := v_uid, p_action := 'explain',
      p_content := '{"summary":"x"}'::jsonb, p_goal_id := v_goal);
    PERFORM public.persist_ai_remediation(
      p_user_id := v_uid, p_action := 'hint',
      p_content := '{"summary":"x"}'::jsonb, p_goal_id := v_goal);
    PERFORM public.persist_ai_remediation(
      p_user_id := v_uid, p_action := 'compare',
      p_content := '{"summary":"x"}'::jsonb, p_goal_id := v_goal);
  END LOOP;

  -- ══ 3. 아무 문자열이나 되는 것은 아니다 ══════════════════════════════════
  --
  -- 목록이 존재하는 이유는 오타가 조용히 저장되지 않게 하는 것입니다. 넓히면서 열어 버리면
  -- 1번을 고친 대가로 그 보호를 잃습니다.
  BEGIN
    PERFORM public.persist_ai_remediation(
      p_user_id := v_uid, p_action := 'diagnos',   -- 오타
      p_content := '{"summary":"x"}'::jsonb, p_goal_id := v_goal);
    RAISE EXCEPTION 'FAIL: 목록에 없는 액션이 저장됐다';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  RAISE NOTICE 'diagnosis_persists_test: all assertions passed';
END $$;

ROLLBACK;

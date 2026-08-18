-- ============================================================================
-- 해설·비교·진단은 **각자의 값**을 받는다.
--
-- 셋이 `remediation_explain` 한 줄을 같이 썼습니다. 출력 길이가 다른데 값이 같은 것은 259
-- 이전에 객관식과 주관식에 같은 값을 매기던 것과 같은 잘못이고, 실측으로도 다릅니다.
--
-- 262 가 `hint` 를 없앴습니다 — 화면에 누를 데가 없는데 과금되는 액션이었습니다. 그래서
-- 여기서 확인하는 것은 "힌트가 더 싸다"가 아니라 **없어진 액션이 팔리지 않는다**입니다.
--
-- 그리고 값이 **없는** 액션이 0원으로 팔리면 안 됩니다. 조회를 액션 이름에서 만들었으니,
-- 행이 없는 액션은 조용히 공짜가 되는 대신 해설 값으로 떨어져야 합니다.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  v_explain integer; v_compare integer; v_diag integer; v_unknown integer;
BEGIN
  v_explain := public._ai_remediation_price('explain');
  v_compare := public._ai_remediation_price('compare');
  v_diag    := public._ai_remediation_price('diagnose');

  -- ══ 1. 각자 자기 행을 읽는다 ═════════════════════════════════════════════
  IF v_explain <> (SELECT price_micro FROM ai_action_prices WHERE action='remediation_explain') THEN
    RAISE EXCEPTION 'FAIL: explain 이 자기 값을 못 읽는다 (%)', v_explain;
  END IF;
  IF v_compare <> (SELECT price_micro FROM ai_action_prices WHERE action='remediation_compare') THEN
    RAISE EXCEPTION 'FAIL: compare 가 자기 값을 못 읽는다 (%)', v_compare;
  END IF;
  IF v_diag <> (SELECT price_micro FROM ai_action_prices WHERE action='diagnosis') THEN
    RAISE EXCEPTION 'FAIL: diagnose 가 diagnosis 행을 못 읽는다 (%)', v_diag;
  END IF;

  -- ══ 2. 없어진 액션은 예약 자체가 안 된다 ═════════════════════════════════
  --
  -- 값 행을 지우는 것만으로는 부족합니다 — `_ai_remediation_price` 가 해설 값으로 떨어지므로
  -- 행만 지우면 힌트는 $0.03 에 계속 팔립니다. 막는 자리는 `reserve_ai_remediation` 입니다.
  IF EXISTS (SELECT 1 FROM ai_action_prices WHERE action = 'remediation_hint') THEN
    RAISE EXCEPTION 'FAIL: 없앤 힌트의 값 행이 남아 있다';
  END IF;
  BEGIN
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000ff', true);
    PERFORM public.reserve_ai_remediation('hint', NULL, NULL, NULL,
      ARRAY['00000000-0000-4000-8000-0000000000aa']::uuid[], '{}'::uuid[]);
    RAISE EXCEPTION 'FAIL: 없앤 힌트가 예약됐다';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.role', 'postgres', true);

  -- ══ 3. 값이 없는 액션은 공짜가 아니라 해설 값 ════════════════════════════
  v_unknown := public._ai_remediation_price('some_future_action');
  IF v_unknown <> v_explain THEN
    RAISE EXCEPTION 'FAIL: 행 없는 액션이 % 로 팔린다 — 0원이면 무료로 새는 문이다', v_unknown;
  END IF;

  -- ══ 4. 어느 것도 0원이 아니다 ════════════════════════════════════════════
  IF LEAST(v_explain, v_compare, v_diag) <= 0 THEN
    RAISE EXCEPTION 'FAIL: 0원짜리 유료 액션이 있다';
  END IF;

  RAISE NOTICE 'remediation_price_by_action_test: all assertions passed';
END $$;

ROLLBACK;

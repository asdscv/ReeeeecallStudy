-- ============================================================================
-- 해설·힌트·비교·진단은 **각자의 값**을 받는다.
--
-- 넷이 `remediation_explain` 한 줄을 같이 썼습니다. 출력 길이가 다른데 값이 같은 것은 259
-- 이전에 객관식과 주관식에 같은 값을 매기던 것과 같은 잘못이고, 실측으로도 다릅니다
-- (해설 $0.000776 · 힌트 $0.000583).
--
-- 그리고 값이 **없는** 액션이 0원으로 팔리면 안 됩니다. 조회를 액션 이름에서 만들었으니,
-- 행이 없는 액션은 조용히 공짜가 되는 대신 해설 값으로 떨어져야 합니다.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  v_explain integer; v_hint integer; v_compare integer; v_diag integer; v_unknown integer;
BEGIN
  v_explain := public._ai_remediation_price('explain');
  v_hint    := public._ai_remediation_price('hint');
  v_compare := public._ai_remediation_price('compare');
  v_diag    := public._ai_remediation_price('diagnose');

  -- ══ 1. 각자 자기 행을 읽는다 ═════════════════════════════════════════════
  IF v_explain <> (SELECT price_micro FROM ai_action_prices WHERE action='remediation_explain') THEN
    RAISE EXCEPTION 'FAIL: explain 이 자기 값을 못 읽는다 (%)', v_explain;
  END IF;
  IF v_hint <> (SELECT price_micro FROM ai_action_prices WHERE action='remediation_hint') THEN
    RAISE EXCEPTION 'FAIL: hint 가 자기 값을 못 읽는다 (%)', v_hint;
  END IF;
  IF v_compare <> (SELECT price_micro FROM ai_action_prices WHERE action='remediation_compare') THEN
    RAISE EXCEPTION 'FAIL: compare 가 자기 값을 못 읽는다 (%)', v_compare;
  END IF;
  IF v_diag <> (SELECT price_micro FROM ai_action_prices WHERE action='diagnosis') THEN
    RAISE EXCEPTION 'FAIL: diagnose 가 diagnosis 행을 못 읽는다 (%)', v_diag;
  END IF;

  -- ══ 2. 힌트는 해설보다 싸다 ══════════════════════════════════════════════
  --
  -- 숫자를 손으로 적지 않습니다. 확인하려는 것은 "20000 이다"가 아니라 **짧은 출력이 더 싸다**
  -- 는 관계입니다. 값을 조정할 때 이 관계가 뒤집히면 그때 여기서 터져야 합니다.
  IF v_hint >= v_explain THEN
    RAISE EXCEPTION 'FAIL: 힌트가 해설보다 싸지 않다 (hint=% explain=%)', v_hint, v_explain;
  END IF;

  -- ══ 3. 값이 없는 액션은 공짜가 아니라 해설 값 ════════════════════════════
  v_unknown := public._ai_remediation_price('some_future_action');
  IF v_unknown <> v_explain THEN
    RAISE EXCEPTION 'FAIL: 행 없는 액션이 % 로 팔린다 — 0원이면 무료로 새는 문이다', v_unknown;
  END IF;

  -- ══ 4. 어느 것도 0원이 아니다 ════════════════════════════════════════════
  IF LEAST(v_explain, v_hint, v_compare, v_diag) <= 0 THEN
    RAISE EXCEPTION 'FAIL: 0원짜리 유료 액션이 있다';
  END IF;

  RAISE NOTICE 'remediation_price_by_action_test: all assertions passed';
END $$;

ROLLBACK;

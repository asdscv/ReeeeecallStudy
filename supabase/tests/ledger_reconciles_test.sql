-- ============================================================================
-- 원장 합은 언제나 잔액과 같아야 한다.
--
-- 프로덕션에서 두 계정이 어긋나 있었습니다. 하나는 1 micro(2026-07-06 결제에서 시작해 그대로
-- 이어짐), 하나는 -$501.88(시뮬레이션 하네스가 잔액을 직접 써 넣고 지급을 기록하지 않음).
-- 263 이 조정 항목으로 자국을 지웠고, 이 파일이 **코드 경로**를 지킵니다.
--
-- 확인하는 것은 잔액을 움직이는 모든 함수가 원장에도 같은 크기를 남기는가입니다. 하나라도
-- 한쪽만 쓰면 그 뒤로 영원히 어긋나고, 어긋난 원장은 "얼마 썼나"에 답할 수 없습니다.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id) VALUES ('df000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_uid uuid := 'df000000-0000-4000-8000-000000000001';
  v_bal bigint;
  v_sum bigint;
  v_tmpl uuid; v_deck uuid; v_job text;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  -- ── 충전 ────────────────────────────────────────────────────────────────
  PERFORM public.add_ai_credits(v_uid, 1000000, 'purchase', 'test:reconcile:1');

  -- ── 차감 (AI 카드 생성 한 바퀴) ─────────────────────────────────────────
  SELECT id INTO v_tmpl FROM card_templates WHERE user_id = v_uid AND name = '영어 단어';
  IF v_tmpl IS NULL THEN RAISE EXCEPTION 'FAIL: mig 097 seeding did not run'; END IF;
  INSERT INTO decks (user_id, name, default_template_id) VALUES (v_uid, '정합성 덱', v_tmpl)
    RETURNING id INTO v_deck;

  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  -- 무료분을 다 쓰고도 남게 여러 번 돌립니다 — 유료 차감이 실제로 일어나야 이 검사가 뜻이 있습니다.
  FOR i IN 1..3 LOOP
    v_job := public.reserve_ai_generation('cards', 10) ->> 'job_ref';
    PERFORM set_config('request.jwt.claim.role', 'service_role', true);
    PERFORM public.charge_ai_generation(v_uid, v_job, 'test', 'test-model', 100, 100);
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  END LOOP;

  -- ── 환불 ────────────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM public.add_ai_credits(v_uid, 50000, 'refund', 'test:reconcile:refund');

  -- ── 합과 잔액 ───────────────────────────────────────────────────────────
  SELECT balance INTO v_bal FROM ai_credit_balance WHERE user_id = v_uid;
  SELECT COALESCE(sum(delta), 0) INTO v_sum FROM ai_credit_ledger WHERE user_id = v_uid;

  IF v_bal IS DISTINCT FROM v_sum THEN
    RAISE EXCEPTION 'FAIL: 원장 합(%)이 잔액(%)과 다르다 — 차이 %', v_sum, v_bal, v_sum - v_bal;
  END IF;

  -- ── balance_after 사슬 ──────────────────────────────────────────────────
  --
  -- 각 행이 "그때 잔액이 얼마였는지"를 적습니다. 사슬이 끊기면 어느 행에서 갈라졌는지 못 찾고,
  -- 프로덕션에서 실제로 그 사슬을 따라가 2026-07-06 을 찾았습니다.
  PERFORM 1 FROM (
    SELECT balance_after,
           sum(delta) OVER (ORDER BY created_at, id ROWS UNBOUNDED PRECEDING) AS running
      FROM ai_credit_ledger WHERE user_id = v_uid AND balance_after IS NOT NULL) z
   WHERE balance_after IS DISTINCT FROM running;
  IF FOUND THEN
    RAISE EXCEPTION 'FAIL: balance_after 사슬이 끊겼다 — 어느 행에서 갈라졌는지 못 찾게 된다';
  END IF;

  -- ── 잔액 행이 있으면 원장도 있어야 한다 ─────────────────────────────────
  --
  -- simquiz 가 어긋난 방식이 정확히 이것이었습니다: 잔액만 있고 지급 기록이 없음.
  IF EXISTS (SELECT 1 FROM ai_credit_balance b
              WHERE b.user_id = v_uid AND b.balance > 0
                AND NOT EXISTS (SELECT 1 FROM ai_credit_ledger l
                                 WHERE l.user_id = b.user_id AND l.delta > 0)) THEN
    RAISE EXCEPTION 'FAIL: 잔액은 있는데 그 돈이 어디서 왔는지 원장에 없다';
  END IF;

  RAISE NOTICE 'ledger_reconciles_test: all assertions passed';
END $$;

ROLLBACK;

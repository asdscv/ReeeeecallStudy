-- ============================================================================
-- 돈을 낸 사람은 더 많은 카드를 가질 수 있어야 한다.
--
-- 화면은 "Standard 5,000장 / Pro 100,000장"을 팔고 있었는데, 한도를 정하는 함수는 인자를
-- 쓰지 않고 전역 값 하나(1,000)를 돌려줬습니다. 구독 연동은 `check_card_limit` 안에 주석으로만
-- 있었습니다("PHASE 2 SEAM"). 즉 **결제해도 한도가 그대로**였습니다.
--
-- 이 파일은 세 가지를 봅니다: 무료는 무료 한도, 구독자는 산 한도, 그리고 만료된 구독은
-- 아무것도 주지 않는다.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id) VALUES ('e3000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users (id) VALUES ('e3000000-0000-4000-8000-000000000002')
ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users (id) VALUES ('e3000000-0000-4000-8000-000000000003')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_free uuid := 'e3000000-0000-4000-8000-000000000001';
  v_paid uuid := 'e3000000-0000-4000-8000-000000000002';
  v_gone uuid := 'e3000000-0000-4000-8000-000000000003';
  v_free_limit integer;
  v_n integer;
  r jsonb;
BEGIN
  SELECT max_owned_cards INTO v_free_limit FROM card_limit_settings WHERE id = 1;

  -- ══ 1. 무료 사용자는 무료 한도 ═══════════════════════════════════════════
  IF public._owned_card_limit(v_free) <> v_free_limit THEN
    RAISE EXCEPTION 'FAIL: 무료 사용자가 무료 한도를 못 받는다 (%)', public._owned_card_limit(v_free);
  END IF;

  -- ══ 2. 구독자는 **산 한도** ══════════════════════════════════════════════
  INSERT INTO billing_subscriptions (user_id, product_id, tier, status, card_limit, provider)
    VALUES (v_paid, 'sub_5k_monthly', 'plan_5k', 'active', 100000, 'test');
  IF public._owned_card_limit(v_paid) <> 100000 THEN
    RAISE EXCEPTION 'FAIL: 구독자가 산 한도를 못 받는다 (%)', public._owned_card_limit(v_paid);
  END IF;

  -- 그리고 그 한도가 무료보다 커야 말이 됩니다.
  IF public._owned_card_limit(v_paid) <= v_free_limit THEN
    RAISE EXCEPTION 'FAIL: 유료 한도가 무료 한도보다 크지 않다 — 그러면 파는 것이 없다';
  END IF;

  -- ══ 3. 만료된 구독은 아무것도 주지 않는다 ════════════════════════════════
  INSERT INTO billing_subscriptions (user_id, product_id, tier, status, card_limit, provider)
    VALUES (v_gone, 'sub_5k_monthly', 'plan_5k', 'expired', 100000, 'test');
  IF public._owned_card_limit(v_gone) <> v_free_limit THEN
    RAISE EXCEPTION 'FAIL: 만료된 구독이 한도를 계속 준다 (%)', public._owned_card_limit(v_gone);
  END IF;

  -- ══ 4. 실제 생성 차단이 그 숫자를 쓴다 ═══════════════════════════════════
  --
  -- 함수만 맞고 게이트가 다른 숫자를 보면 아무 의미가 없습니다.
  BEGIN
    PERFORM public.check_card_limit(v_free, v_free_limit + 1);
    RAISE EXCEPTION 'FAIL: 무료 한도를 넘는 생성이 통과했다';
  EXCEPTION WHEN sqlstate 'PT402' THEN NULL;
  END;
  -- 구독자는 같은 수를 통과해야 합니다.
  PERFORM public.check_card_limit(v_paid, v_free_limit + 1);

  -- ══ 5. 숫자를 바꾸는 것은 한 번의 호출이어야 한다 ════════════════════════
  --
  -- 값을 올릴 때 기존 고객만 옛 한도에 갇히면 그건 팔지 않은 차별입니다.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  r := public.set_plan_card_limit('sub_5k_monthly', 200000);
  IF (r->>'subscriptions_updated')::int < 1 THEN
    RAISE EXCEPTION 'FAIL: 살아 있는 구독이 함께 올라가지 않았다 (%)', r;
  END IF;
  IF public._owned_card_limit(v_paid) <> 200000 THEN
    RAISE EXCEPTION 'FAIL: 기존 구독자가 새 한도를 못 받는다';
  END IF;
  -- 만료된 것은 그대로. 그때 판 것이 그것입니다.
  SELECT card_limit INTO v_n FROM billing_subscriptions WHERE user_id = v_gone;
  IF v_n <> 100000 THEN RAISE EXCEPTION 'FAIL: 만료된 구독의 스냅샷을 건드렸다'; END IF;

  RAISE NOTICE 'card_limit_by_plan_test: all assertions passed';
END $$;

ROLLBACK;

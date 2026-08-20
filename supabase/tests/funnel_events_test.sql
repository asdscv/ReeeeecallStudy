-- ============================================================================
-- 광고를 켜기 전에 계기판이 실제로 도는지.
--
-- 이 테스트가 지키는 것은 두 가지다.
--   1) 퍼널 다섯 단계가 서버에서 자동으로 남는가 (클라이언트가 아무것도 안 해도)
--   2) 첫 회만 남아야 할 것은 첫 회만, 반복돼야 할 것은 반복해서 남는가
--
-- 그리고 스토어 상품 매핑이 베이스플랜 접미사를 견디는지도 함께 본다. 이건 계측이
-- 아니라 돈 문제다 — 매핑이 NULL 이면 구글은 결제를 받고 구독은 지급되지 않는다.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('f0000000-0000-4000-8000-000000000001', 'funnel-probe@example.com')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_uid  uuid := 'f0000000-0000-4000-8000-000000000001';
  v_deck uuid;
  v_n    integer;
BEGIN
  -- ── 첫 덱: 한 번만 남아야 한다 ──────────────────────────────────────────
  INSERT INTO decks (user_id, name) VALUES (v_uid, 'funnel probe 1') RETURNING id INTO v_deck;
  INSERT INTO decks (user_id, name) VALUES (v_uid, 'funnel probe 2');

  SELECT count(*) INTO v_n FROM analytics_events
   WHERE user_id = v_uid AND category = 'funnel' AND action = 'first_deck_created';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'FAIL: 덱 2개를 만들었는데 first_deck_created 가 %건이다 — 1건이어야 한다', v_n;
  END IF;

  -- ── 첫 학습: 마찬가지 ───────────────────────────────────────────────────
  INSERT INTO study_sessions (user_id, deck_id, study_mode) VALUES (v_uid, v_deck, 'srs');
  INSERT INTO study_sessions (user_id, deck_id, study_mode) VALUES (v_uid, v_deck, 'random');

  SELECT count(*) INTO v_n FROM analytics_events
   WHERE user_id = v_uid AND category = 'funnel' AND action = 'first_study_started';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'FAIL: 세션 2건인데 first_study_started 가 %건이다', v_n;
  END IF;

  -- 라벨에 모드가 실려야 한다. 어떤 모드로 시작하는지가 온보딩 판단의 재료다.
  PERFORM 1 FROM analytics_events
   WHERE user_id = v_uid AND action = 'first_study_started' AND label = 'srs';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FAIL: first_study_started 라벨에 첫 학습 모드가 없다';
  END IF;

  -- ── 결제: 반복돼야 한다 ─────────────────────────────────────────────────
  -- 사람은 크레딧을 여러 번 산다. 첫 회만 남기면 두 번째 결제가 사라진다.
  INSERT INTO payment_intents (merchant_uid, user_id, product_id, kind, amount_krw, amount_micro_usd, status, platform)
  VALUES ('funnel_probe_1', v_uid, 'credits_1000', 'credit_pack', 1000, 990000, 'pending', 'web');
  INSERT INTO payment_intents (merchant_uid, user_id, product_id, kind, amount_krw, amount_micro_usd, status, platform)
  VALUES ('funnel_probe_2', v_uid, 'credits_1000', 'credit_pack', 1000, 990000, 'pending', 'web');

  SELECT count(*) INTO v_n FROM analytics_events
   WHERE user_id = v_uid AND category = 'funnel' AND action = 'checkout_started';
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'FAIL: 체크아웃 2회인데 checkout_started 가 %건이다 — 결제는 반복 기록돼야 한다', v_n;
  END IF;

  -- 완료는 pending → paid 전이에서만. 웹훅이 같은 행을 두 번 확정해도 한 번만 남아야 한다.
  UPDATE payment_intents SET status = 'paid' WHERE merchant_uid = 'funnel_probe_1';
  UPDATE payment_intents SET status = 'paid' WHERE merchant_uid = 'funnel_probe_1';

  SELECT count(*) INTO v_n FROM analytics_events
   WHERE user_id = v_uid AND category = 'funnel' AND action = 'purchase_completed';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'FAIL: paid 전이 1회(중복 확정 포함)인데 purchase_completed 가 %건이다', v_n;
  END IF;

  -- 금액이 실려야 한다. 액수 없는 결제 이벤트로는 ROAS 를 못 만든다.
  PERFORM 1 FROM analytics_events
   WHERE user_id = v_uid AND action = 'purchase_completed' AND value = 990000;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FAIL: purchase_completed 에 결제 금액이 없다';
  END IF;

  -- ── 계측 실패가 본 작업을 죽이지 않아야 한다 ────────────────────────────
  -- _record_funnel 은 어떤 예외도 삼킨다. user_id 가 NULL 이어도 조용히 지나가야 한다.
  PERFORM public._record_funnel(NULL, 'signup_completed', NULL, NULL);
END $$;

-- ── 스토어 매핑: 베이스플랜 접미사를 견디는가 (돈 문제) ─────────────────────
DO $$
BEGIN
  IF public.resolve_store_product('android', 'sub_standard_monthly') IS DISTINCT FROM 'sub_5k_monthly' THEN
    RAISE EXCEPTION 'FAIL: 접미사 없는 안드로이드 구독 id 가 안 풀린다 — 결제는 되고 지급은 안 되는 상태다';
  END IF;
  IF public.resolve_store_product('android', 'sub_standard_monthly:monthly') IS DISTINCT FROM 'sub_5k_monthly' THEN
    RAISE EXCEPTION 'FAIL: 베이스플랜 붙은 형태가 안 풀린다';
  END IF;
  IF public.resolve_store_product('ios', 'standard_monthly') IS DISTINCT FROM 'sub_5k_monthly' THEN
    RAISE EXCEPTION 'FAIL: iOS 매핑이 깨졌다';
  END IF;
  -- 모르는 것은 계속 NULL 이어야 한다. 관대해진 매칭이 아무거나 지급하면 안 된다.
  IF public.resolve_store_product('android', 'totally_unknown_sku') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: 모르는 상품에 값을 돌려준다 — 잘못된 지급이 일어날 수 있다';
  END IF;
END $$;

ROLLBACK;

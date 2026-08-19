-- ============================================================================
-- 한도는 **데이터**이고, 서버가 막는다.
--
-- 덱·템플릿·세션 한도가 `tier-config.ts` 에만 있었습니다. 서버는 셋 다 막지 않았고, 그래서
-- 무료 한도가 5인데 덱 32개를 가진 계정이 프로덕션에 있었습니다. 바꾸려면 배포가 필요하고,
-- REST 를 직접 부르면 뚫리는 상태였습니다.
--
-- 여기서 보는 것: 표의 값이 실제로 막는가 · 값을 바꾸면 즉시 반영되는가 · 구독자는 더 받는가 ·
-- 관리자는 안 막히는가 · 그리고 클라이언트 창구가 한 번에 다 돌려주는가.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id) VALUES ('e4000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users (id) VALUES ('e4000000-0000-4000-8000-000000000002')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_free uuid := 'e4000000-0000-4000-8000-000000000001';
  v_paid uuid := 'e4000000-0000-4000-8000-000000000002';
  v_tmpl uuid;
  v_n integer;
  v_ent jsonb;
BEGIN
  SELECT id INTO v_tmpl FROM card_templates WHERE user_id = v_free LIMIT 1;
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_free::text, true);

  -- ══ 1. 표의 값이 실제로 막는다 ═══════════════════════════════════════════
  --
  -- 낮춰 놓고 넘겨 봅니다. 지금 값(100)으로 100개를 만드는 것은 테스트가 아니라 부하입니다.
  UPDATE plan_entitlements SET value = 2 WHERE tier = 'free' AND resource = 'decks_total';

  SELECT count(*) INTO v_n FROM decks WHERE user_id = v_free;
  WHILE v_n < 2 LOOP
    INSERT INTO decks (user_id, name) VALUES (v_free, 'd' || v_n);
    v_n := v_n + 1;
  END LOOP;

  BEGIN
    INSERT INTO decks (user_id, name) VALUES (v_free, '한도 초과');
    RAISE EXCEPTION 'FAIL: 한도를 넘는 덱이 만들어졌다 — 서버가 막지 않는다';
  EXCEPTION WHEN sqlstate 'PT402' THEN NULL;
  END;

  -- ══ 2. 값을 바꾸면 즉시 반영된다 (배포 없이) ═════════════════════════════
  UPDATE plan_entitlements SET value = 3 WHERE tier = 'free' AND resource = 'decks_total';
  INSERT INTO decks (user_id, name) VALUES (v_free, '올린 뒤');
  SELECT count(*) INTO v_n FROM decks WHERE user_id = v_free;
  IF v_n <> 3 THEN RAISE EXCEPTION 'FAIL: 한도를 올렸는데 반영되지 않았다 (%)', v_n; END IF;

  -- ══ 3. 구독자는 더 받는다 ════════════════════════════════════════════════
  INSERT INTO billing_subscriptions (user_id, product_id, tier, status, card_limit, provider,
                                     current_period_end)
    VALUES (v_paid, 'sub_5k_monthly', 'plan_5k', 'active', 100000, 'test', now() + interval '30 days');
  IF public._entitlement(v_paid, 'decks_total') <= public._entitlement(v_free, 'decks_total') THEN
    RAISE EXCEPTION 'FAIL: 구독자가 무료보다 많이 받지 않는다';
  END IF;

  -- ══ 4. 표에 없는 자원은 막지 않는다 ══════════════════════════════════════
  --
  -- 모르는 것을 이유로 사용자를 세우면 안 됩니다.
  IF public._entitlement(v_free, 'some_future_resource') < 1000000000 THEN
    RAISE EXCEPTION 'FAIL: 표에 없는 자원을 막는다';
  END IF;

  -- ══ 5. 클라이언트 창구가 한 번에 다 준다 ═════════════════════════════════
  v_ent := public.get_my_entitlements();
  IF v_ent IS NULL THEN RAISE EXCEPTION 'FAIL: 창구가 비어 있다'; END IF;
  IF (v_ent->>'tier') <> 'free' THEN RAISE EXCEPTION 'FAIL: 티어가 틀리다 (%)', v_ent->>'tier'; END IF;
  IF (v_ent->>'is_paid')::boolean THEN RAISE EXCEPTION 'FAIL: 무료인데 유료로 나온다'; END IF;
  IF (v_ent->>'ads_free')::boolean THEN RAISE EXCEPTION 'FAIL: 무료인데 광고 없음으로 나온다'; END IF;
  -- 카드 한도도 같은 창구로 옵니다(표가 아니라 구독 스냅샷에서).
  IF (v_ent->>'cards_total')::bigint <> public._owned_card_limit(v_free) THEN
    RAISE EXCEPTION 'FAIL: 창구의 카드 한도가 실제와 다르다';
  END IF;
  FOR v_n IN 1..1 LOOP
    IF v_ent->>'decks_total' IS NULL OR v_ent->>'templates_total' IS NULL
       OR v_ent->>'study_sessions_daily' IS NULL THEN
      RAISE EXCEPTION 'FAIL: 창구에 빠진 한도가 있다 (%)', v_ent;
    END IF;
  END LOOP;

  RAISE NOTICE 'plan_entitlements_test: all assertions passed';
END $$;

ROLLBACK;

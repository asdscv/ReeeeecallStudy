-- ============================================================================
-- 팔고 있는 구독은 **하나**여야 한다.
--
-- 267 이 Pro($19.99)를 내렸습니다. 카탈로그에 두 개가 다시 뜨면 화면은 조용히 두 줄이 되고,
-- 아무도 그것을 실패로 보지 않습니다 — 값은 눈으로만 확인되는 종류라 여기서 셉니다.
--
-- 지우지 않고 끈 이유도 함께 봅니다: 결제 이력이 가리키는 상품 행은 남아 있어야 합니다.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  v_active integer;
  v_id     text;
  v_rows   integer;
BEGIN
  SELECT count(*) INTO v_active
    FROM billing_products WHERE kind = 'subscription' AND is_active;
  IF v_active <> 1 THEN
    RAISE EXCEPTION 'FAIL: 판매 중인 구독이 %개다 — 하나여야 한다', v_active;
  END IF;

  SELECT id INTO v_id
    FROM billing_products WHERE kind = 'subscription' AND is_active;
  IF v_id <> 'sub_5k_monthly' THEN
    RAISE EXCEPTION 'FAIL: 남은 구독이 %다 — 내린 것은 비싼 쪽이어야 한다', v_id;
  END IF;

  -- 행은 남아 있어야 합니다. 지우면 옛 영수증이 가리킬 상품이 사라집니다.
  SELECT count(*) INTO v_rows FROM billing_products WHERE id = 'sub_unlimited_monthly';
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'FAIL: 내린 상품의 행까지 지웠다 — 판매 중지와 기록 삭제는 다르다';
  END IF;

  -- 카탈로그 RPC 가 실제로 하나만 돌려주는지. 화면이 읽는 것은 이쪽입니다.
  SELECT count(*) INTO v_active
    FROM jsonb_array_elements(public.get_billing_products()::jsonb) e
   WHERE e->>'kind' = 'subscription';
  IF v_active <> 1 THEN
    RAISE EXCEPTION 'FAIL: 카탈로그가 구독 %개를 돌려준다', v_active;
  END IF;

  RAISE NOTICE 'single_plan_test: all assertions passed';
END $$;

ROLLBACK;

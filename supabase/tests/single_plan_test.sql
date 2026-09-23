-- ============================================================================
-- 팔고 있는 구독은 **하나**여야 한다.
--
-- 267 이 Pro($19.99)를 내렸습니다. 카탈로그에 두 개가 다시 뜨면 화면은 조용히 두 줄이 되고,
-- 아무도 그것을 실패로 보지 않습니다 — 값은 눈으로만 확인되는 종류라 여기서 셉니다.
--
-- 그리고 "판매 중지와 기록 삭제는 다르다"는 267 의 원칙을 함께 지킵니다.
--
-- 280 이 Pro 행을 실제로 지웠습니다. 원칙을 어긴 게 아니라 **원칙이 적용되지 않는 경우**
-- 였습니다 — 한 번도 팔린 적이 없어 가리킬 이력이 0행이었습니다(구독·인텐트·영수증·동의
-- 전부 확인). 그래서 이 파일도 "그 행이 있는가"를 묻지 않습니다. 그건 이 상품 하나에만
-- 해당하는 사실이고, 다음 카탈로그 편집에서 또 깨집니다.
--
-- 대신 **원칙 자체**를 지킵니다: 이력 테이블에서 billing_products 로 가는 외래키가
-- CASCADE(또는 SET NULL/DEFAULT)면, 상품을 지우는 순간 영수증이 조용히 사라집니다.
-- 그것이 진짜 위험이고, 그 일이 일어날 수 없어야 합니다.
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

  -- 상품을 지워도 결제 이력이 따라 사라지지 않아야 합니다. 외래키가 막아 줍니다 —
  -- NO ACTION/RESTRICT 면 이력이 있는 상품은 애초에 지워지지 않고, CASCADE 면 조용히
  -- 같이 지워집니다. 후자가 되는 순간 "판매 중지와 기록 삭제는 다르다"가 무너집니다.
  SELECT count(*) INTO v_rows
    FROM pg_constraint
   WHERE contype = 'f'
     AND confrelid = 'billing_products'::regclass
     AND confdeltype IN ('c', 'n', 'd');   -- cascade / set null / set default
  IF v_rows <> 0 THEN
    RAISE EXCEPTION
      'FAIL: billing_products 를 참조하는 외래키 %개가 상품 삭제 시 이력을 잃는 설정이다', v_rows;
  END IF;

  -- 그리고 이력이 실제로 붙어 있는 상품은 카탈로그에 남아 있어야 합니다(외래키가
  -- 보장하지만, 이력 행을 먼저 지우고 상품을 지우는 순서로는 우회됩니다).
  SELECT count(*) INTO v_rows
    FROM (
      SELECT product_id FROM billing_subscriptions
      UNION SELECT product_id FROM payment_intents
      UNION SELECT product_id FROM billing_invoices
    ) h
   WHERE h.product_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM billing_products p WHERE p.id = h.product_id);
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'FAIL: 이력이 가리키는데 카탈로그에 없는 상품이 %개다', v_rows;
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

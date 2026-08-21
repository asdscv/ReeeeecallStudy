-- ============================================================================
-- 판매를 중지한 플랜의 **기존 구독자는 계속 갱신되어야 한다**.
--
-- 이 테스트는 어떤 버그를 고치려고 쓴 게 아니라, 곧 저질러질 뻔한 실수를 막으려고 쓴다.
--
-- 267 이 Pro 를 내렸을 때 "그럼 웹훅도 is_active 를 확인해서 퇴역 상품 지급을 막아야
-- 하지 않나" 라는 생각이 자연스럽게 나온다. 실제로 그 제안이 나왔었다. 그런데 그렇게
-- 하면 **이미 돈을 내고 있는 사람의 갱신이 400 으로 거절된다.** 애플/구글은 갱신 대금을
-- 받아 가고 우리는 지급을 끊는 것이다 — 271 이 안드로이드에서 막은 사고와 같은 모양이다.
--
--   is_active = false  →  "새로 팔지 않는다"
--   is_active = false  ≠  "쓰던 사람 끊는다"
--
-- 그래서 경계는 이렇게 그어져 있어야 한다:
--   • 카탈로그(get_billing_products) 는 퇴역 상품을 **빼고** 준다  → 아무도 새로 못 산다
--   • SKU 매핑과 상품 행은 **남는다**                              → 갱신은 계속 지급된다
--
-- 스토어에서 상품을 내리는 것도 같은 이유로 "판매 중지"이지 "삭제"가 아니다.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

-- 퇴역 상품을 하나 만들어 둔다. 실제 Pro 에 의존하면, 나중에 Pro 행을 정리하는 순간
-- 이 테스트가 조용히 무의미해진다.
INSERT INTO billing_products (id, kind, title, price_krw, price_usd_cents, card_limit, period, is_active)
VALUES ('retired_probe_monthly', 'subscription', 'Retired Probe', 9900, 990, 50000, 'monthly', false);

INSERT INTO billing_product_skus (platform, store_product_id, product_id, is_active)
VALUES ('ios', 'retired_probe_ios', 'retired_probe_monthly', true);

DO $$
DECLARE
  v_resolved text;
  v_in_catalog integer;
  v_kind text;
BEGIN
  -- 1) 매핑은 살아 있어야 한다. 갱신 웹훅이 들고 오는 것은 스토어 상품 id 뿐이고,
  --    이게 안 풀리면 지급 경로가 통째로 끊긴다.
  v_resolved := public.resolve_store_product('ios', 'retired_probe_ios');
  IF v_resolved IS DISTINCT FROM 'retired_probe_monthly' THEN
    RAISE EXCEPTION 'FAIL: 퇴역 플랜의 스토어 매핑이 끊겼다 (%) — 기존 구독자 갱신이 지급되지 않는다', v_resolved;
  END IF;

  -- 2) 상품 행도 남아 있어야 한다. 웹훅은 여기서 kind 와 한도를 읽어 지급한다.
  SELECT kind INTO v_kind FROM billing_products WHERE id = 'retired_probe_monthly';
  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'FAIL: 퇴역 상품 행이 사라졌다 — 갱신 시 무엇을 지급할지 알 수 없다';
  END IF;

  -- 3) 그런데 카탈로그에는 나오면 안 된다. 여기까지가 "판매 중지" 의 뜻이다.
  SELECT count(*) INTO v_in_catalog
    FROM jsonb_array_elements(public.get_billing_products('ios')::jsonb) e
   WHERE e->>'id' = 'retired_probe_monthly';
  IF v_in_catalog <> 0 THEN
    RAISE EXCEPTION 'FAIL: 판매 중지한 상품이 카탈로그에 보인다 — 새 고객이 살 수 있다';
  END IF;

  -- 4) 팔고 있는 상품은 당연히 카탈로그에 있어야 한다. 3번이 "전부 숨김" 으로
  --    통과해 버리는 것을 막는 대조군이다.
  SELECT count(*) INTO v_in_catalog
    FROM jsonb_array_elements(public.get_billing_products('ios')::jsonb) e
   WHERE e->>'id' = 'sub_5k_monthly';
  IF v_in_catalog <> 1 THEN
    RAISE EXCEPTION 'FAIL: 팔고 있는 구독이 카탈로그에 없다 — 아무도 살 수 없다';
  END IF;
END $$;

ROLLBACK;

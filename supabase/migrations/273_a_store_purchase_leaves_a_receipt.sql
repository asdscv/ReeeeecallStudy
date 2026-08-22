-- ============================================================================
-- 273 — 스토어 결제도 영수증을 남깁니다
--
-- 2026-08-21, 안드로이드에서 이 앱 최초의 실결제가 났습니다(₩5,900, Standard).
-- 구독은 정상 지급됐는데 **결제 내역에는 아무것도 안 뜹니다.**
--
--   get_my_payment_history(mig 131) 는 payment_intents 의 확정된 행만 읽는다.
--   그런데 RevenueCat 웹훅은 sync_subscription_by_user 로 구독만 upsert 하고
--   payment_intents 는 손대지 않는다. 그래서:
--     • 결제 내역: 비어 있음 (사용자에겐 "돈 냈는데 기록이 없다")
--     • 퍼널 purchase_completed: 안 찍힘 (mig 271 트리거가 status→paid 에 걸려 있음)
--
-- 웹훅 코드 주석은 "클라이언트가 만든 인텐트를 웹훅이 확정하므로 스토어 결제도 여기
-- 뜬다"고 전제하고 있었지만, 실제로는 그 확정이 일어나지 않습니다. 확정에 쓸
-- merchant_uid 를 RC 구독자 속성으로 넘기게 되어 있는데 웹훅이 그 속성을 읽지 않고,
-- 이번 건에서는 속성 자체가 비어 있었습니다(시크릿 키로 재확인).
--
-- ## 이 함수가 하는 일
--
-- 스토어가 실제로 받은 결제를 payment_intents 에 확정 상태로 남깁니다. 순서가 중요합니다:
--
--   1) 같은 스토어 주문이 이미 기록됐으면 아무것도 하지 않는다 (웹훅은 재전송된다)
--   2) 그 사용자의 **최근** pending 인텐트가 있으면 그것을 확정한다
--      — 클라이언트가 결제 직전에 만든 바로 그 행이다. 새로 만들면 같은 결제가
--        두 줄이 되고 checkout_started 도 두 번 찍힌다.
--   3) 없으면 새로 만들어 확정한다 (pending 으로 넣고 paid 로 올린다 — 그래야
--      mig 271 의 두 트리거가 각각 제 자리에서 발화한다)
--
-- 금액은 스토어가 청구한 값을 그대로 적습니다. 카탈로그 가격이 아니라 실제 청구액이
-- 영수증에 남아야 합니다(현지 통화·세금이 반영된 값).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.record_store_payment(
  p_user_id        uuid,
  p_product_id     text,
  p_store_order_id text,
  p_amount_krw     integer,
  p_platform       text,
  p_provider       text
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_kind         text;
  v_merchant_uid text;
BEGIN
  -- 서비스 롤 전용. 클라이언트가 스스로 영수증을 만들 수 있으면 안 된다.
  IF auth.role() <> 'service_role' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING errcode = '42501';
  END IF;
  IF p_user_id IS NULL OR p_product_id IS NULL OR p_store_order_id IS NULL
     OR p_store_order_id = '' THEN
    RETURN json_build_object('ok', false, 'reason', 'missing_args');
  END IF;

  -- 1) 이미 기록된 스토어 주문이면 그대로 둔다. 웹훅은 같은 이벤트를 다시 보낸다.
  SELECT merchant_uid INTO v_merchant_uid
    FROM payment_intents
   WHERE provider_payment_id = p_store_order_id
   LIMIT 1;
  IF v_merchant_uid IS NOT NULL THEN
    RETURN json_build_object('ok', true, 'already', true, 'merchant_uid', v_merchant_uid);
  END IF;

  SELECT kind INTO v_kind FROM billing_products WHERE id = p_product_id;
  IF v_kind IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'unknown_product');
  END IF;

  -- 2) 클라이언트가 결제 직전에 만든 pending 인텐트를 찾는다. mig 272 가 재사용 창을
  --    30분으로 좁힌 뒤로, 여기 걸리는 pending 은 이번 결제의 것이 맞다.
  SELECT merchant_uid INTO v_merchant_uid
    FROM payment_intents
   WHERE user_id = p_user_id
     AND product_id = p_product_id
     AND status = 'pending'
     AND created_at > now() - interval '24 hours'
   ORDER BY created_at DESC
   LIMIT 1;

  -- 3) 없으면 만든다. pending 으로 넣고 아래에서 paid 로 올린다 —
  --    mig 271 의 checkout_started(INSERT) 와 purchase_completed(status→paid) 가
  --    각각 제 자리에서 발화하게 하려면 두 단계여야 한다.
  IF v_merchant_uid IS NULL THEN
    INSERT INTO payment_intents (user_id, product_id, kind, amount_krw, status, platform)
    VALUES (p_user_id, p_product_id, v_kind, p_amount_krw, 'pending', p_platform)
    RETURNING merchant_uid INTO v_merchant_uid;
  END IF;

  UPDATE payment_intents
     SET status              = 'paid',
         paid_at             = now(),
         provider            = p_provider,
         provider_payment_id = p_store_order_id,
         platform            = COALESCE(p_platform, platform),
         amount_krw          = COALESCE(p_amount_krw, amount_krw)
   WHERE merchant_uid = v_merchant_uid;

  RETURN json_build_object('ok', true, 'merchant_uid', v_merchant_uid, 'created', true);
EXCEPTION WHEN OTHERS THEN
  -- 영수증 기록이 지급을 막으면 안 된다. 돈은 이미 받았고 구독은 이미 줬다.
  RETURN json_build_object('ok', false, 'reason', SQLERRM);
END;
$$;

COMMENT ON FUNCTION public.record_store_payment(uuid, text, text, integer, text, text) IS
  '스토어(App Store/Play) 결제를 payment_intents 에 확정 기록한다. 스토어 주문번호로 멱등. '
  '클라이언트가 만든 pending 인텐트가 있으면 그것을 확정하고, 없으면 만들어 확정한다. '
  '이게 없으면 스토어 결제가 결제 내역과 퍼널에서 통째로 빠진다.';

REVOKE EXECUTE ON FUNCTION public.record_store_payment(uuid, text, text, integer, text, text) FROM PUBLIC;

COMMIT;

-- ============================================================================
-- 272 — 47일 묵은 결제 인텐트를 오늘 결제에 물려주지 않습니다
--
-- 실제로 일어난 일입니다. 안드로이드에서 첫 진짜 결제가 발생했는데
-- (2026-08-21, Standard) 우리 DB 에 구독이 생기지 않았습니다. 추적해 보니:
--
--   1. 앱이 동의를 기록 (billing_consents 에 남음)
--   2. create_payment_intent → **2026-07-05 에 만들어진 pending 인텐트**를 그대로
--      돌려줌 (reused: true). 47일 전 웹/LemonSqueezy 시도에서 버려진 행이고
--      platform 도 provider 도 NULL 이다.
--   3. 구글은 결제를 받음
--   4. 그 인텐트는 지금도 pending
--
-- 재사용 자체는 옳은 방어입니다 — 탭 두 개나 더블탭으로 **두 번 청구되는** 것을 막는
-- 장치입니다(P-M3). 문제는 조건에 **나이 제한이 없다**는 것이었습니다. 47일 전에
-- 이탈한 결제는 더블서브밋이 아니라 그냥 죽은 행입니다.
--
-- 창은 30분으로 잡습니다. 더블탭과 탭 두 개는 초 단위이고, 스토어 결제 시트에서 카드
-- 정보나 비밀번호를 다시 넣는 시간까지 넉넉히 덮습니다.
--
-- unique_violation 분기의 같은 모양 SELECT 는 **건드리지 않습니다**. 거기는 방금
-- 동시에 생긴 행을 찾는 자리라, 나이를 재면 경쟁에서 진 쪽이 인텐트를 못 받고 예외로
-- 떨어집니다.
--
-- 계측도 함께 고쳐집니다: mig 271 의 checkout_started 는 payment_intents INSERT 에
-- 걸려 있어(재사용 분기에서 발화하지 않도록 일부러 그렇게 뒀습니다), 죽은 pending 이
-- 계속 재사용되는 동안 모바일 체크아웃이 퍼널에 한 번도 잡히지 않았습니다.
--
-- 함수 본문은 프로덕션의 현재 정의를 그대로 가져와 위 조건 한 줄만 넣은 것입니다.
-- ============================================================================

BEGIN;

-- 죽은 pending 정리. 어떤 결제와도 연결된 적이 없는 행들이다(paid_at IS NULL).
-- 지우지 않고 만료로 표시한다 — 무엇이 있었는지는 남는 편이 낫다.
UPDATE public.payment_intents
   SET status = 'expired'
 WHERE status = 'pending'
   AND paid_at IS NULL
   AND created_at < now() - interval '30 minutes';

CREATE OR REPLACE FUNCTION public.create_payment_intent(p_product_id text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid          uuid := auth.uid();
  v_kind         text;
  v_title        text;
  v_price_krw    integer;
  v_credits      bigint;
  v_micro_usd    bigint;
  v_merchant_uid text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING errcode = '42501';
  END IF;

  SELECT kind, title, price_krw, credits_micro_usd
    INTO v_kind, v_title, v_price_krw, v_credits
  FROM billing_products
  WHERE id = p_product_id AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown or inactive product: %', p_product_id
      USING errcode = 'invalid_parameter_value';
  END IF;

  IF v_kind = 'subscription' AND EXISTS (
    SELECT 1 FROM billing_subscriptions
     WHERE user_id = v_uid
       AND product_id = p_product_id
       AND status IN ('active','grace','past_due','canceled')
       AND (current_period_end IS NULL OR current_period_end > now())
  ) THEN
    RAISE EXCEPTION 'Already subscribed to this plan' USING errcode = 'invalid_parameter_value';
  END IF;

  -- (P-H5) A live LemonSqueezy (Merchant-of-Record) subscriber must NEVER open a fresh
  -- subscription checkout to switch plans — LS would start a SECOND, independently-billed
  -- subscription (the old one keeps auto-renewing externally) → concurrent double-charge.
  -- Plan changes for LS go through the customer portal (subscription_updated →
  -- sync_subscription_plan, SAME sub id). Block a new subscription intent here. (Other
  -- providers renew from LOCAL rows, so a superseding intent is safe and is not blocked.)
  IF v_kind = 'subscription' AND EXISTS (
    SELECT 1 FROM billing_subscriptions
     WHERE user_id = v_uid
       AND provider = 'lemonsqueezy'
       AND status IN ('active','grace','past_due','canceled')
       AND (current_period_end IS NULL OR current_period_end > now())
  ) THEN
    RAISE EXCEPTION 'Change your plan from the billing portal' USING errcode = 'invalid_parameter_value';
  END IF;

  v_micro_usd := CASE WHEN v_kind = 'credit_pack' THEN v_credits ELSE NULL END;

  -- (P-M3) A subscription checkout must not mint a SECOND chargeable intent for the same
  -- plan (two tabs / double-submit → double charge). Reuse an existing pending one.
  IF v_kind = 'subscription' THEN
    SELECT merchant_uid INTO v_merchant_uid
    FROM payment_intents
    WHERE user_id = v_uid AND product_id = p_product_id
      AND kind = 'subscription' AND status = 'pending'
      -- 272: **방금 만든 것만** 재사용한다. 47일 전에 이탈한 결제는 더블서브밋이
      -- 아니라 죽은 행인데, 나이 제한이 없어서 오늘의 안드로이드 결제가 7월 5일자
      -- 웹 인텐트에 묶였다(그리고 지급되지 않았다).
      AND created_at > now() - interval '30 minutes'
    ORDER BY created_at DESC
    LIMIT 1;
    IF v_merchant_uid IS NOT NULL THEN
      RETURN json_build_object(
        'merchant_uid', v_merchant_uid, 'product_id', p_product_id, 'kind', v_kind,
        'amount_krw', v_price_krw, 'amount_micro_usd', v_micro_usd, 'title', v_title,
        'reused', true);
    END IF;
  END IF;

  BEGIN
    INSERT INTO payment_intents (user_id, product_id, kind, amount_krw, amount_micro_usd)
    VALUES (v_uid, p_product_id, v_kind, v_price_krw, v_micro_usd)
    RETURNING merchant_uid INTO v_merchant_uid;
  EXCEPTION WHEN unique_violation THEN
    -- A concurrent create won the pending slot — return its intent (no second charge).
    SELECT merchant_uid INTO v_merchant_uid
    FROM payment_intents
    WHERE user_id = v_uid AND product_id = p_product_id
      AND kind = 'subscription' AND status = 'pending'
    ORDER BY created_at DESC
    LIMIT 1;
    IF v_merchant_uid IS NULL THEN
      RAISE EXCEPTION 'Could not open a payment intent' USING errcode = 'invalid_parameter_value';
    END IF;
    RETURN json_build_object(
      'merchant_uid', v_merchant_uid, 'product_id', p_product_id, 'kind', v_kind,
      'amount_krw', v_price_krw, 'amount_micro_usd', v_micro_usd, 'title', v_title,
      'reused', true);
  END;

  RETURN json_build_object(
    'merchant_uid',     v_merchant_uid,
    'product_id',       p_product_id,
    'kind',             v_kind,
    'amount_krw',       v_price_krw,
    'amount_micro_usd', v_micro_usd,
    'title',            v_title
  );
END;
$function$;

COMMIT;

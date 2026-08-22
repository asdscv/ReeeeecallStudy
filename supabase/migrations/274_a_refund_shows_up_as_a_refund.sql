-- 274: 구독을 회수하면 그 영수증도 함께 환불로 뒤집습니다.
--
-- ── 실제로 일어난 일 ────────────────────────────────────────────────────────
--
-- 2026-08-22, 273 이 남긴 첫 스토어 영수증(₩5,900 · GPA.3398-0981-3713-32266)을
-- Play API 로 전액 환불하고 즉시 회수했습니다. 구글은 주문을 REFUNDED 로 바꿨고,
-- 구독도 EXPIRED 가 됐고, 웹훅이 도착해 billing_subscriptions 도 내려갔습니다.
--
-- 그런데 **결제 내역은 여전히 "결제 완료"였습니다.**
--
--   revoke_subscription (121) →  billing_subscriptions.status = 'refunded'
--   clawback_credits    (127) →  payment_intents.status = 'refunded'  ... 단, kind='credit_pack'
--
-- 즉 구독 결제를 환불로 뒤집는 경로가 **처음부터 없었습니다.** 크레딧팩만 있었습니다.
-- 273 이 스토어 결제에 영수증을 만들어 준 순간, 그 영수증을 되돌릴 방법이 없다는 사실이
-- 비로소 드러난 것입니다. 175 가 크레딧팩에서 고쳤던 바로 그 문제이기도 합니다 —
-- 돌려준 돈이 화면에서는 받은 돈으로 남아 있는 것.
--
-- ── 왜 별도 RPC 가 아니라 같은 함수 안인가 ──────────────────────────────────
--
-- 웹훅에서 revoke 다음에 한 번 더 부르는 방식이 더 간단해 보입니다. 그런데 그 두 번째
-- 호출이 실패하면 남는 상태가 정확히 지금 이 사고입니다 — 구독은 회수됐는데 영수증은
-- 결제 완료. 회수와 영수증은 같은 사실의 두 면이므로 같은 트랜잭션이어야 합니다.
--
-- ── 무엇을 건드리고 무엇을 안 건드리는가 ────────────────────────────────────
--
-- 매칭은 좁게 잡습니다. 회수된 구독의 **그 사용자**의, **같은 provider** 의,
-- kind='subscription' 이고, provider_payment_id 가 구독 키와 같은, status='paid' 인 행.
-- 273 이 스토어 주문번호를 두 곳에 같은 값으로 적어 두기 때문에 이 매칭이 성립합니다.
--
--   revenuecat (273)                → 두 값이 같은 스토어 주문번호다        → 맞는다
--   activate_subscription_from_intent → provider_payment_id 가 NULL 이면 구독 id 로
--                                       백필한다(121) → 레몬스퀴지에서도 맞는다
--   confirm_payment                   → 주문 id 를 적는다 ≠ 구독 id            → 0건
--
-- 마지막 경우 — 레몬스퀴지가 주문 id 를 따로 들고 온 결제 — 는 여전히 영수증에 반영되지
-- 않습니다. 매칭 키부터 다른 문제라 여기서 고치는 척하지 않고 남겨 둡니다. 오늘 돈이
-- 오가는 경로는 스토어이고, 실제로 깨진 것이 확인된 것도 스토어입니다.
--
-- ── 재전송이 어디서 막히는지가 바뀝니다 ────────────────────────────────────
--
-- 영수증이 'refunded' 가 되면, 환불 뒤 재전송된 첫 지급은 P-H2(구독 행 부활 금지, 144)
-- 대신 P-L3(죽은 인텐트로는 지급하지 않는다, 144)에 **한 걸음 먼저** 걸립니다. 막히는
-- 결과는 같고 이유만 'terminal' → 'intent_refunded' 로 더 정확해집니다. 이 문자열을
-- 읽는 호출자는 없습니다(웹훅은 그대로 ack 합니다). P-H2 는 영수증이 살아남는 회수와
-- sync_subscription 계열에서 계속 제 일을 합니다 — 테스트가 둘 다 붙잡습니다.
--
-- 멱등: status='paid' 조건이 게이트입니다. 재전송된 웹훅의 두 번째 회수는 0건을 세고
-- 지나갑니다(이미 'refunded' 라서). 반환값의 receipts_refunded 로 몇 건이 뒤집혔는지
-- 알 수 있게 합니다 — 0 이면 영수증이 없었거나 이미 처리된 것입니다.
--
-- 121 의 정의를 그대로 두고 UPDATE 한 덩어리만 얹습니다. 가드도, 매칭도, 반환 형태도
-- 그대로입니다(키가 하나 늘 뿐입니다).
BEGIN;

CREATE OR REPLACE FUNCTION public.revoke_subscription(
    p_provider                 text,
    p_provider_subscription_id text)
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id      uuid;
  v_user    uuid;
  v_intents integer := 0;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized to revoke subscription' USING errcode = '42501';
  END IF;
  IF p_provider_subscription_id IS NULL OR p_provider_subscription_id = '' THEN
    RAISE EXCEPTION 'provider_subscription_id required' USING errcode = 'invalid_parameter_value';
  END IF;

  UPDATE billing_subscriptions
     SET status = 'refunded', updated_at = now()
   WHERE provider = p_provider
     AND provider_subscription_id = p_provider_subscription_id
   RETURNING id, user_id INTO v_id, v_user;

  IF v_id IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_found');
  END IF;

  -- 274: 회수했으면 영수증도 뒤집는다. 회수한 구독의 주인 것만, 그리고 아직 'paid' 인
  -- 것만 — 이 두 조건이 남의 행을 건드리지 않게 하고 재전송을 멱등하게 만든다.
  UPDATE payment_intents
     SET status = 'refunded'
   WHERE user_id             = v_user
     AND provider            = p_provider
     AND provider_payment_id = p_provider_subscription_id
     AND kind                = 'subscription'
     AND status              = 'paid';
  GET DIAGNOSTICS v_intents = ROW_COUNT;

  RETURN json_build_object(
    'ok', true, 'id', v_id, 'user_id', v_user, 'status', 'refunded',
    'receipts_refunded', v_intents);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.revoke_subscription(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.revoke_subscription(text, text)
  TO service_role, authenticated;   -- authenticated 는 is_admin 가드를 지나야 도달한다

COMMIT;

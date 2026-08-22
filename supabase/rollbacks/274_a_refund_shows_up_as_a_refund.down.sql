-- 274 되돌리기: 회수는 하되 영수증은 결제 완료로 남는 121 의 정의로.
-- 이미 'refunded' 로 뒤집힌 payment_intents 는 되돌리지 않는다 — 실제로 돌려준 돈이다.
BEGIN;

CREATE OR REPLACE FUNCTION public.revoke_subscription(
    p_provider                 text,
    p_provider_subscription_id text)
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id   uuid;
  v_user uuid;
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
  RETURN json_build_object(
    'ok', true, 'id', v_id, 'user_id', v_user, 'status', 'refunded');
END;
$$;

COMMIT;

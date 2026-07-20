-- ============================================================================
-- 135: ADMIN one-click REFUND support. The admin-refund edge fn issues the REAL
-- money refund at the provider (LemonSqueezy order / subscription-invoice refund, or
-- TossPayments payment cancel) and then reconciles our side. This migration adds only
-- the SQL the edge fn needs that isn't already in 121/127:
--   * admin_refund_target(kind, ref) — is_admin()-guarded resolver that returns the
--     provider + the exact identifiers the edge fn must hit (LS order id / Toss
--     paymentKey for a credit pack; LS subscription-invoice id / Toss paymentKey +
--     provider_subscription_id for a subscription). Enforces the admin gate in SQL so
--     the edge fn's authorization is a single RPC call with the caller's JWT.
--
-- The actual internal reversal reuses EXISTING RPCs (no new money mutators here):
--   credit_pack  → clawback_credits(merchant_uid)         (mig 127, idempotent)
--   subscription → revoke_subscription(provider, sub_id)  (mig 121, idempotent)
-- Both are service_role-only and idempotent, so the edge fn calling them after the
-- provider refund is safe even though the provider webhook ALSO reconciles.
--
-- Additive/idempotent: CREATE OR REPLACE only. No new grants to anon.
-- ============================================================================

-- admin_refund_target — resolve what to refund + authorize (is_admin). Returns
--   {ok:true, kind, provider, user_id, ...ids} or {ok:false, reason}. Read-only.
CREATE OR REPLACE FUNCTION public.admin_refund_target(p_kind text, p_ref text)
  RETURNS json
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v json;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin only' USING errcode = '42501';
  END IF;
  IF p_ref IS NULL OR p_ref = '' THEN
    RETURN json_build_object('ok', false, 'reason', 'missing_ref');
  END IF;

  IF p_kind = 'credit_pack' THEN
    -- Refund a one-time credit-pack payment, matched by merchant_uid. provider_payment_id
    -- holds the LS order id (LS) or the Toss paymentKey (Toss). Only a PAID intent refunds.
    SELECT json_build_object(
             'ok',                  true,
             'kind',                'credit_pack',
             'provider',            pi.provider,
             'user_id',             pi.user_id,
             'merchant_uid',        pi.merchant_uid,
             'provider_payment_id', pi.provider_payment_id,
             'amount_krw',          pi.amount_krw,
             'status',              pi.status)
      INTO v
      FROM payment_intents pi
     WHERE pi.merchant_uid = p_ref;
    IF v IS NULL THEN RETURN json_build_object('ok', false, 'reason', 'not_found'); END IF;
    RETURN v;

  ELSIF p_kind = 'subscription' THEN
    -- Refund a subscription, matched by our billing_subscriptions.id. The provider money
    -- refund targets the LATEST recorded invoice (LS subscription-invoice id / Toss
    -- paymentKey); it may be NULL if no invoice was recorded yet (e.g. an admin comp grant
    -- or a first charge not yet in billing_invoices) — the edge fn then only revokes access.
    SELECT json_build_object(
             'ok',                       true,
             'kind',                     'subscription',
             'provider',                 s.provider,
             'user_id',                  s.user_id,
             'provider_subscription_id', s.provider_subscription_id,
             'status',                   s.status,
             'latest_invoice_id', (
               SELECT bi.provider_invoice_id
                 FROM billing_invoices bi
                WHERE bi.provider = s.provider
                  AND bi.provider_subscription_id = s.provider_subscription_id
                ORDER BY bi.created_at DESC
                LIMIT 1))
      INTO v
      FROM billing_subscriptions s
     WHERE s.id = p_ref::uuid;
    IF v IS NULL THEN RETURN json_build_object('ok', false, 'reason', 'not_found'); END IF;
    RETURN v;

  ELSE
    RAISE EXCEPTION 'Invalid refund kind: %', p_kind USING errcode = 'invalid_parameter_value';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_refund_target(text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_refund_target(text, text) TO authenticated;

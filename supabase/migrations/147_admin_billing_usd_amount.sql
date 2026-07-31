-- ============================================================================
-- 147: Admin payment lists expose a USD amount (micro-USD), not just legacy ₩.
--
-- The store charges USD everywhere now (mig 145). admin_billing_overview already
-- reports USD, but the per-row payment lists (admin_list_payments / the payments
-- array in admin_get_user_billing) still returned only `amount_krw`, so the admin
-- UI rendered a payment as `₩5,900` while the customer's own PaymentHistory showed
-- `$3.99` — wrong symbol AND a non-FX-linked number. Add `amount_micro` (micro-USD):
-- the snapshotted amount_micro_won (micro-USD since mig 145/146) for credit packs,
-- falling back to the product's USD list price for subscription rows that carry no
-- micro amount — same formula as admin_billing_overview.paid_revenue_30d. The client
-- formats it with formatUsdMicro. `amount_krw` is kept for back-compat (unused by UI).
-- Additive + CREATE OR REPLACE only.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_list_payments(p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result json;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin only' USING errcode = '42501';
  END IF;

  SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json) INTO result
  FROM (
    SELECT pi.merchant_uid, pi.user_id, u.email, pi.product_id, pi.kind,
           pi.amount_krw,
           COALESCE(pi.amount_micro_won, bp.price_usd_cents::bigint * 10000, 0) AS amount_micro,
           pi.status, pi.provider, pi.provider_payment_id,
           pi.paid_at, pi.created_at
    FROM payment_intents pi
    LEFT JOIN auth.users u ON u.id = pi.user_id
    LEFT JOIN billing_products bp ON bp.id = pi.product_id
    ORDER BY pi.created_at DESC
    LIMIT p_limit OFFSET p_offset
  ) r;

  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_user_billing(p_user uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result json;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin only' USING errcode = '42501';
  END IF;

  SELECT json_build_object(
    'subscription', (
      SELECT row_to_json(s) FROM (
        SELECT id, user_id, product_id, tier, status, card_limit, provider,
               provider_ref, provider_subscription_id, current_period_end,
               cancel_at_period_end, created_at, updated_at
        FROM billing_subscriptions
        WHERE user_id = p_user
        ORDER BY (status = 'active') DESC, updated_at DESC
        LIMIT 1
      ) s),
    'wallet_micro',
      COALESCE((SELECT balance FROM ai_credit_balance WHERE user_id = p_user), 0),
    'ledger', COALESCE((
      SELECT json_agg(row_to_json(l)) FROM (
        SELECT delta, reason, balance_after, created_at
        FROM ai_credit_ledger
        WHERE user_id = p_user
        ORDER BY created_at DESC
        LIMIT 20
      ) l), '[]'::json),
    'payments', COALESCE((
      SELECT json_agg(row_to_json(pm)) FROM (
        SELECT pi.merchant_uid, pi.product_id, pi.kind, pi.amount_krw,
               COALESCE(pi.amount_micro_won, bp.price_usd_cents::bigint * 10000, 0) AS amount_micro,
               pi.status, pi.paid_at, pi.created_at
        FROM payment_intents pi
        LEFT JOIN billing_products bp ON bp.id = pi.product_id
        WHERE pi.user_id = p_user
        ORDER BY pi.created_at DESC
        LIMIT 20
      ) pm), '[]'::json)
  ) INTO result;

  RETURN result;
END;
$function$;

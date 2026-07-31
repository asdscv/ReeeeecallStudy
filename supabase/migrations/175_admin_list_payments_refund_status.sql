-- ============================================================================
-- 175: admin_list_payments — report the REAL status of a credit-pack row.
--
-- BUG: mig 156 introduced, and mig 159 carried forward, a literal
-- `'paid'::text AS status` on the credit-pack (ai_credit_ledger) arm of the
-- UNION. A credit pack that was REFUNDED therefore kept showing as **paid** in
-- Admin → Billing → Payments. The clawback row was in the ledger all along; the
-- list simply never looked for it.
--
-- Two consequences, one cosmetic and one not:
--   1. the status pill read "Paid" (green) for money we had already given back;
--   2. AdminBillingPage gates the refund button on
--      `status === 'paid' && kind === 'credit_pack'`, so a refunded pack still
--      offered a **Refund** button. Pressing it re-ran the provider refund +
--      clawback path for an already-refunded grant. That path is idempotent
--      (mig 158's guard + the `refund:`-tombstone check), so no money moved
--      twice — but the admin was being invited to try, and the confirm dialog
--      quoted the full amount as if it were still refundable.
--
-- FIX: derive the status from the ledger instead of asserting it. The verdict is
-- NOT re-implemented here — it delegates to `credit_grant_is_refunded(ref)`
-- (mig 158, extended by mig 173), which is the single source of truth for
-- "does a refund stand for this grant?" = a `refund:<ref>` row exists AND no
-- `reversal:<ref>` row exists. Inlining the two EXISTS lookups would have
-- duplicated the namespace rule that mig 173 explicitly centralised, and a
-- store-reversed refund (REFUND_REVERSED) must flip the row back to 'paid'.
--
-- Cost: one STABLE call per credit-pack row on the page (the admin UI pages at
-- PAY_PAGE_SIZE = 25), each two index lookups on ai_credit_ledger.ref.
--
-- Privileges: `credit_grant_is_refunded` is GRANTed to service_role only, but
-- admin_list_payments is SECURITY DEFINER and both functions share an owner, so
-- the EXECUTE check passes against the definer. The callee's own in-body gate
-- (`auth.role() = 'service_role' OR is_admin()`) still sees the CALLER's JWT and
-- is satisfied by the same admin that already passed this function's gate — so
-- the reuse does not widen who can read refund state.
--
-- Everything else is mig 159's body verbatim (including the payment_intents arm,
-- which reads its real `pi.status` and was never affected).
--
-- Idempotent: CREATE OR REPLACE only. No schema change, no data change.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_list_payments(
    p_limit    integer DEFAULT 50,
    p_offset   integer DEFAULT 0,
    p_platform text    DEFAULT NULL)
  RETURNS json
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  result json;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin only' USING errcode = '42501';
  END IF;
  IF p_platform IS NOT NULL AND p_platform NOT IN ('web','ios','android') THEN
    RAISE EXCEPTION 'Invalid platform: %', p_platform USING errcode = 'invalid_parameter_value';
  END IF;

  SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json) INTO result
  FROM (
    SELECT * FROM (
      SELECT pi.merchant_uid, pi.user_id, u.email, pi.product_id, pi.kind,
             pi.amount_krw,
             COALESCE(pi.amount_micro_won, bp.price_usd_cents::bigint * 10000, 0) AS amount_micro,
             pi.status, pi.provider, pi.provider_payment_id,
             pi.paid_at, pi.created_at,
             pi.platform,
             'production'::text AS environment,
             public._billing_channel(pi.platform, pi.provider) AS channel,
             public._channel_has_money_api(
               public._billing_channel(pi.platform, pi.provider)) AS can_refund_money
      FROM payment_intents pi
      LEFT JOIN auth.users u ON u.id = pi.user_id
      LEFT JOIN billing_products bp ON bp.id = pi.product_id
      WHERE p_platform IS NULL OR pi.platform = p_platform

      UNION ALL

      SELECT l.ref AS merchant_uid, l.user_id, u.email, NULL::text AS product_id,
             'credit_pack'::text AS kind,
             NULL::integer AS amount_krw,
             l.delta::bigint AS amount_micro,
             -- WAS: 'paid'::text. A standing refund makes this row 'refunded';
             -- a reversed refund (REFUND_REVERSED) makes it 'paid' again.
             CASE WHEN public.credit_grant_is_refunded(l.ref)
                  THEN 'refunded'::text ELSE 'paid'::text END AS status,
             'revenuecat'::text AS provider,
             l.ref AS provider_payment_id,
             l.created_at AS paid_at, l.created_at,
             l.platform,
             COALESCE(l.environment, 'production') AS environment,
             public._billing_channel(l.platform, 'revenuecat') AS channel,
             public._channel_has_money_api(
               public._billing_channel(l.platform, 'revenuecat')) AS can_refund_money
      FROM ai_credit_ledger l
      LEFT JOIN auth.users u ON u.id = l.user_id
      WHERE l.delta > 0
        AND l.reason = 'purchase'
        AND l.ref IS NOT NULL
        AND (l.ref LIKE 'rc:%' OR l.ref LIKE 'rcev:%')
        AND (p_platform IS NULL OR l.platform = p_platform)
    ) unioned
    ORDER BY created_at DESC
    LIMIT p_limit OFFSET p_offset
  ) r;

  RETURN result;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_list_payments(integer, integer, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_list_payments(integer, integer, text) TO authenticated;

-- PostgREST must pick up the replaced body.
NOTIFY pgrst, 'reload schema';
